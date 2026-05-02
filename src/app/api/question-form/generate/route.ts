import { NextRequest, NextResponse } from 'next/server'
import type { BrandProfile } from '@/components/clients/brandProfile'
import type { TopicPillar } from '@/lib/types/topics'
import type { FormQuestion } from '@/lib/types/questionForm'
import { generateScript } from '@/lib/ai/provider'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Body {
  clientProfile?: BrandProfile | null
  clientName?: string
  businessName?: string
  industry?: string
  pillars?: TopicPillar[]
  count?: number
}

const VALID_PILLARS: TopicPillar[] = [
  'educational',
  'storytelling',
  'authority',
  'series',
  'doubledown',
]

function normalizePillars(input: TopicPillar[] | undefined): TopicPillar[] {
  if (!input || !input.length) return ['educational', 'storytelling', 'authority']
  const cleaned = input.filter((p) => VALID_PILLARS.includes(p))
  return cleaned.length ? cleaned : ['educational', 'storytelling', 'authority']
}

function clientContext(profile: BrandProfile | null, name?: string, business?: string, industry?: string): string {
  const lines: string[] = []
  if (name) lines.push(`name: ${name}`)
  if (business) lines.push(`business: ${business}`)
  if (industry) lines.push(`industry: ${industry}`)
  if (profile) {
    if (profile.business?.mission) lines.push(`mission: ${profile.business.mission}`)
    if (profile.business?.problem_solved) lines.push(`problem solved: ${profile.business.problem_solved}`)
    if (profile.business?.differentiation) lines.push(`differentiator: ${profile.business.differentiation}`)
    if (profile.business?.signature_offer) lines.push(`offer: ${profile.business.signature_offer}`)
    if (profile.audience?.work_roles) lines.push(`audience: ${profile.audience.work_roles}`)
    const pains = profile.audience?.pain_points?.filter(Boolean) || []
    if (pains.length) lines.push(`audience pain points: ${pains.join(' | ')}`)
    const desires = profile.audience?.desires
    if (desires) lines.push(`audience desires: ${desires}`)
  }
  return lines.length ? lines.join('\n- ') : 'No additional context.'
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function normalizeQuestions(raw: unknown, allowedPillars: TopicPillar[]): FormQuestion[] {
  if (!isRecord(raw)) return []
  const list = Array.isArray(raw.questions) ? raw.questions : []
  const out: FormQuestion[] = []
  for (const item of list) {
    if (!isRecord(item)) continue
    const text = asString(item.text) || asString(item.question)
    if (!text) continue
    const rawPillar = asString(item.pillar).toLowerCase()
    const pillar: TopicPillar = (allowedPillars as string[]).includes(rawPillar)
      ? (rawPillar as TopicPillar)
      : allowedPillars[0]
    const placeholder = asString(item.placeholder) || asString(item.hint) || undefined
    out.push({
      id: crypto.randomUUID(),
      text,
      pillar,
      placeholder,
    })
  }
  return out
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body
    const pillars = normalizePillars(body.pillars)
    const count = Math.min(100, Math.max(1, body.count ?? 12))
    const ctx = clientContext(body.clientProfile ?? null, body.clientName, body.businessName, body.industry)

    const system = `You design short-answer braindump forms for content creators.

Your job: generate ${count} questions whose answers become RAW MATERIAL for scripts (long-form, short-form, carousels, reels, stories). Every answer should be a specific story, hot take, experience, mistake, win, or insight the AI can turn into a real script - NOT generic "describe your brand" fluff.

Rules for every question:
- Specific and concrete. Avoid "tell me about your business" style.
- Extracts a STORY, MOMENT, BELIEF, MISTAKE, CONTRARIAN TAKE, WIN, or FRAMEWORK.
- Designed to produce an answer of 2–6 sentences, not a one-liner.
- Uses the client's own context (name, audience, niche, pains).
- Each question is tagged with ONE pillar from the allowed list below.
- Spread questions across the allowed pillars roughly evenly.

Pillar guidance:
- educational: questions that pull out a tip, framework, process, lesson they teach.
- storytelling: questions that pull out a specific scene/moment/journey from their own life.
- authority: questions that pull out case studies, transformations, proof, specific results.
- series: questions that set up a multi-day arc (day 1 … day N of X).
- doubledown: questions about a piece of content / hook / structure that already performed - something they want to replicate.

ALLOWED PILLARS: ${pillars.join(', ')}`

    const user = `CLIENT CONTEXT:
- ${ctx}

Return ONLY a JSON object with this exact shape (no prose, no markdown):
{
  "questions": [
    {
      "text": "the question, written directly to the client in second person",
      "pillar": "one of: ${pillars.join(' | ')}",
      "placeholder": "a short hint of the kind of answer you expect (optional, <80 chars)"
    }
  ]
}

Generate exactly ${count} questions.`

    const { content: raw } = await generateScript({
      system,
      user,
      temperature: 0.7,
      maxTokens: 2200,
      jsonObject: true,
      // Question-form generation is mechanical structured-JSON — Flash-Lite
      // is plenty here and ~30x cheaper than Pro on the same input.
      quality: 'cheap',
    })
    let parsed: unknown
    try {
      parsed = JSON.parse(raw || '{}')
    } catch {
      return NextResponse.json(
        { success: false, error: 'AI returned unparseable output - try again.' },
        { status: 500 },
      )
    }

    const questions = normalizeQuestions(parsed, pillars)
    if (!questions.length) {
      return NextResponse.json(
        { success: false, error: 'AI returned no questions - try again.' },
        { status: 500 },
      )
    }

    return NextResponse.json({ success: true, questions })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('question-form generate error:', err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
