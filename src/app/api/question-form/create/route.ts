import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'
import type { FormQuestion } from '@/lib/types/questionForm'
import type { TopicPillar } from '@/lib/types/topics'

export const dynamic = 'force-dynamic'

const supabase = createClient(
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
  questions?: FormQuestion[]
  pillars?: TopicPillar[]
}

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

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body
    const clientId = body.clientId?.trim()
    if (!clientId) {
      return NextResponse.json({ success: false, error: 'Missing clientId' }, { status: 400 })
    }

    const questions = sanitizeQuestions(body.questions)
    if (!questions.length) {
      return NextResponse.json({ success: false, error: 'No questions provided' }, { status: 400 })
    }

    const pillars = Array.isArray(body.pillars)
      ? body.pillars.filter((p): p is TopicPillar => (VALID_PILLARS as string[]).includes(p))
      : []

    const token = randomUUID()
    const title = typeof body.title === 'string' ? body.title.trim() : ''

    const { data, error } = await supabase
      .from('question_forms')
      .insert({
        client_id: clientId,
        token,
        title: title || null,
        questions,
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
