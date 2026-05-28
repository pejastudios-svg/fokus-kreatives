import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { randomUUID } from 'crypto'
import type {
  SeriesFormat,
  SeriesFraming,
  SeriesLabel,
  SeriesQuestion,
  SeriesBeatType,
} from '@/lib/types/seriesForm'

export const dynamic = 'force-dynamic'

const admin = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const VALID_LABELS: SeriesLabel[] = ['Day', 'Part', 'Episode', 'Chapter', 'Lesson']
const VALID_FORMATS: SeriesFormat[] = [
  'longform',
  'short',
  'carousel',
  'engagement',
  'story',
]
const VALID_FRAMINGS: SeriesFraming[] = [
  'lessons',
  'progress',
  'challenge',
  'step-by-step',
  'freeform',
]
const VALID_BEAT_TYPES: SeriesBeatType[] = [
  'lesson',
  'story',
  'progress',
  'tip',
  'mistake',
  'win',
  'belief',
]

interface Body {
  clientId?: string
  title?: string
  seriesLabel?: SeriesLabel
  seriesLength?: number
  format?: SeriesFormat
  framing?: SeriesFraming
  brandLine?: string | null
  ctaText?: string | null
  questions?: SeriesQuestion[]
}

function sanitizeQuestions(raw: unknown): SeriesQuestion[] {
  if (!Array.isArray(raw)) return []
  const out: SeriesQuestion[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const q = item as Record<string, unknown>
    const text = typeof q.text === 'string' ? q.text.trim() : ''
    if (!text) continue
    const rawBeat = typeof q.beat_type === 'string' ? q.beat_type.toLowerCase() : ''
    const beat: SeriesBeatType = (VALID_BEAT_TYPES as string[]).includes(rawBeat)
      ? (rawBeat as SeriesBeatType)
      : 'story'
    const isIntro = q.is_intro === true
    const entryIndex = isIntro
      ? 0
      : typeof q.entry_index === 'number' && Number.isFinite(q.entry_index)
        ? Math.max(1, Math.floor(q.entry_index))
        : out.length + 1
    out.push({
      id: typeof q.id === 'string' && q.id ? q.id : randomUUID(),
      text,
      entry_index: entryIndex,
      beat_type: beat,
      anchor_field: typeof q.anchor_field === 'string' ? q.anchor_field : undefined,
      anchor_value: typeof q.anchor_value === 'string' ? q.anchor_value : undefined,
      placeholder: typeof q.placeholder === 'string' ? q.placeholder : undefined,
      ...(isIntro ? { is_intro: true } : {}),
    })
  }
  return out
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
    }

    const { data: me } = await supabase.from('users').select('role').eq('id', user.id).single()
    if (me?.role !== 'admin' && me?.role !== 'manager') {
      return NextResponse.json({ success: false, error: 'Admins or managers only' }, { status: 403 })
    }

    const body = (await req.json()) as Body
    const clientId = body.clientId?.trim()
    if (!clientId) {
      return NextResponse.json({ success: false, error: 'Missing clientId' }, { status: 400 })
    }

    const questions = sanitizeQuestions(body.questions)
    if (!questions.length) {
      return NextResponse.json(
        { success: false, error: 'No questions provided' },
        { status: 400 },
      )
    }

    const title = (body.title || '').trim()
    if (!title) {
      return NextResponse.json(
        { success: false, error: 'Series needs a title (e.g. "30 lessons by 30")' },
        { status: 400 },
      )
    }

    const seriesLabel: SeriesLabel = VALID_LABELS.includes(body.seriesLabel as SeriesLabel)
      ? (body.seriesLabel as SeriesLabel)
      : 'Day'
    const format: SeriesFormat = VALID_FORMATS.includes(body.format as SeriesFormat)
      ? (body.format as SeriesFormat)
      : 'short'
    const framing: SeriesFraming = VALID_FRAMINGS.includes(body.framing as SeriesFraming)
      ? (body.framing as SeriesFraming)
      : 'freeform'

    // series_length counts the per-day entries only - the intro is separate.
    const dayCount = questions.filter((q) => !q.is_intro).length
    const seriesLength = Math.max(
      1,
      Math.min(60, body.seriesLength ?? dayCount),
    )

    const token = randomUUID()

    const { data, error } = await admin
      .from('series_forms')
      .insert({
        client_id: clientId,
        token,
        title,
        series_label: seriesLabel,
        series_length: seriesLength,
        format,
        framing,
        brand_line: body.brandLine?.trim() || null,
        cta_text: body.ctaText?.trim() || null,
        questions,
      })
      .select('id, token')
      .single()

    if (error || !data) {
      console.error('series-form create error:', error)
      return NextResponse.json({ success: false, error: 'Failed to save form' }, { status: 500 })
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin
    const url = `${appUrl}/series/${data.token}`

    return NextResponse.json({ success: true, id: data.id, token: data.token, url })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('series-form create exception:', err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
