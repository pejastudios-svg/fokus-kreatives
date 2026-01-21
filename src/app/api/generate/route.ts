import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import Groq from 'groq-sdk'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

type GroqErrorLike = {
  status?: unknown
  statusCode?: unknown
  message?: unknown
  error?: {
    code?: unknown
    message?: unknown
  }
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms))
}

async function tryAcquireLock(key: string, ttlMs: number): Promise<boolean> {
  const now = new Date()
  const lockedUntil = new Date(now.getTime() + ttlMs).toISOString()

  const { data: existing, error: selErr } = await supabaseAdmin
    .from('ai_locks')
    .select('locked_until')
    .eq('key', key)
    .maybeSingle()

  if (selErr) {
    // Fail open if lock table is unavailable (don’t block generation)
    console.warn('ai_locks select error:', selErr)
    return true
  }

  if (existing?.locked_until && new Date(existing.locked_until) > now) {
    return false
  }

  const { error: upErr } = await supabaseAdmin
    .from('ai_locks')
    .upsert({ key, locked_until: lockedUntil })

  if (upErr) {
    console.warn('ai_locks upsert error:', upErr)
    return true
  }

  return true
}

async function releaseLock(key: string): Promise<void> {
  try {
    await supabaseAdmin
      .from('ai_locks')
      .update({ locked_until: new Date(0).toISOString() })
      .eq('key', key)
  } catch {
    // ignore
  }
}

async function groqWithRetry<T>(makeCall: () => Promise<T>): Promise<T> {
  const maxAttempts = 4
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await makeCall()
        } catch (err: unknown) {
      const e = err as GroqErrorLike

      const status =
        typeof e.status === 'number'
          ? e.status
          : typeof e.statusCode === 'number'
            ? e.statusCode
            : undefined

      const msg = (typeof e.message === 'string' ? e.message : '').toLowerCase()

      const is429 =
        status === 429 ||
        msg.includes('rate_limit') ||
        msg.includes('tokens per minute') ||
        msg.includes('tpm')

      if (!is429 || attempt === maxAttempts) throw err

      const wait = Math.min(1500 * Math.pow(2, attempt - 1), 8000) + Math.floor(Math.random() * 250)
      await sleep(wait)
    }
  }
  throw new Error('Retry failed')
}

// Comprehensive hook formulas
const hookFormulas = [
  'You think X… but it’s actually Y',
  'If I were you”: “If I had to start from 0 in [niche], I’d do this…',
  'You’re doing [thing] wrong — here’s the fix',
  'I almost quit when… then this happened',
  'Here’s what changed when we did ONE thing…',
  'You don’t need [common belief] — you need this instead',
  'Steal this script for when someone says…',
  '3 signs your content isn’t converting (and the quick fix)',
  'Want to double your {outcome}? This is how you do it.',
  'Stop. What you\'re doing isn\'t working.',
  'Everyone does {X}. They\'re wrong.',
  '{Time} ago, I almost quit. Then...',
  'Here\'s a secret nobody tells you about {topic}.',
  '{Number} mistakes that cost me {amount}.',
  'Here\'s how I {result} in {time}.',
  'If you\'re a {title}, this is for you.',
  'This is scary for all {niche} professionals.',
  'Bet you didn\'t know this about {topic}.',
  'The industry hides this from you.',
  'I was broke until I discovered this.',
  'My client paid ${believable amount} for this. Free for you.',
  '{Common belief} is completely wrong.',
  'Nobody talks about this strategy.',
  'This is the video right here. This guy uploaded a hack for all the {niche} out there.',
  'My degree is in {occupation} and this is the most important tip I ever learned.',
  'Here\'s how {brand} pays for my {expensive item}.',
  'You want to hear the 2 biggest issues that I see as a {title} over and over again?',
  'Here\'s how I\'d blow up my {platform} if I was a product based small business.',
  'Here\'s a {niche} secret that you need to know.',
  'Only do this if you want to grow your {business}, if not keep scrolling.',
  'This is getting scary and it could get really bad for all {niche}. Let me explain.',
  '{Number} {niche} mistakes I\'ve made with clients I wish I could take back.',
  'This is a script to use when {situation}.',
  'Here\'s a way to get easy access to people to {outcome} in {year}.',
  'This is how you work smarter not harder when coming up with new {topic}.',
  'This is for the person who has zero time to {task} for their business.',
  'I\'m a {title}. Here are some cheap hacks for {problem} that make me zero dollars.',
  'This is the #1 way you\'re {problem} on your {platform}.',
  'Save this video. I\'m gonna teach you the {number} {tactic} that most people will bring up.',
  'Why I don\'t use {tool} and you shouldn\'t either!',
  'How much money do I make as a {title}. Let\'s talk about pay transparency.',
  'Here\'s more on how to reduce your {problem} from a {title}.',
  'If you work with {topic}, this is going to make a lot of sense to you.',
  'Hey Guys, today I\'m gonna talk about {number} {tools} all {title} need.',
  'Please tell me I\'m not the only person who just figured this out as a {title}.',
  'Top {number} Sites I use to save time as a {title}.',
  '{Number} {niche} tricks you didn\'t know were being used on you.',
  'Here\'s something REALLY important that every {niche} should\'ve been taught.',
  '{Number} Free {tools} to create great {outcome}.',
  '3 Reasons why {wrong solution} won\'t work.',
  'How I got {outcome} in {timeframe}.',
  'Did you know that {niche} get {opposite assumption} more than any other profession?',
  'The #1 thing I tell every {customer} {outcome} is this!',
  'Listen up if you want to {controversial outcome} from {niche}.',
  'Most {niche} won\'t tell you this, cause they\'re too busy making money from it.',
  'Here\'s how {niche} tricks you into buying their {product}.',
  'Here\'s a tip from a professional {title} that can save you a ton of {problem}.',
  'Here\'s how I did {number} {outcome} in {timeframe}.',
  'Have you ever noticed how {niche} get more {outcome} even though yours might be better?',
  'Did you know how {niche} exploded in popularity?',
  'If you work with {customers} you need to hear this!',
  'Want to know the secret to {niche} {platform} strategy?',
  'How did {popular figure} use {platform} to become the biggest thing since sliced bread?',
  '{Platform} revealed some shocking new data!',
  'Next time you\'re dealing with someone with a {problem} who refuses to listen, try this.',
  'You gotta check this {tool} out. It\'s absolutely wild!',
  'If you just started your {niche} you absolutely have to see this.',
  'Here\'s a quick tip for looking and feeling more {solution}.',
  'Here\'s how you can market like {authority figure}.',
  'Nobody is talking about this {solution} strategy.',
  'If you run a {niche} you\'re gonna enjoy this video.',
  'This is a trick used by {authority} to explain {problem} simply.',
  'Ok I want to share a {tool} that you absolutely need for {niche}.',
  'You\'re {action} your {niche} wrong. I\'ll teach you the proper way.',
  'The {niche} industry do not want you to know this.',
  'You absolutely need this free tool for {problem}.',
  'Here\'s how to stop avoiding the things you need to do in your {topic} life.',
  'Here\'s another secret {authorities} don\'t want you to know about...',
  'There\'s a hack to learning {topic}, that\'s so under appreciated.',
  'Tough pill from a {title}...',
  'Here\'s a website that feels illegal to know.',
  'Here\'s something most {platform} gurus fail to talk about.',
  'These are my secrets for {outcome}, from a top {title} in the world.',
  'Here\'s how you can steal {celebrity}\'s {topic} technique!',
  'If you give me {short time} I\'ll show you a {resource} that will change your business.',
  'If you\'re a {title} looking to {outcome} you HAVE to do these 2 things.',
  'If you have a business you NEED to see this!',
  '3 tough pills from a {title}. Listen to all of them.',
  'Here\'s a hack that I used to make my first {thing} for my business.',
  'Hey {industry} and {niche}, here\'s the #1 thing I see you doing wrong!',
  'Here\'s a website that helps you {action} {pain point}.',
  'Stop using {common tool}, use these instead!',
  'This is how you actually {pain point} from a {title} perspective.',
  'I\'m gonna show you how to get unstuck in {pain point} in just 1 video!',
  'Here\'s the easiest way to create {thing} for {platform}.',
  'This is 1 of the easiest strategies when it comes to {platform} that NOBODY talks about!',
  'Here\'s what you can expect when working with an actual {title} professional.',
  'Ok here\'s a simple brilliant mind hack I used to 10x my {thing}.',
  'The very first thing you should invest in, in your business is...',
  'This is the exact strategy I use for my clients on how to {problem}.',
  '{Adjective} {tool} you should start paying attention to... RIGHT NOW!',
  'If you\'re struggling in {problem}, steal this strategy from me!',
  'This is how I {action} a new {client} {service}...',
  'Here\'s something I learned as a {title} that\'s made me over {amount} in my business.',
  'How to get really good at {problem}. Most people say {common method}, instead try this.',
  'This is the #1 reason I see {niche} go out of business.',
  '3 {tools} you need to know if you wanna get better at {topic}.',
  'Top 3 books you need to read if you\'re trying to start a {niche}.',
  'Here\'s the 3 {tools} I would use if I wanted to build a {thing} for less than {low cost}.',
  'Do this if you want to start monetizing your {platform}!',
  'I bet you didn\'t know this sneaky {platform} trick!',
  'Wanna see a sneak peek of my {resource} I just created?',
  '2 {platform} updates you absolutely need to know about!',
  'Are you a business owner and want to grow your {platform} with your ideal customer?',
  'Trust me when I tell you... this brand new {tool} is gonna be a game changer!',
  'Top 5 {tools} I use to run my {niche}.',
  'Here\'s a cool {platform} hack that you need to know!',
  '{Title} STOP SCROLLING! If you want to set yourself up for the long run, listen up!',
  'If I was restarting my career in {niche} this is exactly what I would do!',
]

const storySetupOpeners = [
  'Quick story.',
  'Real quick.',
  'You know that moment when',
  'Ever notice how',
  'This is the part nobody talks about.',
  'Here’s what used to happen to me.',
  'Here’s what I wish someone told me sooner.',
  'A lot of people don’t realize this until',
  'I used to do this all the time.',
  'Here’s the exact moment it clicked for me.',
  'Think back to the last time',
  'Here’s what usually happens:',
  'Most people don’t notice this until',
  'Here’s the mistake I kept making:',
  'Here’s what fixed it for me:',
]

function pickUniqueOpeners(count: number, avoid: string[] = []) {
  const avoidSet = new Set((avoid || []).map((s) => (s || '').trim()).filter(Boolean))

  const pool = storySetupOpeners.filter((o) => !avoidSet.has(o))
  const shuffled = [...pool].sort(() => Math.random() - 0.5)

  const picked = shuffled.slice(0, Math.min(count, shuffled.length))

  // fallback if pool is too small
  if (picked.length < count) {
    const fallback = [...storySetupOpeners].sort(() => Math.random() - 0.5)
    for (const o of fallback) {
      if (picked.length >= count) break
      if (!picked.includes(o)) picked.push(o)
    }
  }

  return picked
}

const hookCategories = [
  'Curiosity',
  'Confession',
  'Challenge',
  'Listicle',
  'Urgency',
  'Transformation',
  'Relatability',
] as const

type HookCategory = (typeof hookCategories)[number]

function pickUniqueHookCategories(count: number, avoid: string[] = []): HookCategory[] {
  const avoidSet = new Set((avoid || []).map((s) => (s || '').trim()))
  const pool = hookCategories.filter((c) => !avoidSet.has(c))
  const shuffled = [...pool].sort(() => Math.random() - 0.5)

  const picked = shuffled.slice(0, Math.min(count, shuffled.length))

  if (picked.length < count) {
    const fallback = [...hookCategories].sort(() => Math.random() - 0.5)
    for (const c of fallback) {
      if (picked.length >= count) break
      if (!picked.includes(c)) picked.push(c)
    }
  }

  return picked as HookCategory[]
}

type RotationRow = {
  opener_used: string | null
  hook_category: string | null
  first3: string | null
  teaching_topic: string | null
}

async function loadRotationMemory(clientId: string) {
  const { data } = await supabaseAdmin
    .from('content')
    .select('opener_used, hook_category, first3, teaching_topic')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(30)

  const rows = (data || []) as RotationRow[]

  const usedOpeners = Array.from(new Set(rows.map(r => r.opener_used || '').filter(Boolean)))
  const usedCategories = Array.from(new Set(rows.map(r => r.hook_category || '').filter(Boolean)))
  const usedFirst3 = Array.from(new Set(rows.map(r => r.first3 || '').filter(Boolean)))
  const usedTeaching = Array.from(new Set(rows.map(r => r.teaching_topic || '').filter(Boolean)))

  return { usedOpeners, usedCategories, usedFirst3, usedTeaching }
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.GROQ_API_KEY

  if (!apiKey) {
    return NextResponse.json(
      { success: false, error: 'GROQ_API_KEY not found' },
      { status: 500 }
    )
  }

  const groq = new Groq({ apiKey })

  const lockKey = 'generate-global'
  let gotLock = false

  try {
    // Acquire lock here (INSIDE try)
    gotLock = await tryAcquireLock(lockKey, 45_000)

    if (!gotLock) {
      return NextResponse.json(
        { success: false, error: 'Generator busy. Try again in a few seconds.' },
        { status: 429 }
      )
    }

    const body = await request.json()
const {
  clientId,
  clientInfo,
  contentType,
  contentPillar,
  idea,
  quantity,
  competitorInsights,
  tier,
  ctaText,
  includeMeta,
} = body

const tierLevel = (tier as 'beginner' | 'mid' | 'advanced') || 'beginner'
const finalCtaText = (ctaText ? String(ctaText) : '').trim()

const isBeginner = tierLevel === 'beginner'
const isStoryPost = contentType === 'Story Post'

// captions/hashtags for all except stories
const includePublishingPack = includeMeta !== false && !isStoryPost

const normalizedClientId = clientId ? String(clientId) : ''
const rotationMemory = normalizedClientId
  ? await loadRotationMemory(normalizedClientId)
  : { usedOpeners: [], usedCategories: [], usedFirst3: [], usedTeaching: [] }

const ideaText = (idea ? String(idea) : '').trim()
const ideaIsDraft = ideaText.length >= 180 || ideaText.includes('\n')

    const maxByType: Record<string, number> = {
      'Long-form Script': 3,
      'Short-form Script': 10,
      'Carousel': 10,
      'Story Post': 10,
      'Engagement Reel': 10,
    }

    const defaultMax = 10
    const requestedRaw = quantity

const requested =
  typeof requestedRaw === 'number'
    ? requestedRaw
    : typeof requestedRaw === 'string'
      ? parseInt(requestedRaw, 10)
      : 1

const maxForThisType = maxByType[contentType] ?? defaultMax
const safeQuantity = Math.min(Number.isFinite(requested) ? requested : 1, maxForThisType)
const memory = clientId ? await loadRotationMemory(String(clientId)) : { usedOpeners: [], usedCategories: [], usedFirst3: [], usedTeaching: [] }

const openersForScripts = pickUniqueOpeners(safeQuantity, rotationMemory.usedOpeners)
const hookCategoriesForScripts = pickUniqueHookCategories(safeQuantity, rotationMemory.usedCategories)
const openersForClips = pickUniqueOpeners(5, [...rotationMemory.usedOpeners, ...openersForScripts])

    // Shuffle and pick random hooks
    const shuffledHooks = [...hookFormulas].sort(() => Math.random() - 0.5)
    const selectedHooks = shuffledHooks.slice(0, 20).join('\n- ')

    const systemPrompt = `You are an elite content strategist and scriptwriter with 15+ years of experience creating viral, story-driven content for top creators and brands across TikTok, Reels, Shorts, YouTube and carousels.

## YOUR ROLE
You create content that:
- Grabs attention instantly with a viral hook
- Builds **tension and curiosity** so people want to stay until the end
- Delivers real, specific value
- Ends with a natural, soft CTA that drives comments and leads

Your voice is **conversational, confident, and modern** – never corporate.

## HARD NOs – NEVER DO THIS
❌ NEVER say: "At [Company Name]" or "We at [anything]"
❌ NEVER say: "Welcome to my channel/page", "Welcome back", or "In today's video..."
❌ NEVER say: "Hey guys, it's [name] here"
❌ NEVER over-explain boring context at the start
❌ NEVER stuff the script with cliches, cheesy motivational lines, or vague advice
❌ NEVER copy any story or text word-for-word from the client context – only use it as inspiration
❌ NEVER reuse the exact same hook, angle, or structure across scripts in the same batch
❌ NEVER shorten or compress later scripts just because there are many – quality MUST stay high
❌ NEVER cite studies, stats, or research ("studies show...", "22x more...") unless the client context provided it
❌ NEVER start the HOOK with “Imagine…” / “Picture this…” generic openings (story setup is fine)
❌ NEVER cite studies, research, Harvard, or stats unless explicitly present in CLIENT CONTEXT
❌ NEVER include any numbers (%, x-times, "22 times", etc.) unless present in CLIENT CONTEXT
❌ If a CTA is provided, do NOT add any other “comment below / DM me / share” requests anywhere else.
❌ NEVER use placeholder examples from other industries (e.g., "fitness coach", "marketing coach", "small business owner") unless that is the client’s niche
❌ NEVER write generic advice that could apply to anyone — every example must fit the client’s niche and target audience from CLIENT CONTEXT
❌ NEVER invent results, proof, or outcomes that are not in CLIENT CONTEXT (especially for beginner tier)
❌ NEVER mention studies, research, Harvard, “statistics show”, or any %/multipliers unless they appear in CLIENT CONTEXT or IDEA text
❌ NEVER invent client results, testimonials, or performance claims unless they appear in CLIENT CONTEXT (social_proof)
❌ NEVER use placeholder niches like “fitness coach”, “marketing coach”, “small business owner” unless that is the client’s niche
❌ NEVER add a second CTA like “comment below/share/DM me” if a CTA pickup is provided

## MUST-DOs – ALWAYS DO THIS
✅ ALWAYS start with a **pattern-interrupt hook** that:
   - States a surprising claim, painful truth, or bold promise, AND
   - Sets up a payoff that is only fully resolved near the end
✅ ALWAYS create **anticipation**:
   - Hint that something important is coming later
   - Do NOT reveal the full “secret” in the first 1–2 lines
✅ ALWAYS respect the selected **Content Type** and **Pillar** structure and length
✅ ALWAYS use concrete examples, micro-stories and step-by-step breakdowns (use numbers ONLY if present in client context or idea)
✅ ALWAYS sound like a smart friend talking directly to one person ("you"), not an announcer
✅ CTA RULE (CONDITIONAL)
- If a CTA is provided in the user prompt, include a CTA section and use the CTA text VERBATIM (do not change the keyword).
- If NO CTA is provided, OMIT the CTA section entirely. Do not invent a CTA.
✅ ALWAYS treat **every script in the batch** as if it’s the only one:
   - Full value, full depth, no lazy repetition

   ## TIER VOICE RULES (STRICT)
Tier: ${tierLevel}

BEGINNER:
- Speak like a guide who has been there.
- Use phrases like: "I used to...", "When I was starting...", "What changed for me..."
- Do NOT diagnose the viewer: avoid "You're doing X wrong" / "Your content is failing"

MID:
- Mix "here’s what works" with light guidance
- Can mention common mistakes (not "your mistake")

ADVANCED:
- Can be more direct, but still no aggressive sales language

## VIRAL HOOKS – USE THESE AS FORMULAS (NEVER COPY VERBATIM)
Use these formulas as inspiration, but rewrite them uniquely every time:

- ${selectedHooks}

Make hooks:
- Bold and **specific**
- Tied to the client’s niche and target audience
- Designed to make people **need** to know what happens at the end

## CONTENT PILLAR GUIDELINES (RESPECT THIS STRICTLY)

${contentPillar === 'Educational' ? `
### EDUCATIONAL (Tips, tutorials, mistakes)
Goal: Teach something specific, fix a real mistake, or give a clear win.

Structure:
1. HOOK – Expose a painful mistake or surprising shortcut
2. SETUP – Briefly describe the situation/problem (max 1–2 lines)
3. VALUE – Break down the method or tips with clear steps
4. EXAMPLE – Show how it looks in real life
5. FUTURE-PACE – What changes when they use this
6. CTA – Soft, comment-based CTA

Tone: Direct, "let me save you time", confident but friendly.
` : ''}

${contentPillar === 'Storytelling' ? `
### STORYTELLING (Journey, challenges, wins)
Goal: Tell a real-feeling story that hooks emotionally and leads to a lesson.

Structure:
1. HOOK – Drop into the most intense or intriguing moment
2. BACKSTORY – Fast context (no long rambling)
3. STRUGGLE – The main challenge / tension
4. TURNING POINT – The decision, insight, or moment that changed everything
5. RESULT – The outcome / transformation
6. LESSON + CTA – What they can take away and a soft comment CTA

Tone: Vulnerable, honest, cinematic, like a friend telling a story over coffee.
` : ''}

${contentPillar === 'Authority' ? `
### AUTHORITY (Case studies, transformations)
Goal: Show credibility with real results and a clear method.

Structure:
1. HOOK – Lead with a specific result (numbers or transformation)
2. BEFORE – Where they/you started
3. METHOD – The exact steps or framework used
4. PROOF – Details, numbers, mini-testimonials
5. HOW-THEY-CAN-DO-IT – Action steps for the viewer
6. CTA – Soft invite to comment for template, checklist, script, etc.

Tone: Confident, data-backed, “here’s what actually works” vibes.
` : ''}

${contentPillar === 'Series' ? `
### SERIES (Multi-part content)
Goal: Make them want to come back for the next part.

Structure:
1. HOOK – Tease the overall series promise or outcome
2. CONTEXT – What this episode/part covers (very brief)
3. MAIN VALUE – Deliver 1–2 big points for this part
4. CLIFFHANGER – Hint at what’s coming in the next part
5. CTA – “Comment [WORD] if you want Part 2”, "Follow for the next part", etc.

Tone: Energetic, building tension, focused on keeping them in the series.
` : ''}

${contentPillar === 'Double Down' ? `
### DOUBLE DOWN (Expand proven content)
Goal: Go deeper on ideas that already worked for this creator.

Structure:
1. HOOK – Reference the previous “hit” content or commonly known tip
2. "WHAT YOU DIDN’T HEAR" – Reveal the deeper layer most people miss
3. ADVANCED – Next-level tactics, nuances, exceptions
4. APPLICATION – How to combine original concept + this deeper layer
5. CTA – Comment to get the extended version, checklist, or template.

Tone: Insider, "now that you already know the basics, here’s what the pros do".
` : ''}`

    let formatGuide = ''

    const knownTypes = new Set([
  'Long-form Script',
  'Short-form Script',
  'Carousel',
  'Story Post',
  'Engagement Reel',
])

const isKnownType = knownTypes.has(contentType)
    
    if (contentType === 'Long-form Script') {
      formatGuide = `
## OUTPUT FORMAT: LONG-FORM SCRIPT (10-12 minutes each)
Create ${safeQuantity} complete, detailed scripts. Each MUST be 1500+ words.

Format each script EXACTLY like this:

===== SCRIPT #[NUMBER] =====

📌 TITLE: [Compelling, clickable title]

🎬 HOOK (0:00-0:30)
[Write the exact words to say. This must STOP the scroll. Use pattern interrupts, bold claims, or emotional triggers. NO weak openings.]

📍 SECTION 1: [Topic Name] (0:30-3:00)
[Full script of what to say. Include specific examples, numbers, stories. Write it conversationally as if speaking.]

📍 SECTION 2: [Topic Name] (3:00-6:00)
[Continue with the next main point. Go deep, not surface level. Include actionable tactics.]

📍 SECTION 3: [Topic Name] (6:00-9:00)
[Build to your most valuable insight. This is where you deliver the "aha moment".]

📍 SECTION 4: [Topic Name] (9:00-11:00)
[Application section - how they can use this today. Be specific.]

🎯 CLOSE (11:00-12:00)
[Strong ending. Summarize key points. NO requests to comment/DM/share. End on a strong final line.]

${finalCtaText ? `🎯 CTA PICKUP (record separately, verbatim)
${finalCtaText}
` : ''}

📝 CAPTION:
[Hook + value promise + engagement question. 150-200 words.]

#️⃣ HASHTAGS:
[12-15 relevant hashtags mixing broad and niche]

🎞️ REPURPOSE CLIPS (5)
Generate 5 short-form cutdowns pulled from this long-form.

Rules:
- Use the EXACT structure below (HOOK/BRIDGE/TEACH).
- Do NOT output TikTok captions, Instagram captions, or hashtags.
- Do NOT add any stats/studies/numbers unless in client context.
- If a CTA was provided, include it as CTA PICKUP verbatim. If no CTA provided, omit CTA entirely.

For each clip, output EXACTLY:

CLIP #[NUMBER]

Topic: [topic]
Hook: [hook]
📚 TEACHING TOPIC: [teaching topic]

🎬 FULL SCRIPT:

[HOOK - 0:00-0:03]
[hook words]

[BRIDGE - 0:03-0:07]
[bridge words]

[TEACH - 0:07-0:45]
[teach section]

${finalCtaText ? `[CTA PICKUP - record separately, verbatim]
${finalCtaText}` : ''}

====================`
    } else if (contentType === 'Short-form Script') {
formatGuide = `
## OUTPUT FORMAT: SHORT-FORM SCRIPT (45-60 seconds)
Create ${safeQuantity} scripts.

Each script MUST follow this EXACT format:

===== SCRIPT #[NUMBER] =====

SCRIPT [NUMBER]

Topic: [specific topic]
Hook Category: [must match assigned category]
Story Setup Opener: [must match assigned opener exactly]
Hook: [hook line]
📚 TEACHING TOPIC: [${ideaIsDraft ? 'ONE lesson extracted from the draft (not a random framework)' : 'topic from the client Topics Library if possible'}]

🎬 FULL SCRIPT:

[HOOK - 0:00-0:03]
[hook line]
(Rule: must NOT start with Story Setup Opener)

[STORY SETUP - 0:03-0:10]
(MUST begin with the assigned Story Setup Opener exactly, then continue naturally)
If idea draft exists, this must match the draft’s first beat (do not invent a new scenario).

[OPEN LOOP + TEACH - 0:10-0:40]
- Start with an open loop promise ("I’ll show you X in a second, but first...")
- If idea draft exists: this section must follow the draft beats (fired → film school → Seun → Fokus Kreatvez → 30-day documenting).
- Then extract ONE clear lesson from the story in plain language.
- Beginner tier voice: guide tone ("I used to...", "When I was starting...", "What changed for me...")

[LOOP BACK - 0:40-0:45]
Loop back to the hook and restate the lesson in one line.

${finalCtaText ? `[CTA PICKUP - 0:45-0:60]
${finalCtaText}` : ''}

${includePublishingPack ? `--- PUBLISHING PACK ---
📱 TIKTOK CAPTION:
[<= 80 chars, no hashtags]

📸 INSTAGRAM CAPTION:
[100-150 words. 1 question at the end. No invented proof.]

#️⃣ HASHTAGS:
[8-12 hashtags, one per line]
` : ''}

Rules:
- Beginner tier: guide voice, no diagnosing the viewer.
- If idea input looks like a draft story/script, preserve key beats and unique details. Improve, don’t replace.
- No invented studies, no invented stats, no invented client results.
====================`
    } else if (contentType === 'Carousel') {
      formatGuide = `
## OUTPUT FORMAT: CAROUSEL (10 slides each)
Create ${safeQuantity} complete carousels. Each slide must have clear, impactful text.

Format each carousel EXACTLY like this:

===== CAROUSEL #[NUMBER] =====

📌 TOPIC: [Main topic/title]

SLIDE 1 (COVER):
[Bold hook text - max 8 words. Must make them swipe.]

SLIDE 2:
[Point 1 with supporting detail]

SLIDE 3:
[Point 2 with supporting detail]

SLIDE 4:
[Point 3 with supporting detail]

SLIDE 5:
[Point 4 with supporting detail]

SLIDE 6:
[Point 5 with supporting detail]

SLIDE 7:
[Point 6 with supporting detail]

SLIDE 8:
[Point 7 with supporting detail or case study]

SLIDE 9:
[Summary or bonus tip]

SLIDE 10 (CTA):
[Call to action - follow, save, share, comment]

📝 CAPTION:
[Hook + value summary + "Save this for later" + question]

#️⃣ HASHTAGS:
[12-15 relevant hashtags]

====================`
    } else if (contentType === 'Story Post') {
  formatGuide = `
## OUTPUT FORMAT: STORY SEQUENCE (3 stories each)
Create ${safeQuantity} story sequences.

NON-NEGOTIABLE RULES:
- You MUST base the story on ONE real story from the client's "KEY STORIES" section in CLIENT CONTEXT.
- Do NOT invent results, client wins, numbers, or proof.
- Add this line at the top: "STORY SOURCE:" and quote 1–2 short lines from the client's KEY STORIES.
- Use beginner-friendly tone if tier is beginner (guide voice, not authority voice).
- No captions, no hashtags.

Format EXACTLY like this:

===== STORY SEQUENCE #[NUMBER] =====

📌 TOPIC: [What this story teaches]

STORY SOURCE (from client KEY STORIES):
"[quote 1-2 short lines from the client's key stories]"

STORY 1 - THE HOOK:
🎨 Visual: [Describe what’s on screen]
📝 Text: [Hook text - max 10 words]
🎙️ Script: [Exact words to say (1-2 short lines)]

STORY 2 - THE MOMENT / LESSON:
🎨 Visual: [Describe what’s on screen]
📝 Text: [The lesson headline]
🎙️ Script: [Exact words to say (2-4 short lines)]

STORY 3 - THE TAKEAWAY:
🎨 Visual: [Describe what’s on screen]
📝 Text: [Clear takeaway text]
🎙️ Script: [Exact words to say (1-3 short lines)]
${finalCtaText ? `🧲 CTA PICKUP (verbatim):
${finalCtaText}` : ''}

====================`
} else if (contentType === 'Engagement Reel') {
      formatGuide = `
## OUTPUT FORMAT: ENGAGEMENT REEL (30 seconds, designed for comments)
Create ${safeQuantity} reels optimized for maximum comments and engagement.

Format each reel EXACTLY like this:

===== ENGAGEMENT REEL #[NUMBER] =====

📌 CONCEPT: [Why this will get engagement - the psychology behind it]

🎬 HOOK (0-2 sec):
[Controversial, relatable, or debate-starting opener]

📍 CONTENT (2-25 sec):
[Build the tension or make your point. Be slightly polarizing. Take a stance.]

🎯 TRIGGER (25-30 sec):
[Direct question or prompt that MAKES them comment]

💬 COMMENT TRIGGERS:
[3 different things viewers will want to comment]

📝 CAPTION:
[Statement + "Agree or disagree?" or "Type 1 if... Type 2 if..."]

#️⃣ HASHTAGS:
[8-10 relevant hashtags]

====================`
    }

    if (!isKnownType) {
  // Keep /api/generate usable for non-script calls like DM templates
  const completion = await groqWithRetry(() =>
    groq.chat.completions.create({
      messages: [
        { role: 'system', content: 'You are a helpful assistant. Follow the user request precisely.' },
        { role: 'user', content: idea || '' },
      ],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.7,
      max_tokens: 2000,
    })
  )

  const content = completion.choices[0]?.message?.content || ''
  return NextResponse.json({ success: true, content })
}

    const userPrompt = `## YOUR TASK
Create ${safeQuantity} ${contentType}(s) for this client.

## TIER
${tierLevel}

${finalCtaText
  ? `USE THIS CTA VERBATIM (no edits, no new keyword, no quotes changes):
\`\`\`
${finalCtaText}
\`\`\``
  : 'NO CTA PROVIDED — omit CTA section entirely.'}

  ## ROTATION MEMORY (LEVEL 2 — AVOID REPETITION)
Avoid reusing these from the last 30 scripts:
- Previously used story openers: ${memory.usedOpeners.slice(0, 12).join(' | ') || 'none'}
- Previously used hook categories: ${memory.usedCategories.join(', ') || 'none'}
- Previously used first-3-words: ${memory.usedFirst3.slice(0, 12).join(' | ') || 'none'}
- Previously used teaching topics: ${memory.usedTeaching.slice(0, 12).join(' | ') || 'none'}

Rules:
- No two scripts in this batch can start with the same 3 words.
- Do not reuse the same story setup opener in this batch.
- The HOOK must NOT start with the Story Setup Opener.
- The Story Setup MUST start with the Story Setup Opener exactly once.

  ## ROTATION (LEVEL 2 + BATCH)
Use these assignments EXACTLY. Do not repeat openers within the batch.

${ideaIsDraft ? `IDEA DRAFT ANCHOR RULE:
- The HOOK must reference at least ONE concrete detail from the draft (e.g., "got fired", "film school", "Seun", "10k in 30 days", "Fokus KREATVEZ").
- Do not invent a new struggle that isn't in the draft.` : ''}

${openersForScripts.map((o, i) =>
  `SCRIPT #${i + 1}: opener must start with "${o}" and Hook Category must be "${hookCategoriesForScripts[i]}"`
).join('\n')}

If you generate REPURPOSE CLIPS, use these openers (one per clip, no repeats):
${openersForClips.map((o, i) => `CLIP #${i + 1}: opener must start with "${o}"`).join('\n')}

Avoid repeating these from last 30 scripts:
- used openers: ${rotationMemory.usedOpeners.slice(0, 10).join(' | ') || 'none'}
- used hook categories: ${rotationMemory.usedCategories.join(', ') || 'none'}
- used first-3-words: ${rotationMemory.usedFirst3.slice(0, 10).join(' | ') || 'none'}
- used teaching topics: ${rotationMemory.usedTeaching.slice(0, 10).join(' | ') || 'none'}

## CLIENT CONTEXT
${clientInfo || 'Business professional helping clients succeed'}

## CLIENT-SPECIFICITY RULES (MANDATORY)
- Every example must match the client’s niche/industry and target audience from CLIENT CONTEXT.
- Do NOT use generic placeholder professions (fitness coach, marketing coach, etc.).
- If you need an example, make it directly about what THIS client does and who they serve.
${isBeginner ? `- Beginner tier: write like a guide. Use "I used to..." / "When I was starting..." and avoid diagnosing the viewer.` : ''}
${isStoryPost ? `- Story Post: you MUST pull the story from the client's KEY STORIES section and include STORY SOURCE quotes.` : ''}

${competitorInsights ? `## COMPETITOR INSIGHTS TO LEVERAGE
${competitorInsights}` : ''}

## CONTENT PILLAR
${contentPillar}

${ideaText ? (ideaIsDraft ? `## IDEA DRAFT TO REWRITE (MANDATORY)
You MUST rewrite and improve this exact draft.
- Preserve the same story beats and unique details.
- Preserve named entities (Jedidiah, Seun, Fokus KREATVEZ).
- Preserve the challenge details (10k in 30 days) if present in the draft.
- Do NOT replace this with a generic audience scenario.

DRAFT (verbatim):
"""
${ideaText}
"""
` : `## SPECIFIC TOPIC/ANGLE
${ideaText}
`) : ''}


${formatGuide}

## CRITICAL REMINDERS
1. Each script must be **COMPLETE** and full-length – never cut corners, even on later scripts in the batch.
2. Use a **different hook and angle** for each script. No copy/paste, no “spinning” the same idea.
3. Sound like a **real person**, not a marketer or announcer.
4. Use specific **numbers, examples, and mini-stories** – not vague advice.
5. DO NOT copy any text or story word-for-word from the client context. Use it as inspiration only.
6. Never mention any company name in "at [company]" format.
7. Maintain the **same high quality** for ALL ${safeQuantity} scripts – later scripts must be just as strong.
8. Only include a CTA if a CTA is provided below. If none is provided, omit the CTA section completely.

Now create ${safeQuantity} exceptional ${contentType}(s) that people will actually want to watch until the end. GO!`

     const completion = await groqWithRetry(() =>
      groq.chat.completions.create({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        model: 'llama-3.3-70b-versatile',
        temperature: 0.85,
        max_tokens: 5000,
      })
    )

    let content = completion.choices[0]?.message?.content || ''

if (!content) {
  return NextResponse.json(
    { success: false, error: 'No content generated. Please try again.' },
    { status: 500 }
  )
}

// ---- Safety cleanup pass (prevents hallucinated "studies show" + random numbers) ----
const clientText = `${String(clientInfo || '')}\n${String(ideaText || '')}`
const clientHasAnyNumber = /\d/.test(clientText)

const hasStudyWords = /\b(study|studies|research|harvard)\b/i.test(content)
const hasAnyNumber = /\d/.test(content)

// If client context has no numbers, we should not allow numbers in output.
const needsCleanup = hasStudyWords || (!clientHasAnyNumber && hasAnyNumber)

if (needsCleanup) {
  const cleanupPrompt = `Rewrite the script below with these rules:
- Remove ALL mentions of studies/research/Harvard.
- Remove ALL numbers and statistics unless they appear in the CLIENT CONTEXT.
- Keep the same structure and meaning.
- If a CTA was provided separately, do NOT add any extra CTA requests in the body.

SCRIPT TO CLEAN:
${content}`

  const cleaned = await groqWithRetry(() =>
    groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      temperature: 0.2,
      max_tokens: 5000,
      messages: [
        { role: 'system', content: 'Return the rewritten script only. No commentary.' },
        { role: 'user', content: cleanupPrompt },
      ],
    })
  )

  content = cleaned.choices[0]?.message?.content || content
}

return NextResponse.json({ success: true, content })
    } catch (error: unknown) {
    console.error('Generation Error:', error)

    const e = error as GroqErrorLike

    const status =
      typeof e.status === 'number'
        ? e.status
        : typeof e.statusCode === 'number'
          ? e.statusCode
          : undefined

    const message =
      (typeof e.message === 'string' ? e.message : '') ||
      (typeof e.error?.message === 'string' ? e.error.message : '')

    const isTokenLimit =
  status === 413 ||
  status === 429 ||
  e.error?.code === 'rate_limit_exceeded' ||
  message.toLowerCase().includes('tokens per minute') ||
  message.toLowerCase().includes('tpm')

    if (isTokenLimit) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Too much content was requested too quickly. Please wait 30–60 seconds and try again with fewer scripts or a smaller idea.',
        },
        { status: 429 }
      )
    }

    return NextResponse.json(
      { success: false, error: message || 'Generation failed. Please try again.' },
      { status: 500 }
    )
  } finally {
    // Always release lock if we acquired it
    if (gotLock) {
      await releaseLock(lockKey)
    }
  }
}