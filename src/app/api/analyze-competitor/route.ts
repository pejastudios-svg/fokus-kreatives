import { NextRequest, NextResponse } from 'next/server'
import Groq from 'groq-sdk'

export const dynamic = 'force-dynamic'

export interface CompetitorAnalysis {
  summary: string
  hook: {
    text: string
    rating: number
    why_it_works: string[]
    weaknesses: string[]
  }
  structure: {
    pillar: string
    pacing: string
    beats: { label: string; text: string }[]
  }
  cta: {
    text: string
    rating: number
    why_it_works: string[]
    weaknesses: string[]
  }
  voice: {
    tone: string
    notable_patterns: string[]
  }
  what_works: string[]
  what_doesnt_work: string[]
  takeaways_for_client: {
    hook_formulas: string[]
    cta_formulas: string[]
    structural_moves: string[]
    new_angles: string[]
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const asStringArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []

const asString = (v: unknown, fallback = ''): string =>
  typeof v === 'string' ? v : fallback

const asNumber = (v: unknown, fallback = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

function normalizeAnalysis(raw: unknown): CompetitorAnalysis {
  const r = isRecord(raw) ? raw : {}
  const hook = isRecord(r.hook) ? r.hook : {}
  const structure = isRecord(r.structure) ? r.structure : {}
  const cta = isRecord(r.cta) ? r.cta : {}
  const voice = isRecord(r.voice) ? r.voice : {}
  const takeaways = isRecord(r.takeaways_for_client) ? r.takeaways_for_client : {}
  const beats = Array.isArray(structure.beats)
    ? structure.beats
        .map((b) =>
          isRecord(b)
            ? { label: asString(b.label), text: asString(b.text) }
            : null,
        )
        .filter((b): b is { label: string; text: string } => !!b)
    : []

  return {
    summary: asString(r.summary),
    hook: {
      text: asString(hook.text),
      rating: asNumber(hook.rating),
      why_it_works: asStringArray(hook.why_it_works),
      weaknesses: asStringArray(hook.weaknesses),
    },
    structure: {
      pillar: asString(structure.pillar),
      pacing: asString(structure.pacing),
      beats,
    },
    cta: {
      text: asString(cta.text),
      rating: asNumber(cta.rating),
      why_it_works: asStringArray(cta.why_it_works),
      weaknesses: asStringArray(cta.weaknesses),
    },
    voice: {
      tone: asString(voice.tone),
      notable_patterns: asStringArray(voice.notable_patterns),
    },
    what_works: asStringArray(r.what_works),
    what_doesnt_work: asStringArray(r.what_doesnt_work),
    takeaways_for_client: {
      hook_formulas: asStringArray(takeaways.hook_formulas),
      cta_formulas: asStringArray(takeaways.cta_formulas),
      structural_moves: asStringArray(takeaways.structural_moves),
      new_angles: asStringArray(takeaways.new_angles),
    },
  }
}

export async function POST(request: NextRequest) {
  if (!process.env.GROQ_API_KEY) {
    return NextResponse.json(
      { success: false, error: 'API key not configured' },
      { status: 500 },
    )
  }

  try {
    const {
      competitorHandle,
      platform,
      clientNiche,
      sampleContent,
      videoTranscript,
    } = await request.json()

    const rawTranscript: string = (videoTranscript || sampleContent || '')
      .toString()
      .trim()

    if (!rawTranscript) {
      return NextResponse.json(
        {
          success: false,
          error: 'Please paste the competitor script or transcript - we break it down line by line.',
        },
        { status: 400 },
      )
    }

    const maxChars = 12000
    const transcript =
      rawTranscript.length > maxChars ? rawTranscript.slice(0, maxChars) : rawTranscript

    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

    const systemPrompt = `You are an elite social media analyst and content strategist. You break down high-performing scripts into a repeatable system the client can steal stylistically without copying.

You will receive a full script/transcript. Your job is to return a JSON object that breaks it down into:
1. What the script actually does (hook, structure, CTA, voice)
2. What works and what doesn't (honest critique)
3. Takeaways our client can plug into their own scripts right now - formulas, structural moves, new angles

Be specific. No generic advice like "be more engaging". Quote short snippets when useful, but never copy full sentences for the client to reuse. Rate hook and CTA on a 1-10 scale based on real-world stopping power and conversion likelihood.`

    const userPrompt = `## CONTEXT
Platform: ${platform || 'N/A'}
Competitor: ${competitorHandle || 'N/A'}
Client Niche: ${clientNiche || 'N/A'}

## SCRIPT / TRANSCRIPT
"""
${transcript}
"""

Return a JSON object with exactly this shape (no extra keys, no markdown, just JSON):

{
  "summary": "2-3 sentence plain-English summary of what this script is doing and who it's for.",
  "hook": {
    "text": "The exact hook line(s) used in the script.",
    "rating": 1-10,
    "why_it_works": ["bullet", "bullet"],
    "weaknesses": ["bullet", "bullet"]
  },
  "structure": {
    "pillar": "Educational | Storytelling | Authority | Series | Double Down | Hybrid (...)",
    "pacing": "1-2 sentences on how it moves (fast cuts, slow build, etc.)",
    "beats": [
      { "label": "Hook", "text": "what happens" },
      { "label": "Problem", "text": "what happens" },
      { "label": "Tension", "text": "what happens" },
      { "label": "Payoff", "text": "what happens" },
      { "label": "CTA", "text": "what happens" }
    ]
  },
  "cta": {
    "text": "Exact CTA used (or 'Implicit: ...' if none).",
    "rating": 1-10,
    "why_it_works": ["bullet"],
    "weaknesses": ["bullet"]
  },
  "voice": {
    "tone": "1-line description of tone/voice.",
    "notable_patterns": ["repeated phrases, stylistic moves"]
  },
  "what_works": ["5-8 specific things this script does well"],
  "what_doesnt_work": ["3-6 specific weaknesses, misses, or risks - be honest"],
  "takeaways_for_client": {
    "hook_formulas": ["5-8 new hook formulas inspired by this, NOT copied - written so the client can plug in their own topic"],
    "cta_formulas": ["5-8 CTA formulas in the same energy"],
    "structural_moves": ["3-5 structural moves (pacing, order, transitions) worth stealing"],
    "new_angles": ["3-5 fresh content angles our client could make in this style on their own topic"]
  }
}

Return ONLY the JSON. No preamble, no trailing commentary.`

    const completion = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.6,
      max_tokens: 4000,
      response_format: { type: 'json_object' },
    })

    const raw = completion.choices[0]?.message?.content || '{}'

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (e) {
      console.error('analyze-competitor parse error:', e, raw.slice(0, 500))
      return NextResponse.json(
        { success: false, error: 'AI returned an unparseable response - try again.' },
        { status: 500 },
      )
    }

    const analysis = normalizeAnalysis(parsed)

    return NextResponse.json({ success: true, analysis })
  } catch (error) {
    console.error('Analysis Error:', error)
    const msg = error instanceof Error ? error.message : 'Failed to analyze competitor'
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
