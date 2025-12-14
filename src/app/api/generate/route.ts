import { NextRequest, NextResponse } from 'next/server'
import Groq from 'groq-sdk'

// Comprehensive hook formulas
const hookFormulas = [
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
  'My client paid $10K for this. Free for you.',
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

export async function POST(request: NextRequest) {
  const apiKey = process.env.GROQ_API_KEY
  
  if (!apiKey) {
    return NextResponse.json(
      { success: false, error: 'GROQ_API_KEY not found' },
      { status: 500 }
    )
  }

  const groq = new Groq({ apiKey })

  try {
    const body = await request.json()
    const { clientInfo, contentType, contentPillar, idea, quantity, competitorInsights } = body

    const maxByType: Record<string, number> = {
      'Long-form Script': 3,
      'Short-form Script': 10,
      'Carousel': 10,
      'Story Post': 10,
      'Engagement Reel': 10,
    }

    const defaultMax = 10
    const requested = quantity && quantity > 0 ? quantity : 1
    const maxForThisType = maxByType[contentType] ?? defaultMax
    const safeQuantity = Math.min(requested, maxForThisType)

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

## MUST-DOs – ALWAYS DO THIS
✅ ALWAYS start with a **pattern-interrupt hook** that:
   - States a surprising claim, painful truth, or bold promise, AND
   - Sets up a payoff that is only fully resolved near the end
✅ ALWAYS create **anticipation**:
   - Hint that something important is coming later
   - Do NOT reveal the full “secret” in the first 1–2 lines
✅ ALWAYS respect the selected **Content Type** and **Pillar** structure and length
✅ ALWAYS use concrete numbers, examples, micro-stories and step-by-step breakdowns
✅ ALWAYS sound like a smart friend talking directly to one person ("you"), not an announcer
✅ ALWAYS end with a **soft CTA** that feels natural, e.g.:
   - "Comment \\"GUIDE\\" and I’ll send you the full breakdown."
   - "Comment \\"SCRIPT\\" and I’ll DM you the exact template."
   - "Comment \\"CHECKLIST\\" if you want the full checklist."
✅ ALWAYS treat **every script in the batch** as if it’s the only one:
   - Full value, full depth, no lazy repetition

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
[Strong ending. Summarize key points. Soft CTA. Leave them inspired/motivated.]

📝 CAPTION:
[Hook + value promise + engagement question. 150-200 words.]

#️⃣ HASHTAGS:
[12-15 relevant hashtags mixing broad and niche]

====================`
    } else if (contentType === 'Short-form Script') {
      formatGuide = `
## OUTPUT FORMAT: SHORT-FORM SCRIPT (45-60 seconds each)
Create ${safeQuantity} punchy, complete scripts. Each must be fully written out.

Format each script EXACTLY like this:

===== SCRIPT #[NUMBER] =====

📌 TITLE: [Short, punchy title]

🎬 HOOK (0-3 sec):
[The exact words to say. MUST stop the scroll immediately. Bold, surprising, or pattern-interrupting.]

📍 BODY (3-45 sec):
[The complete script. One main point delivered powerfully. Include a specific example or story. Write every word they should say.]

🎯 CTA (45-60 sec):
[Soft call to action that feels natural. Never salesy.]

📱 TIKTOK CAPTION:
[Under 80 characters. Punchy and curiosity-inducing.]

📸 INSTAGRAM CAPTION:
[100-150 words. Hook + value + engagement question.]

#️⃣ HASHTAGS:
[8-10 relevant hashtags]

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
Create ${safeQuantity} story sequences designed for maximum engagement.

Format each sequence EXACTLY like this:

===== STORY SEQUENCE #[NUMBER] =====

📌 TOPIC: [What this story sequence is about]

STORY 1 - THE HOOK:
🎨 Visual: [Describe what's on screen]
📝 Text: [Bold hook text - max 8 words]
🎯 Sticker: [Poll, question, or quiz to drive engagement]

STORY 2 - THE VALUE:
🎨 Visual: [Describe what's on screen]
📝 Text: [The key insight or tip]
💡 Note: [Additional context if needed]

STORY 3 - THE CTA:
🎨 Visual: [Describe what's on screen]
📝 Text: [Call to action]
🔗 Link/Sticker: [What to include]

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

    const userPrompt = `## YOUR TASK
Create ${safeQuantity} ${contentType}(s) for this client.

## CLIENT CONTEXT
${clientInfo || 'Business professional helping clients succeed'}

${competitorInsights ? `## COMPETITOR INSIGHTS TO LEVERAGE
${competitorInsights}` : ''}

## CONTENT PILLAR
${contentPillar}

${idea ? `## SPECIFIC TOPIC/ANGLE
${idea}` : ''}

${formatGuide}

${formatGuide}

## CRITICAL REMINDERS
1. Each script must be **COMPLETE** and full-length – never cut corners, even on later scripts in the batch.
2. Use a **different hook and angle** for each script. No copy/paste, no “spinning” the same idea.
3. Sound like a **real person**, not a marketer or announcer.
4. Use specific **numbers, examples, and mini-stories** – not vague advice.
5. DO NOT copy any text or story word-for-word from the client context. Use it as inspiration only.
6. Never mention any company name in "at [company]" format.
7. Maintain the **same high quality** for ALL ${safeQuantity} scripts – later scripts must be just as strong.
8. End every script with a **soft, comment-based CTA** that feels natural ("Comment \\"WORD\\" and I’ll send you [X].").

Now create ${safeQuantity} exceptional ${contentType}(s) that people will actually want to watch until the end. GO!`

    const completion = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.85,
      max_tokens: 5000,
    })

    const content = completion.choices[0]?.message?.content

    if (!content) {
      return NextResponse.json(
        { success: false, error: 'No content generated. Please try again.' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true, content })

  } catch (error: any) {
    console.error('Generation Error:', error)

    const status = error?.status || error?.statusCode
    const message = error?.message || error?.error?.message || ''

    // Groq TPM / token-size style limits can come back as 413 or with code "rate_limit_exceeded"
    const isTokenLimit =
      status === 413 ||
      status === 429 ||
      (error?.error && error.error.code === 'rate_limit_exceeded') ||
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
      {
        success: false,
        error: message || 'Generation failed. Please try again.',
      },
      { status: 500 }
    )
  }
}