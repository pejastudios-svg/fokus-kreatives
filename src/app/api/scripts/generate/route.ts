import { NextRequest, NextResponse } from 'next/server'
import Groq from 'groq-sdk'
import type { BrandProfile } from '@/components/clients/brandProfile'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

/**
 * =========================================================
 * 1) HARD BANS + ROTATION POOLS
 * =========================================================
 */

const hardBannedPhrases = [
  // AI giveaways
  'game changer',
  'game-changer',
  'total game changer',
  'unlock',
  'unleash',
  'dive in',
  "let's dive in",
  'secret sauce',
  'in this video',
  'welcome back',
  "welcome back to day",
  "hope you're doing well",
  'buckle up',
  'listen up',
  "let's be honest",
  "in today's digital landscape",

  // you said BANNED (not rare)
  'picture this',
  'imagine this',
  'staring at a blank screen',
  'staring at a blank page',
  'staring at a blinking cursor',
  'blank screen',
  'blank page',

  // banned structure
  "it's not x, it's y",
  "that's not x, that's y",
  "that's not a strategy, that's just luck",

  // ban em dash explicitly (and we also sanitize)
  '—',

  // ban “Step 1” style labeling
  'step 1',
  'step 2',
  'step 3',
]

const situationalOpeners = [
  "i almost closed my laptop and called it.",
  "i posted it… and nothing happened.",
  "i checked my analytics and it was rough.",
  "i rewrote the first line like 10 times.",
  "i realized i was making this harder than it needed to be.",
  "i was mid-edit when i noticed why people were swiping away.",
  "i kept hearing the same advice everywhere and it was messing me up.",
  "i hit publish and immediately regretted it.",
  "i was doing the most for the least results.",
  "it was late and i was still working when it clicked.",
  "my brain was full of ideas but turning them into a script was the problem.",
]

const hookFormulas = [
  // placeholder-based; safe across niches; no creator-vs-creator comparisons
  'stop doing [COMMON MISTAKE] if you want [DESIRED OUTCOME].',
  "if you're [ROLE], this is why your [CONTENT] isn’t working.",
  'here’s the difference between [METHOD A] and [METHOD B].',
  'i fixed [PAIN POINT] by changing one thing.',
  'most people think [OLD BELIEF]. here’s what actually works.',
  '3 signs your [THING] is quietly killing your [GOAL].',
  'if you have zero time for [TASK], do this.',
  'this is the simplest way to get better at [TOPIC] without burning out.',
  'if you want [DESIRE] without [PAIN], use this.',
]

const openLoopStarters = [
  "i’ll show you exactly how to do it, but first, here’s what’s been messing you up.",
  "i’m gonna give you the fix, but you need this part first.",
  "before i give you the steps, here’s why this keeps failing.",
]

const rehookStarters = [
  "quick check: if you’re still watching, this next part is the one people skip…",
  "and this is where most people lose the viewer…",
  "here’s the part that makes the difference in retention…",
  "this is the simplest way to make people stick around…",
]

const loopBackStarters = [
  "so here’s the real point:",
  "that’s the difference:",
  "that’s why it works:",
  "so before you post again, remember this:",
  "if you only take one thing from this, take this:",
]

function getRandomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function normalize(s: string): string {
  return (s || '').toLowerCase()
}

function sanitizeOutput(text: string): string {
  // kill em dashes in case model slips
  return (text || '').replaceAll('—', '-')
}

function containsPhrase(haystack: string, needle: string): boolean {
  return normalize(haystack).includes(normalize(needle))
}

function findFirstHardBanHit(text: string): string | null {
  const t = normalize(text)
  for (const phrase of hardBannedPhrases) {
    if (!phrase) continue
    if (t.includes(normalize(phrase))) return phrase
  }
  return null
}

function wordCount(text: string): number {
  return (text || '').trim().split(/\s+/).filter(Boolean).length
}

function hashtagCount(text: string): number {
  return (text.match(/#[\w_]+/g) || []).length
}

function pickNonRepeating(pool: string[], avoid?: string[]): string {
  const avoidSet = new Set((avoid || []).map((x) => normalize(x)))
  const filtered = pool.filter((p) => !avoidSet.has(normalize(p)))
  return getRandomItem(filtered.length ? filtered : pool)
}

function upsertTitle(output: string, fallbackTitle: string): string {
  if (/\[TITLE\]/i.test(output)) return output
  const safeTitle = (fallbackTitle || 'A better way to create content').trim()
  return `[TITLE]\n${safeTitle}\n\n${output}`.trim()
}

function replaceSection(output: string, header: string, replacementBody: string): string {
  const re = new RegExp(
    String.raw`(\[${header}\]\s*)([\s\S]*?)(?=\n\[[A-Z][A-Z +&-]*\]|\s*$)`,
    'i',
  )

  if (!re.test(output)) {
    return `${output.trim()}\n\n[${header}]\n${replacementBody.trim()}\n`
  }

  return output.replace(re, `$1${replacementBody.trim()}\n`)
}

function forceCTA(output: string, ctaText?: string): string {
  if (!ctaText?.trim()) return output
  return replaceSection(output, 'CTA', ctaText.trim())
}

function buildExtraHashtags(profile?: BrandProfile | null): string[] {
  const base = [
    '#contentcreation',
    '#socialmedia',
    '#marketing',
    '#business',
    '#entrepreneur',
    '#smallbusiness',
    '#branding',
    '#contentstrategy',
    '#creator',
  ]

  if (!profile) return base

  const role = (profile.audience.work_roles || '').toLowerCase()
  const goal = profile.content_strategy.primary_content_goal

  const roleTags: string[] = []
  if (role.includes('business')) roleTags.push('#businessowner')
  if (role.includes('coach')) roleTags.push('#coach')
  if (role.includes('realtor')) roleTags.push('#realtor')
  if (role.includes('photographer')) roleTags.push('#photographer')
  if (role.includes('creator')) roleTags.push('#contentcreator')

  const goalTags: string[] = []
  if (goal === 'leads') goalTags.push('#leadgeneration')
  if (goal === 'authority') goalTags.push('#thoughtleader')
  if (goal === 'followers') goalTags.push('#growyouraudience')
  if (goal === 'engagement') goalTags.push('#engagement')
  if (goal === 'education') goalTags.push('#marketingtips')

  // Pull from evergreen topics lightly
  const evergreen = profile.content_strategy.evergreen_topics
    .map((t) => (t || '').trim())
    .filter(Boolean)
    .slice(0, 3)
    .map((t) => `#${t.toLowerCase().replace(/\s+/g, '')}`)

  return [...base, ...roleTags, ...goalTags, ...evergreen]
}

function ensureHashtagMinimum(output: string, min: number, profile?: BrandProfile | null): string {
  const current = hashtagCount(output)
  if (current >= min) return output

  const existing = new Set((output.match(/#[\w_]+/g) || []).map((t) => t.toLowerCase()))
  const extras = buildExtraHashtags(profile).filter((t) => !existing.has(t.toLowerCase()))

  const needed = Math.max(0, min - current)
  const add = extras.slice(0, needed).join(' ')

  // Try to append inside publishing pack if possible, else append at end
  if (/\[PUBLISHING PACK\]/i.test(output)) {
    // If there's a "HASHTAGS" line, append there; otherwise add a new line.
    if (/HASHTAGS:/i.test(output)) {
      return output.replace(/(HASHTAGS:\s*)(.*)/i, (_m, p1, p2) => `${p1}${p2} ${add}`.trim())
    }
    return `${output.trim()}\nHashtags: ${add}\n`
  }

  return `${output.trim()}\n\nHashtags: ${add}\n`
}

/**
 * =========================================================
 * 2) REQUEST TYPES
 * =========================================================
 */

type ContentType =
  | 'Short-form Script'
  | 'Long-form Script'
  | 'Carousel'
  | 'Story Post'
  | 'Engagement Reel'
  | string

type ContentPillar =
  | 'educational'
  | 'storytelling'
  | 'authority'
  | 'series'
  | 'double down'
  | 'doubledown'
  | string

type ClientTier = 'Beginner' | 'Mid' | 'Advanced' | string

interface GenerateBody {
  clientId?: string
  clientProfile?: BrandProfile | null
  contentType: ContentType
  contentPillar?: ContentPillar
  ideaInput?: string
  referenceScript?: string
  tier?: ClientTier
  ctaText?: string

  // optional “anti-rinse-repeat” from UI/database
  recentHooks?: string[]
  recentOpeners?: string[]
  recentTopics?: string[]
}

/**
 * =========================================================
 * 3) PROFILE-DRIVEN ENEMY (ONE PER CLIENT) + FIELD MAPPING
 * =========================================================
 */

function nonEmptyStrings(list: readonly string[]): string[] {
  return list.map((s) => (s || '').trim()).filter(Boolean)
}

function deriveClientEnemyFromPainPoints(painPoints: string[]): string {
  const joined = normalize(painPoints.join(' | '))
  if (joined.includes('inconsist')) return 'the inconsistency loop (post → disappear → guilt → repeat)'
  if (joined.includes('time') || joined.includes('busy')) return 'the time tax (everything takes 10x longer than it should)'
  if (joined.includes('overwhelm') || joined.includes('confus')) return 'the overwhelm trap (too many tools, no clear next step)'
  if (joined.includes('views') || joined.includes('reach') || joined.includes('engagement'))
    return 'the attention treadmill (post more, get less, burn out)'
  if (joined.includes('lead') || joined.includes('sales') || joined.includes('convert'))
    return 'the “busy content” trap (content that looks good but doesn’t convert)'
  return 'the bad-advice fog (generic tips that keep you stuck)'
}

function profanityRules(level: BrandProfile['voice']['profanity_level']): string {
  switch (level) {
    case 'none':
      return `- profanity: none. do not swear.`
    case 'light':
      return `- profanity: light. mild emphasis only (e.g., "damn"). no harsh words.`
    case 'medium':
      return `- profanity: medium. allowed for emphasis (e.g., "damn", "hell", "shit") but not every sentence. no slurs.`
    case 'high':
      return `- profanity: high. still no slurs. use sparingly for punch.`
    default:
      return `- profanity: follow client profile.`
  }
}

function competitorStructureDNA(profile: BrandProfile | null | undefined): string {
  if (!profile) return '(no competitor data)'
  const competitors = profile.competitors || []
  const lines = competitors
    .map((c) => {
      const handle = (c.name_or_handle || '').trim()
      const well = (c.does_well || '').trim()
      const poorly = (c.does_poorly || '').trim()
      const diff = (c.differentiate || '').trim()
      if (!handle && !well && !poorly && !diff) return ''
      return [
        handle ? `- competitor: ${handle}` : '',
        well ? `  does well: ${well}` : '',
        poorly ? `  does poorly: ${poorly}` : '',
        diff ? `  how we differentiate: ${diff}` : '',
      ]
        .filter(Boolean)
        .join('\n')
    })
    .filter(Boolean)

  return lines.length ? lines.join('\n\n') : '(no competitor notes)'
}

function formatClientContext(profile: BrandProfile | null | undefined, tier: ClientTier | undefined) {
  if (!profile) return 'CLIENT CONTEXT: (none provided)'

  const p = profile
  const safeTier = tier || 'Beginner'

  const painPoints = nonEmptyStrings(p.audience.pain_points)
  const desires = (p.audience.desires || '').trim()
  const fears = (p.audience.fears || '').trim()
  const objections = (p.audience.objections || '').trim()
  const triedFailed = (p.audience.tried_failed || '').trim()
  const yesTriggers = (p.audience.yes_triggers || '').trim()

  const enemy = deriveClientEnemyFromPainPoints(painPoints)

  const forbidden = nonEmptyStrings(p.voice.forbidden_words)
  const signatures = nonEmptyStrings(p.voice.signature_phrases)

  const tierInstruction =
    safeTier === 'Advanced'
      ? `TIER: Advanced (direct, authority, stronger CTAs allowed unless never_do.aggressive_sales=true)`
      : safeTier === 'Mid'
        ? `TIER: Mid (education + story + light authority)`
        : `TIER: Beginner (trust-building + soft CTAs)`

  return `
CLIENT CONTEXT (use these fields, don’t ignore them):
BUSINESS:
- mission: ${p.business.mission}
- vision: ${p.business.vision}
- problem solved: ${p.business.problem_solved}
- differentiation: ${p.business.differentiation}
- signature offer: ${p.business.signature_offer}

AUDIENCE (be specific, speak directly to them):
- address audience as: "${p.voice.address_audience_as}" (use this pronoun style)
- work roles: ${p.audience.work_roles}
- location: ${p.audience.location}
- age range: ${p.audience.age_range}
- family situation: ${p.audience.family_situation}
- core values: ${p.audience.core_values}
- fears: ${fears}
- desires: ${desires}
- objections: ${objections}
- tried and failed: ${triedFailed}
- “YES!” triggers: ${yesTriggers}
- top pain points: ${painPoints.join(', ')}

ONE COMMON ENEMY (consistent per client, subtext only): ${enemy}

VOICE (must shape every line):
- traits: ${p.voice.traits}
- casualness: ${p.voice.casualness}/5
- funny: ${p.voice.funny}/5
- enthusiastic: ${p.voice.enthusiastic}/5
- emotional: ${p.voice.emotional}/5
- irreverent: ${p.voice.irreverent}/5
- uses jargon: ${p.voice.uses_jargon} (if "no", avoid jargon)
- shares personal stories: ${p.voice.shares_personal_stories} (only factual; do not invent timelines)
${profanityRules(p.voice.profanity_level)}
- signature phrases (use max 2 naturally): ${signatures.join(' | ') || '(none)'}
- forbidden words (never use): ${forbidden.join(' | ') || '(none)'}

CONTENT STRATEGY (follow these rules):
- primary goal: ${p.content_strategy.primary_content_goal}
- desired action: ${p.content_strategy.desired_action}
- evergreen topics: ${nonEmptyStrings(p.content_strategy.evergreen_topics).join(', ')}
- hot takes: ${nonEmptyStrings(p.content_strategy.hot_takes).join(', ')}
- off-limits topics: ${nonEmptyStrings(p.content_strategy.off_limits_topics).join(', ') || '(none)'}
- myths (use for Educational): 
  1) myth: ${p.content_strategy.myths[0]?.myth} | truth: ${p.content_strategy.myths[0]?.truth}
  2) myth: ${p.content_strategy.myths[1]?.myth} | truth: ${p.content_strategy.myths[1]?.truth}
  3) myth: ${p.content_strategy.myths[2]?.myth} | truth: ${p.content_strategy.myths[2]?.truth}

MUST INCLUDE FLAGS (hard constraints):
- step_by_step: ${p.content_strategy.must_include.step_by_step}
- educational_value: ${p.content_strategy.must_include.educational_value}
- call_to_actions: ${p.content_strategy.must_include.call_to_actions}
- personal_stories: ${p.content_strategy.must_include.personal_stories}
- behind_the_scenes: ${p.content_strategy.must_include.behind_the_scenes}
- industry_insights: ${p.content_strategy.must_include.industry_insights}
- specific_data_numbers: ${p.content_strategy.must_include.specific_data_numbers}

NEVER DO FLAGS (hard constraints):
- income_claims: ${p.content_strategy.never_do.income_claims}
- name_competitors: ${p.content_strategy.never_do.name_competitors}
- aggressive_sales: ${p.content_strategy.never_do.aggressive_sales}
- overnight_results: ${p.content_strategy.never_do.overnight_results}
- political: ${p.content_strategy.never_do.political}
- fear_tactics: ${p.content_strategy.never_do.fear_tactics}
- overly_promotional: ${p.content_strategy.never_do.overly_promotional}

COMPETITOR STRUCTURE DNA (steal rhythm, not words/topics):
${competitorStructureDNA(profile)}

${tierInstruction}
`.trim()
}

/**
 * =========================================================
 * 4) MODE SELECTION + OUTPUT FORMAT
 * =========================================================
 */

function detectMode(idea: string, pillar: string): 'DRAFT' | 'TOPIC' | 'NO_IDEA' {
  const hasIdea = idea.trim().length > 0
  if (!hasIdea) return 'NO_IDEA'
  if (normalize(pillar).includes('series')) return 'DRAFT'
  if (idea.trim().length > 160) return 'DRAFT'
  return 'TOPIC'
}

function buildOutputFormat(contentType: string): string {
  const ct = normalize(contentType)

  if (ct.includes('long')) {
    return `
OUTPUT FORMAT (LONG FORM 10–12 MIN):
[TITLE]
[HOOK]
[SETUP]
[SHIFT]
[STRATEGY]
[EXAMPLES]
[WRAP + LOOP BACK]
[CTA]
[PUBLISHING PACK]
- HEADER
- CAPTION
- HASHTAGS

LENGTH RULES:
- 900–1700 words.
- STRATEGY: 3–5 actions, each with an example.
- Include mini re-hooks every ~60–90 seconds (short punch lines).
- No “Step 1/2/3”.
`.trim()
  }

  if (ct.includes('carousel')) {
    return `
OUTPUT FORMAT (CAROUSEL):
[TITLE]
Slide 1:
Slide 2:
Slide 3:
Slide 4:
Slide 5:
(optional) Slide 6:
(optional) Slide 7:
(optional) Slide 8:
(optional) Slide 9:
(optional) Slide 10:
[PUBLISHING PACK]
- HEADER
- CAPTION
- HASHTAGS

CAROUSEL RULES:
- 5–10 slides only. stop when value is complete (no padding).
- each slide max ~18 words. no paragraphs.
- must include an actual plan/steps (not vibes).
- structure: hook → value → re-hook → value → CTA.
`.trim()
  }

  if (ct.includes('story post')) {
    return `
OUTPUT FORMAT (IG STORIES — NO CAPTION/HASHTAGS):
[TITLE]
Frame 1 (Hook):
Frame 2 (Value):
Frame 3 (Re-hook):
Frame 4 (CTA):
Frame 5 (Poll/Question):

STORY RULES:
- max 5 frames.
- short overlay text. no paragraphs.
- no publishing pack.
`.trim()
  }

  if (ct.includes('engagement')) {
    return `
OUTPUT FORMAT (ENGAGEMENT REEL 7–15s):
[TITLE]
[TRIGGER]
[CONTEXT]
[BAIT]
[ON-SCREEN TEXT]
[CTA]
[PUBLISHING PACK]
- HEADER
- CAPTION
- HASHTAGS

ENGAGEMENT RULES:
- polarizing trigger (a real take).
- context is 1 sentence max.
- bait must be A/B or Yes/No.
- no teaching list. no backstory.
`.trim()
  }

  return `
OUTPUT FORMAT (SHORT FORM 45–60s):
[TITLE]
[HOOK]
[STORY SETUP]
[OPEN LOOP + TEACH]
[RE-HOOK]
[LOOP BACK]
[CTA]
[PUBLISHING PACK]
- HEADER
- CAPTION
- HASHTAGS

DEPTH RULES:
- 150–220 words.
- include 3 concrete actions + 1 example line for each action.
- story setup must NOT repeat hook sentence.
- no “Step 1/2/3”.
- re-hook must be new (not repeating hook).
`.trim()
}

const titleRewriteRules = `
TITLE RULES:
- rewrite the plain topic into a sharper, human headline.
- make it specific, slightly edgy, and emotional (fits the voice).
- do NOT use banned phrases.
- do NOT do creator-vs-creator comparisons.
`

/**
 * =========================================================
 * 5) PROMPT BUILDER
 * =========================================================
 */

function buildSystemPrompt(params: {
  clientProfile: BrandProfile | null | undefined
  tier: ClientTier | undefined
  contentType: string
  pillar: string
  mode: 'DRAFT' | 'TOPIC' | 'NO_IDEA'
  selectedHook: string
  selectedOpener: string
  selectedOpenLoop: string
  selectedRehook: string
  selectedLoopBack: string
  ctaText?: string
  referenceScript?: string
}) {
  const {
    clientProfile,
    tier,
    contentType,
    pillar,
    mode,
    selectedHook,
    selectedOpener,
    selectedOpenLoop,
    selectedRehook,
    selectedLoopBack,
    ctaText,
    referenceScript,
  } = params

  const p = clientProfile
  const outputFormat = buildOutputFormat(contentType)
  const pillarLower = normalize(pillar)

  const neverDo = p?.content_strategy.never_do
  const mustInclude = p?.content_strategy.must_include

  const pillarRules =
    pillarLower.includes('educat')
      ? `
PILLAR = EDUCATIONAL
- use the client's myths if available (myth → truth).
- structure: myth → cost → truth → proof (with examples).
- no random biography unless it’s in the user’s draft.
`
      : pillarLower.includes('author')
        ? `
PILLAR = AUTHORITY
- case study style OR "if i managed your account, here’s what i’d do".
- do not invent numbers if specific_data_numbers=false.
`
        : pillarLower.includes('series')
          ? `
PILLAR = SERIES
- arc per episode: status → struggle → win/lesson → next step.
- start immediately with "Day X." in the hook (no recap language).
`
          : pillarLower.includes('story')
            ? `
PILLAR = STORYTELLING
- personal stories are allowed only if shares_personal_stories != "no" AND facts come from the user draft.
- otherwise: situational storytelling only.
`
            : `
PILLAR = DEFAULT
- keep it specific and useful.
`

  const modeRules =
    mode === 'DRAFT'
      ? `
MODE = DRAFT IMPROVEMENT (EDITOR)
- the user gave an idea/draft.
- your job is to improve it, not change the topic.
- keep all factual details from the draft.
- add clarity, tighten wording, and add examples WITHOUT inventing life events.
`
      : mode === 'TOPIC'
        ? `
MODE = TOPIC EXPANSION (CREATOR)
- use this hook formula: "${selectedHook}"
- story setup must start with: "${selectedOpener}"
- open loop style should match: "${selectedOpenLoop}"
- re-hook style should match: "${selectedRehook}"
- loop-back style should match: "${selectedLoopBack}"
`
        : `
MODE = NO IDEA (TOPIC PICKER)
- pick a topic from: evergreen_topics, myths, hot_takes, or content_pillars covers.
- do not pick anything off-limits.
- do not repeat obvious generic topics.
- use this hook formula: "${selectedHook}"
- story setup must start with: "${selectedOpener}"
`

  const competitorRule =
    referenceScript && (pillarLower.includes('double') || pillarLower.includes('doubledown'))
      ? `
DOUBLE DOWN (STRUCTURE CLONE):
- mimic the rhythm/pacing/transitions of the reference script.
- do not copy phrases.
- write a new script about today's topic.
`
      : `
COMPETITOR STRUCTURE:
- borrow pacing + transitions from competitor DNA in client context.
- do NOT name competitors (never_do.name_competitors likely true).
`

  const ctaRule = ctaText
    ? `
CTA RULE (STRICT):
- output this EXACTLY in [CTA]:
"${ctaText}"
- do not replace curly braces like {CONTENT}.
`
    : `
CTA RULE (DEFAULT):
- if client desired_action is:
  - follow: "follow for more"
  - dm: "dm {CONTENT}"
  - comment_keyword: "comment {CONTENT}"
  - book_call: "comment {CONTENT} and i’ll send the link"
  - visit_website: "visit the link"
- soften/harden based on tier AND never_do.aggressive_sales.
`

  const safetyRules = `
SAFETY RULES:
- never_do.name_competitors=${neverDo?.name_competitors ?? true}: do NOT mention competitor handles/names.
- never_do.income_claims=${neverDo?.income_claims ?? true}: do NOT make money claims.
- never_do.overnight_results=${neverDo?.overnight_results ?? true}: no “overnight” results.
- never_do.aggressive_sales=${neverDo?.aggressive_sales ?? true}: if true, keep CTAs soft.
- never_do.overly_promotional=${neverDo?.overly_promotional ?? true}: do not sound salesy.
`

  const mustIncludeRules = `
MUST INCLUDE RULES:
- step_by_step=${mustInclude?.step_by_step ?? true}: include clear steps (but do not label Step 1).
- educational_value=${mustInclude?.educational_value ?? true}: include real value, not vibes.
- behind_the_scenes=${mustInclude?.behind_the_scenes ?? true}: for series/storytelling, show the process.
- specific_data_numbers=${mustInclude?.specific_data_numbers ?? false}: if false, do NOT invent numbers.
`

  return `
You are an elite content strategist + ghostwriter.

${formatClientContext(clientProfile, tier)}

HARD FAIL RULES (if violated, regenerate):
- do not use any banned phrases: ${JSON.stringify(hardBannedPhrases)}
- do not use em dashes (—). use normal hyphens.
- do not repeat the hook line inside story setup.
- do not invent timelines ("3 years ago") unless user draft explicitly includes it.
- do not write generic fluff. every teaching point must include a concrete example.

TRIBE EFFECT (US VS THEM) — SUBTEXT ONLY:
- use the ONE COMMON ENEMY from client context as “the trap/system”.
- do NOT say “the enemy is…”. instead absolve the viewer and point at the trap.

${titleRewriteRules}

ROTATION (obey):
- hook formula: "${selectedHook}"
- opener: "${selectedOpener}"
- open loop style: "${selectedOpenLoop}"
- re-hook style: "${selectedRehook}"
- loop-back style: "${selectedLoopBack}"

${pillarRules}
${modeRules}
${competitorRule}
${safetyRules}
${mustIncludeRules}
${ctaRule}

${outputFormat}

PUBLISHING PACK RULES (when included):
- HEADER: 6–14 words. punchy. human. “old → new” style transformation.
- CAPTION: 90–160 words. must include:
  1) a hook line,
  2) 3 bullets of value,
  3) end with a question.
- HASHTAGS: 12–18 hashtags (broad + niche + audience).
`.trim()
}

function buildUserPrompt(params: {
  contentType: string
  pillar: string
  mode: 'DRAFT' | 'TOPIC' | 'NO_IDEA'
  idea: string
  referenceScript?: string
  clientProfile?: BrandProfile | null
}) {
  const { contentType, pillar, mode, idea, referenceScript, clientProfile } = params

  let p = `Create a ${contentType}. Pillar: ${pillar}.`

  if (mode === 'DRAFT') {
    p += `\n\nUSER DRAFT (improve it; do not change topic; do not invent facts):\n"""\n${idea}\n"""`
  } else if (mode === 'TOPIC') {
    p += `\n\nTOPIC/IDEA:\n"${idea}"`
  } else {
    const evergreen = clientProfile ? nonEmptyStrings(clientProfile.content_strategy.evergreen_topics) : []
    const hotTakes = clientProfile ? nonEmptyStrings(clientProfile.content_strategy.hot_takes) : []
    const myths = clientProfile
      ? nonEmptyStrings(clientProfile.content_strategy.myths.map((m) => m.myth).filter(Boolean))
      : []
    p += `\n\nNO TOPIC PROVIDED.\nPick one topic from these pools (avoid repeats, avoid off-limits):\n- evergreen: ${evergreen.join(
      ', ',
    )}\n- hot takes: ${hotTakes.join(', ')}\n- myths: ${myths.join(', ')}`
  }

  if (referenceScript) {
    p += `\n\nREFERENCE SCRIPT (structure DNA only; do not copy wording):\n"""\n${referenceScript}\n"""`
  }

  return p
}

/**
 * =========================================================
 * 6) VALIDATION
 * =========================================================
 */

function extractSection(text: string, header: string, nextHeaders: string[]): string {
  const t = text || ''
  const start = t.indexOf(header)
  if (start === -1) return ''
  const afterStart = start + header.length
  const rest = t.slice(afterStart)
  const nextIndex = nextHeaders
    .map((h) => rest.indexOf(h))
    .filter((i) => i >= 0)
    .sort((a, b) => a - b)[0]
  return (nextIndex === undefined ? rest : rest.slice(0, nextIndex)).trim()
}

function validateOutput(params: {
  contentType: string
  output: string
  ctaText?: string
  clientProfile?: BrandProfile | null
  pillar?: string
}): { ok: boolean; reason?: string } {
  const { contentType, output, ctaText, clientProfile, pillar } = params
  const out = sanitizeOutput(output)

  // hard bans
  const banHit = findFirstHardBanHit(out)
  if (banHit) return { ok: false, reason: `Used banned phrase: "${banHit}"` }

  // client forbidden words
  if (clientProfile) {
    for (const fw of clientProfile.voice.forbidden_words) {
      const w = (fw || '').trim()
      if (!w) continue
      if (containsPhrase(out, w)) return { ok: false, reason: `Used forbidden word: "${w}"` }
    }
  }

  // never name competitors
  if (clientProfile?.content_strategy.never_do.name_competitors) {
    for (const c of clientProfile.competitors) {
      const name = (c.name_or_handle || '').trim()
      if (!name) continue
      if (containsPhrase(out, name)) return { ok: false, reason: `Named competitor: "${name}"` }
    }
  }

  // CTA verbatim if provided
  if (ctaText) {
    const expected = ctaText.trim()
    if (!expected) return { ok: false, reason: 'CTA provided but empty' }
    if (!out.includes(expected)) return { ok: false, reason: 'CTA not used verbatim' }
  }

  const ct = normalize(contentType)

  // Story Post: must NOT include publishing pack
  if (ct.includes('story post')) {
    if (containsPhrase(out, '[publishing pack]')) return { ok: false, reason: 'Story Post must not include PUBLISHING PACK' }
    const frames = (out.match(/Frame\s+\d+/gi) || []).length
    if (frames < 4) return { ok: false, reason: 'Story Post too short (needs at least 4 frames)' }
    if (frames > 5) return { ok: false, reason: 'Story Post too long (>5 frames)' }
    return { ok: true }
  }

  // All others must include publishing pack
  if (!containsPhrase(out, '[publishing pack]')) return { ok: false, reason: 'Missing [PUBLISHING PACK]' }

  // Required title
  if (!containsPhrase(out, '[title]')) return { ok: false, reason: 'Missing [TITLE]' }

  // Length rules
  if (ct.includes('long')) {
    if (wordCount(out) < 900) return { ok: false, reason: 'Long-form too short (<900 words)' }
  } else if (ct.includes('carousel')) {
    const slides = (out.match(/Slide\s+\d+:/gi) || []).length
    if (slides < 5) return { ok: false, reason: 'Carousel too short (<5 slides)' }
    if (slides > 10) return { ok: false, reason: 'Carousel too long (>10 slides)' }
  } else if (ct.includes('engagement')) {
    if (!containsPhrase(out, '[trigger]') || !containsPhrase(out, '[context]') || !containsPhrase(out, '[bait]')) {
      return { ok: false, reason: 'Engagement Reel missing required sections' }
    }
    // engagement reels should be short
    if (wordCount(out) > 160) return { ok: false, reason: 'Engagement Reel too long (>160 words)' }
  } else {
    // short form
    const wc = wordCount(out)
    if (wc < 150) return { ok: false, reason: 'Short-form too short (<150 words)' }
    if (wc > 240) return { ok: false, reason: 'Short-form too long (>240 words)' }

    // hook not repeated in setup (basic enforcement)
    const hook = extractSection(out, '[HOOK]', ['[STORY SETUP]', '[OPEN LOOP + TEACH]', '[RE-HOOK]', '[LOOP BACK]', '[CTA]', '[PUBLISHING PACK]'])
    const setup = extractSection(out, '[STORY SETUP]', ['[OPEN LOOP + TEACH]', '[RE-HOOK]', '[LOOP BACK]', '[CTA]', '[PUBLISHING PACK]'])
    const hookLine = hook.split('\n').map((s) => s.trim()).filter(Boolean)[0] || ''
    if (hookLine && setup && normalize(setup).includes(normalize(hookLine))) {
      return { ok: false, reason: 'Story setup repeats hook line' }
    }
  }

  // Publishing pack quality
  const hashtags = hashtagCount(out)
  if (hashtags < 12) return { ok: false, reason: 'Not enough hashtags (<12)' }

  // Series must start with Day X
  if (pillar && normalize(pillar).includes('series')) {
    const hook = extractSection(out, '[HOOK]', ['[STORY SETUP]', '[OPEN LOOP + TEACH]', '[RE-HOOK]', '[LOOP BACK]', '[CTA]', '[PUBLISHING PACK]'])
    if (!/day\s+\d+/i.test(hook)) return { ok: false, reason: 'Series must start with "Day X" in hook' }
    if (containsPhrase(out, 'welcome back')) return { ok: false, reason: 'Series used recap language' }
  }

  return { ok: true }
}

async function generateWithRetries(params: {
  systemPrompt: string
  userPrompt: string
  contentType: string
  pillar?: string
  ctaText?: string
  clientProfile?: BrandProfile | null
  fallbackTitle: string
}) {
  const { systemPrompt, userPrompt, contentType, pillar, ctaText, clientProfile, fallbackTitle } = params

  const maxTries = 5
  let lastReason = ''
  let lastOutput = ''

  for (let attempt = 1; attempt <= maxTries; attempt++) {
    const completion = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content:
            userPrompt +
            (attempt > 1
              ? `\n\nREGEN NOTE: last output failed because: ${lastReason}. Regenerate fully and obey all rules.`
              : ''),
        },
      ],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.5,
      max_tokens: normalize(contentType).includes('long') ? 7500 : 3500,
    })

    const raw = completion.choices[0]?.message?.content || ''
    let output = sanitizeOutput(raw)

    // AUTO-FIXES (only mechanical ones)
    output = upsertTitle(output, fallbackTitle)
    output = forceCTA(output, ctaText)
    output = ensureHashtagMinimum(output, 12, clientProfile)

    lastOutput = output

    const v = validateOutput({ contentType, output, ctaText, clientProfile, pillar })
    if (v.ok) {
      return { ok: true, output, reason: '' }
    }

    lastReason = v.reason || 'Validation failed'
    console.log(`[GEN RETRY] attempt=${attempt}/${maxTries} reason=${lastReason}`)
  }

  return { ok: false, output: lastOutput, reason: lastReason || 'Validation failed' }
}

/**
 * =========================================================
 * 7) ROUTE HANDLER
 * =========================================================
 */

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as GenerateBody

    const {
      clientProfile,
      contentType,
      contentPillar,
      ideaInput,
      referenceScript,
      tier,
      ctaText,
      recentHooks,
      recentOpeners,
    } = body

    const idea = (ideaInput || '').trim()
    const pillar = (contentPillar || 'educational').toLowerCase()

    const mode = detectMode(idea, pillar)

    const selectedHook = pickNonRepeating(hookFormulas, recentHooks)
    const selectedOpener = pickNonRepeating(situationalOpeners, recentOpeners)
    const selectedOpenLoop = getRandomItem(openLoopStarters)
    const selectedRehook = getRandomItem(rehookStarters)
    const selectedLoopBack = getRandomItem(loopBackStarters)

    const systemPrompt = buildSystemPrompt({
      clientProfile,
      tier,
      contentType,
      pillar,
      mode,
      selectedHook,
      selectedOpener,
      selectedOpenLoop,
      selectedRehook,
      selectedLoopBack,
      ctaText,
      referenceScript,
    })

    const userPrompt = buildUserPrompt({
      contentType,
      pillar,
      mode,
      idea,
      // only truly use reference script for double down
      referenceScript: pillar.includes('double') ? referenceScript : undefined,
      clientProfile,
    })

    const result = await generateWithRetries({
  systemPrompt,
  userPrompt,
  contentType,
  pillar,
  ctaText,
  clientProfile,
  fallbackTitle: idea ? idea.slice(0, 70) : 'the simplest content plan that actually saves time',
})

return NextResponse.json({
  success: true,
  content: result.output,
  validation: {
    ok: result.ok,
    reason: result.reason,
  },
})
  } catch (error) {
  console.error('Script Gen Error:', error)

  const message =
    error instanceof Error ? error.message : 'Unknown error'

  return NextResponse.json(
    { success: false, error: message },
    { status: 500 }
  )
}
}