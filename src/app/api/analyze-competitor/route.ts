import { NextRequest, NextResponse } from 'next/server'
import Groq from 'groq-sdk'

export async function POST(request: NextRequest) {
  if (!process.env.GROQ_API_KEY) {
    return NextResponse.json(
      { success: false, error: 'API key not configured' },
      { status: 500 }
    )
  }

  const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY,
  })

  try {
        const {
      competitorHandle,
      platform,
      clientNiche,
      sampleContent,
      videoTranscript,
    } = await request.json()

    // Combine transcript / sample content if provided
    const rawTranscript: string =
      (videoTranscript || sampleContent || '').toString().trim()

    let transcriptSection = ''
    if (rawTranscript) {
      // Hard cap to avoid huge prompts (roughly ~2000 tokens worth of text)
      const maxChars = 8000
      transcriptSection =
        rawTranscript.length > maxChars
          ? rawTranscript.slice(0, maxChars)
          : rawTranscript
    }

    const hasTranscript = transcriptSection.length > 0

    const systemPrompt = `You are an elite social media analyst and content strategist with 10+ years of experience breaking down viral content and turning it into repeatable systems.

## YOUR ROLE
You do two things:
1. **Analyze** high-performing social content: hooks, structure, pillar, CTA, style.
2. **Generate new ideas** inspired by that style, without copying.

## LIMITATIONS
You do NOT have live access to social feeds or APIs. You only see:
- The platform name
- The handle
- The niche
- (Optionally) pasted sample content or transcripts

When sample content/transcripts are provided:
- Treat THAT text as the ground truth for the analysis.
- Do NOT copy sentences or phrases word-for-word in your new ideas.
- Use it as inspiration for structure, pacing, hook style, and CTA style.

## STYLE
- Be concrete and specific.
- Avoid vague phrases like "create engaging content".
- Show hook **formulas + examples**.
- Show CTA **formulas + examples**.
- Focus on moves our client can **plug into content creation immediately**.
`

    let userPrompt: string

    if (hasTranscript) {
      // === TRANSCRIPT MODE ===
      userPrompt = `## CONTEXT

**Platform:** ${platform}
**Competitor Handle (if any):** ${competitorHandle || 'N/A'}
**Client Niche:** ${clientNiche}

We have a **high-performing video / piece of content** in this niche. Below is the pasted transcript or sample content (possibly truncated):

---

### SAMPLE CONTENT / TRANSCRIPT (TRUNCATED)
${transcriptSection}

---

Based on THIS text, provide the following:

### 1. HOOK ANALYSIS
- What is the actual hook they used?
- Where does the hook end and the main content begin?
- Why does this hook work psychologically (pattern interrupt, pain, curiosity, identity, etc.)?
- Give 5–10 **new hook formulas** inspired by this style that our client can use (but NOT copying exact wording).

### 2. STRUCTURE & PILLAR
- Step-by-step, how is this content structured from start to finish?
- Identify which **content pillar(s)** it fits: Educational, Storytelling, Authority, Series, Double Down (or a mix).
- Describe the narrative arc (problem → tension → payoff → CTA).

### 3. CTA + LEAD-GEN
- What is the CTA (explicit or implied) in this piece?
- How are they likely trying to move people to DM, comment, click, or opt-in?
- Suggest 5–10 **comment-based CTA formulas** that match this style (e.g. "Comment \\"WORD\\" and I'll send you...").

### 4. STYLE & VOICE NOTES
- Describe the tone and voice (casual, direct, vulnerable, etc.).
- Any repeated phrases, patterns, or stylistic moves worth noting?
- How does the pacing feel (fast cuts, build-up, punchy, etc.)?

### 5. NEW CONTENT IDEAS (INSPIRED, NOT COPIED)
Propose at least **5 new content concepts** inspired by this piece, with:

For each concept:
- A proposed **hook line** (1–2 lines)
- The **pillar** you recommend (Educational, Storytelling, etc.)
- The best **content type** (Long-form Script, Short-form Script, Carousel, Story Post, Engagement Reel)
- 1–2 sentence summary of what happens in the piece and how it ends.

Important:
- Do NOT reuse sentences or copy the original transcript.
- Keep the same **energy, pacing, and style**, but change the topic/angle enough that it feels fresh.`
    } else {
      // === HANDLE/NICHE MODE (NO TRANSCRIPT) ===
      userPrompt = `## COMPETITOR ANALYSIS REQUEST

**Platform:** ${platform}
**Competitor Handle:** ${competitorHandle || 'N/A'}
**Client Niche:** ${clientNiche}

We want to understand how this competitor (and similar top accounts in this niche) probably wins, and how our client can beat them.

Provide a structured analysis with the following sections:

---

### 1. ACCOUNT & NICHE OVERVIEW
- Based on the handle, platform, and niche, what type of content does this competitor likely publish?
- Who is their likely target audience (demographics, psychographics)?

---

### 2. HOOK PATTERNS (Give AT LEAST 10 specific hook formulas)
For each hook:
- Give a **formula-style example** that could be used in this niche
- Briefly explain **why** it works (psychology, pattern interrupt, curiosity, pain, etc.)

Format:
1. "Hook example" – Why it works: [short reasoning]

Focus on:
- Scroll-stoppers
- Pain + desire
- Identity-based hooks ("If you're a [ROLE]...")

---

### 3. CONTENT STRUCTURE & PILLARS
- What are the likely **content pillars** this competitor uses? (Educational, Storytelling, Authority, Series, Double Down, etc.)
- For each pillar:
  - Describe how it probably shows up in their content.
  - Give 2–3 example content ideas that fit that pillar.

---

### 4. CTA & LEAD-GEN STRATEGY
- What CTAs are likely working in this niche and platform?
- Give **10+ CTA formulas** that are:
  - Comment-based ("Comment 'WORD' if you want..."),
  - DM-based,
  - Soft, not pushy.
- Mention how they might be driving people to:
  - Lead magnets,
  - Calendly/booking links,
  - DMs, etc.

---

### 5. POSTING & FORMATS
- Which formats are likely their top performers (shorts/reels, carousels, stories, long-form)?
- What posting frequency likely works best in this niche?
- Any observations about:
  - Length,
  - Editing style,
  - Thumbnails/covers,
  - Use of text on screen?

---

### 6. GAPS & OPPORTUNITIES (HIGH VALUE)
This is the **most important** section.

- What are the **most common mistakes** and missed angles accounts in this niche usually have?
- Where are the likely **content gaps** this competitor is leaving open?
- How can our client **differentiate**, for example:
  - Stronger hooks,
  - Deeper stories,
  - More concrete frameworks,
  - Better, more modern CTAs,
  - Clearer lead-gen flow?

List at least 5–7 **specific, actionable moves** our client can make to beat this competitor.

---

Be extremely specific. Give real example hooks, content ideas, and CTAs that our client can plug into content creation immediately.`
    }

    const completion = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      model: 'llama-3.3-70b-versatile',
      temperature: hasTranscript ? 0.7 : 0.65,
      max_tokens: 4000,
    })

    const analysis = completion.choices[0]?.message?.content || ''

    return NextResponse.json({ 
      success: true, 
      analysis 
    })

  } catch (error) {
    console.error('Analysis Error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to analyze competitor' },
      { status: 500 }
    )
  }
}