import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'
import type { FormTopic } from '@/lib/types/questionForm'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// Mirror of the helper in /api/question-form/submit so revisit answers
// link back to the same topic_group_id without a runtime lookup table.
function topicGroupIdFor(formId: string, topicId: string): string {
  const h = createHash('sha256').update(`${formId}:${topicId}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const token = searchParams.get('token')

  if (!token) {
    return NextResponse.json({ success: false, error: 'Missing token' }, { status: 400 })
  }

  const { data: form, error } = await supabase
    .from('question_forms')
    .select('id, client_id, title, questions, topics, pillars, submitted_at, created_at')
    .eq('token', token)
    .maybeSingle()

  if (error || !form) {
    return NextResponse.json({ success: false, error: 'Invalid or expired link' }, { status: 404 })
  }

  const { data: client } = await supabase
    .from('clients')
    .select('id, name, business_name, profile_picture_url, industry')
    .eq('id', form.client_id)
    .maybeSingle()

  const formTopics = (Array.isArray(form.topics) ? form.topics : []) as FormTopic[]
  const isTopicForm = formTopics.length > 0

  // Pre-fill answers on revisit. For topic forms we look up rows by
  // topic_group_id (deterministic via the helper above); for legacy forms
  // we match by question text inside the submission window.
  let topicAnswers: Record<string, Record<string, string>> = {}
  let thinFlags: Record<string, boolean> = {}
  let answers: Record<string, string> = {}

  if (form.submitted_at && isTopicForm) {
    const groupIds = formTopics.map((t) => topicGroupIdFor(form.id, t.id))
    const { data: rows } = await supabase
      .from('topics')
      .select('answer, input_type, thin_flag, topic_group_id')
      .eq('client_id', form.client_id)
      .eq('source', 'form')
      .in('topic_group_id', groupIds)

    const byGroupAndType = new Map<string, { answer: string; thin_flag: boolean }>()
    for (const r of rows || []) {
      if (!r.topic_group_id || !r.input_type) continue
      byGroupAndType.set(`${r.topic_group_id}:${r.input_type}`, {
        answer: r.answer || '',
        thin_flag: !!r.thin_flag,
      })
    }

    topicAnswers = {}
    thinFlags = {}
    for (const t of formTopics) {
      const gid = topicGroupIdFor(form.id, t.id)
      const perTopic: Record<string, string> = {}
      for (const q of t.questions) {
        const hit = byGroupAndType.get(`${gid}:${q.input_type}`)
        if (hit) {
          perTopic[q.id] = hit.answer
          if (hit.thin_flag) thinFlags[q.id] = true
        }
      }
      if (Object.keys(perTopic).length) topicAnswers[t.id] = perTopic
    }
  } else if (form.submitted_at && !isTopicForm) {
    // Legacy form: revisit pre-fill via the existing question-text match
    // window. Same heuristic as /api/question-form/answers.
    const submittedAt = new Date(form.submitted_at)
    const windowStart = new Date(submittedAt.getTime() - 5 * 60 * 1000).toISOString()
    const windowEnd = new Date(submittedAt.getTime() + 5 * 60 * 1000).toISOString()
    const { data: topicRows } = await supabase
      .from('topics')
      .select('question, answer, thin_flag')
      .eq('client_id', form.client_id)
      .eq('source', 'form')
      .gte('created_at', windowStart)
      .lte('created_at', windowEnd)
    const byText = new Map<string, { answer: string; thin: boolean }>()
    for (const r of topicRows || []) {
      if (typeof r.question === 'string' && typeof r.answer === 'string') {
        byText.set(r.question, { answer: r.answer, thin: !!r.thin_flag })
      }
    }
    const questions = Array.isArray(form.questions) ? form.questions : []
    answers = {}
    thinFlags = {}
    for (const q of questions) {
      if (!q || typeof q !== 'object') continue
      const id = (q as { id?: string }).id
      const text = (q as { text?: string }).text
      if (!id || !text) continue
      const hit = byText.get(text)
      if (hit) {
        answers[id] = hit.answer
        if (hit.thin) thinFlags[id] = true
      }
    }
  }

  return NextResponse.json({
    success: true,
    form: {
      id: form.id,
      title: form.title,
      questions: isTopicForm ? [] : form.questions,
      topics: formTopics,
      pillars: form.pillars,
      already_submitted: !!form.submitted_at,
    },
    client: client || null,
    // Only present on revisit of a previously submitted form.
    prefill: form.submitted_at
      ? { answers, topicAnswers, thinFlags }
      : null,
  })
}
