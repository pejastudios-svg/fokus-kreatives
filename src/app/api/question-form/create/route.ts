import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { randomUUID } from 'crypto'
import type {
  FormQuestion,
  FormTopic,
  FormTopicQuestion,
  TopicInputType,
} from '@/lib/types/questionForm'
import type { TopicPillar } from '@/lib/types/topics'

export const dynamic = 'force-dynamic'

const admin = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const VALID_PILLARS: TopicPillar[] = [
  'educational',
  'storytelling',
  'authority',
  'series',
  'doubledown',
]

interface Body {
  clientId?: string
  title?: string | null
  // Legacy flat-question shape - still accepted for forms not using the
  // 5-question topic flow.
  questions?: FormQuestion[]
  // M2 topic-group shape. When present (and non-empty) the form is saved
  // as a topic form and the legacy `questions` column is left empty.
  topics?: FormTopic[]
  pillars?: TopicPillar[]
}

const VALID_INPUT_TYPES: TopicInputType[] = [
  'scene',
  'failed_attempt',
  'turning_point',
  'framework',
  'proof',
  'opinion',
  'named_mentor',
  'win_moment',
]

function sanitizeQuestions(raw: unknown): FormQuestion[] {
  if (!Array.isArray(raw)) return []
  const out: FormQuestion[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const q = item as Record<string, unknown>
    const text = typeof q.text === 'string' ? q.text.trim() : ''
    if (!text) continue
    const rawPillar = typeof q.pillar === 'string' ? q.pillar.toLowerCase() : ''
    const pillar: TopicPillar = (VALID_PILLARS as string[]).includes(rawPillar)
      ? (rawPillar as TopicPillar)
      : 'educational'
    const placeholder = typeof q.placeholder === 'string' ? q.placeholder.trim() : ''
    out.push({
      id: typeof q.id === 'string' && q.id ? q.id : randomUUID(),
      text,
      pillar,
      placeholder: placeholder || undefined,
    })
  }
  return out
}

function sanitizeTopics(raw: unknown): FormTopic[] {
  if (!Array.isArray(raw)) return []
  const out: FormTopic[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const t = item as Record<string, unknown>
    const title = typeof t.title === 'string' ? t.title.trim() : ''
    if (!title) continue
    const rawPillar = typeof t.pillar_hint === 'string' ? t.pillar_hint.toLowerCase() : ''
    const pillarHint: TopicPillar = (VALID_PILLARS as string[]).includes(rawPillar)
      ? (rawPillar as TopicPillar)
      : 'storytelling'

    const rawQs = Array.isArray(t.questions) ? t.questions : []
    const questions: FormTopicQuestion[] = []
    for (const qRaw of rawQs) {
      if (!qRaw || typeof qRaw !== 'object') continue
      const q = qRaw as Record<string, unknown>
      const text = typeof q.text === 'string' ? q.text.trim() : ''
      if (!text) continue
      const rawType = typeof q.input_type === 'string' ? q.input_type : ''
      if (!(VALID_INPUT_TYPES as string[]).includes(rawType)) continue
      const placeholder = typeof q.placeholder === 'string' ? q.placeholder.trim() : ''
      questions.push({
        id: typeof q.id === 'string' && q.id ? q.id : randomUUID(),
        input_type: rawType as TopicInputType,
        text,
        placeholder: placeholder || undefined,
      })
    }
    if (!questions.length) continue

    out.push({
      id: typeof t.id === 'string' && t.id ? t.id : randomUUID(),
      title,
      pillar_hint: pillarHint,
      questions,
    })
  }
  return out
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
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

    const topics = sanitizeTopics(body.topics)
    const questions = topics.length ? [] : sanitizeQuestions(body.questions)

    if (!topics.length && !questions.length) {
      return NextResponse.json(
        { success: false, error: 'Provide either topics or questions' },
        { status: 400 },
      )
    }

    const pillars = Array.isArray(body.pillars)
      ? body.pillars.filter((p): p is TopicPillar => (VALID_PILLARS as string[]).includes(p))
      : []

    const token = randomUUID()
    const title = typeof body.title === 'string' ? body.title.trim() : ''

    const { data, error } = await admin
      .from('question_forms')
      .insert({
        client_id: clientId,
        token,
        title: title || null,
        questions,
        topics,
        pillars,
      })
      .select('id, token')
      .single()

    if (error || !data) {
      console.error('question-form create error:', error)
      return NextResponse.json({ success: false, error: 'Failed to save form' }, { status: 500 })
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin
    const url = `${appUrl}/questions/${data.token}`

    return NextResponse.json({ success: true, id: data.id, token: data.token, url })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('question-form create exception:', err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
