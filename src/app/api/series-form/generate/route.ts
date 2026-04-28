import { NextRequest, NextResponse } from 'next/server'
import { generateScript } from '@/lib/ai/provider'
import type { BrandProfile } from '@/components/clients/brandProfile'
import type {
  SeriesBeatType,
  SeriesFormat,
  SeriesFraming,
  SeriesLabel,
  SeriesQuestion,
} from '@/lib/types/seriesForm'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Body {
  clientProfile?: BrandProfile | null
  clientName?: string
  businessName?: string
  industry?: string | null
  title?: string
  framing?: SeriesFraming
  format?: SeriesFormat
  seriesLabel?: SeriesLabel
  seriesLength?: number
}

const VALID_BEAT_TYPES: SeriesBeatType[] = [
  'lesson',
  'story',
  'progress',
  'tip',
  'mistake',
  'win',
  'belief',
]

function clientContext(
  profile: BrandProfile | null,
  meta: { name?: string; business?: string; industry?: string | null },
): string {
  const lines: string[] = []
  if (meta.name) lines.push(`name: ${meta.name}`)
  if (meta.business) lines.push(`business: ${meta.business}`)
  if (meta.industry) lines.push(`industry: ${meta.industry}`)
  if (profile) {
    if (profile.business?.mission) lines.push(`mission: ${profile.business.mission}`)
    if (profile.business?.problem_solved)
      lines.push(`problem solved: ${profile.business.problem_solved}`)
    if (profile.business?.differentiation)
      lines.push(`differentiator: ${profile.business.differentiation}`)
    if (profile.business?.signature_offer)
      lines.push(`offer: ${profile.business.signature_offer}`)
    if (profile.audience?.work_roles) lines.push(`audience: ${profile.audience.work_roles}`)
    const pains = profile.audience?.pain_points?.filter(Boolean) || []
    if (pains.length) lines.push(`audience pain points: ${pains.join(' | ')}`)
    if (profile.audience?.fears) lines.push(`audience fears: ${profile.audience.fears}`)
    if (profile.audience?.desires) lines.push(`audience desires: ${profile.audience.desires}`)
    if (profile.audience?.objections)
      lines.push(`audience objections: ${profile.audience.objections}`)
    const evergreen = profile.content_strategy?.evergreen_topics?.filter(Boolean) || []
    if (evergreen.length) lines.push(`evergreen topics: ${evergreen.join(' | ')}`)
    const hot = profile.content_strategy?.hot_takes?.filter(Boolean) || []
    if (hot.length) lines.push(`hot takes: ${hot.join(' | ')}`)
    const myths = (profile.content_strategy?.myths || [])
      .filter((m) => m.myth || m.truth)
      .map((m) => `${m.myth} -> ${m.truth}`)
    if (myths.length) lines.push(`myths: ${myths.join(' | ')}`)
    if (profile.voice?.common_enemy)
      lines.push(`common enemy: ${profile.voice.common_enemy}`)
  }
  return lines.length ? lines.join('\n- ') : 'No additional context.'
}

function framingGuidance(framing: SeriesFraming): string {
  switch (framing) {
    case 'lessons':
      return 'LESSONS series - each entry teaches ONE specific lesson the creator learned through experience. Questions should pull out the moment they learned it, what changed, and how someone could use that lesson today. Beat type: mostly lesson, some story, occasional belief.'
    case 'progress':
      return 'PROGRESS-UPDATE series - the whole arc tracks one big goal. Each entry is a check-in: where are you now, what shifted today, what is the obstacle. Questions should pull progress moments, setbacks, breakthroughs. Beat type: mostly progress, some story, some win/mistake.'
    case 'challenge':
      return 'CHALLENGE series - the creator is doing something hard for N days. Each entry is a status update: what happened, what they tried, what they learned. Questions should pull the daily texture - the experiment, the result, the lesson. Beat type: mix of progress, mistake, win, and lesson.'
    case 'step-by-step':
      return 'STEP-BY-STEP series - each entry is one step in a tutorial that builds to a final outcome. Questions should pull the specific HOW for each step: what to do, why this step matters, what the common mistake is. Beat type: mostly tip and lesson, occasional mistake (what NOT to do).'
    case 'freeform':
    default:
      return 'FREEFORM series - the AI infers the throughline from the title. Spread question types across lesson, story, mistake, win, and belief so the series has texture.'
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function asInt(v: unknown, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.floor(v)
  if (typeof v === 'string') {
    const n = Number.parseInt(v, 10)
    if (Number.isFinite(n)) return n
  }
  return fallback
}

function normalizeQuestions(raw: unknown, length: number): SeriesQuestion[] {
  if (!isRecord(raw)) return []
  const list = Array.isArray(raw.questions) ? raw.questions : []
  const out: SeriesQuestion[] = []
  for (const item of list) {
    if (!isRecord(item)) continue
    const text = asString(item.text)
    if (!text) continue
    const entryIndex = asInt(item.entry_index, out.length + 1)
    const rawBeat = asString(item.beat_type).toLowerCase()
    const beat: SeriesBeatType = (VALID_BEAT_TYPES as string[]).includes(rawBeat)
      ? (rawBeat as SeriesBeatType)
      : 'story'
    const anchorField = asString(item.anchor_field) || undefined
    const anchorValue = asString(item.anchor_value) || undefined
    const placeholder = asString(item.placeholder) || undefined
    out.push({
      id: crypto.randomUUID(),
      text,
      entry_index: entryIndex,
      beat_type: beat,
      anchor_field: anchorField,
      anchor_value: anchorValue,
      placeholder,
    })
  }
  // Re-number sequentially in case the AI returned messy entry_index values
  return out
    .slice(0, length)
    .map((q, idx) => ({ ...q, entry_index: idx + 1 }))
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body
    const length = Math.max(1, Math.min(60, body.seriesLength ?? 30))
    const framing: SeriesFraming = body.framing || 'lessons'
    const seriesLabel: SeriesLabel = body.seriesLabel || 'Day'
    const title = (body.title || '').trim() || `${length} ${framing} series`
    const ctx = clientContext(body.clientProfile ?? null, {
      name: body.clientName,
      business: body.businessName,
      industry: body.industry,
    })

    const system = `You design series-intake questionnaires for content creators.

Your job: generate EXACTLY ${length} questions, ONE PER ENTRY, for a ${length}-${seriesLabel.toLowerCase()} series titled "${title}". Each answer becomes the RAW MATERIAL for that entry's script - the goal is to extract a SPECIFIC LIVED MOMENT (with story + lesson built in) from the client, not a generic "describe your business" answer.

${framingGuidance(framing)}

RULES FOR EVERY QUESTION:
- Specific and concrete. Targets ONE moment, ONE lesson, ONE shift.
- Designed to elicit 3-8 sentences of raw human story (not a one-liner, not an essay).
- Three-beat shape baked into the question: SCENE -> SHIFT -> LESSON. Example: "Tell me about a moment when [specific scenario]. What were you doing right before it shifted? What's the one thing someone could take from it today?"
- Anchored to ONE specific item from the CLIENT CONTEXT. Cite the field name and the exact value. NEVER ask a generic content-marketing question.
- No two questions point at the same anchor field+value.
- Vary the beat_type across the ${length} entries so the series has texture (don't make all 30 lessons; mix story, mistake, win, belief, progress).
- The questions must read like a thoughtful interviewer talking to a friend, not like a survey form.

ANCHOR FIELDS YOU CAN CITE (use the exact name in anchor_field):
- audience.pain_points (5 slots)
- audience.fears
- audience.desires
- audience.objections
- audience.tried_failed
- audience.yes_triggers
- business.problem_solved
- business.differentiation
- business.signature_offer
- business.mission
- voice.common_enemy
- content_strategy.evergreen_topics (5 slots)
- content_strategy.hot_takes (3 slots)
- content_strategy.myths (3 slots)

If the CLIENT CONTEXT is thin and you cannot anchor ${length} distinct questions, generate FEWER questions and tell the operator. Do not invent fake anchors. Do not pad with generic "what's your favourite tool" filler.`

    const user = `SERIES TITLE: ${title}
SERIES FRAMING: ${framing}
SERIES LENGTH: ${length}
ENTRY LABEL: ${seriesLabel}

CLIENT CONTEXT:
- ${ctx}

Return ONLY a JSON object with this exact shape (no prose, no markdown, no code fences):
{
  "questions": [
    {
      "entry_index": 1,
      "text": "the question, written in second person, 1-3 sentences, with the scene-shift-lesson shape baked in",
      "beat_type": "lesson | story | progress | tip | mistake | win | belief",
      "anchor_field": "exact field name from the list",
      "anchor_value": "the literal value from CLIENT CONTEXT this question is anchored to",
      "placeholder": "<70 chars hint of the kind of answer you expect"
    }
  ]
}

Generate questions for entry_index 1 through ${length}.`

    const { content: raw } = await generateScript({
      system,
      user,
      temperature: 0.65,
      maxTokens: 6000,
      jsonObject: true,
      // Question-generation is structured JSON. Flash gives us better instruction
      // following than Flash-Lite for the anchor discipline, but Pro is overkill.
      quality: 'standard',
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

    const questions = normalizeQuestions(parsed, length)
    if (!questions.length) {
      return NextResponse.json(
        { success: false, error: 'AI returned no questions - try again.' },
        { status: 500 },
      )
    }

    return NextResponse.json({
      success: true,
      questions,
      shortfall: questions.length < length ? length - questions.length : 0,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('series-form generate error:', err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
