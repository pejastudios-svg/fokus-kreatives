import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

interface FormQuestionRow {
  id?: string
  text?: string
  pillar?: string
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const token = searchParams.get('token')

  if (!token) {
    return NextResponse.json({ success: false, error: 'Missing token' }, { status: 400 })
  }

  const { data: form, error } = await supabase
    .from('question_forms')
    .select('id, client_id, title, questions, submitted_at')
    .eq('token', token)
    .maybeSingle()

  if (error || !form) {
    return NextResponse.json({ success: false, error: 'Form not found' }, { status: 404 })
  }

  if (!form.submitted_at) {
    return NextResponse.json({ success: true, submitted: false, answers: [] })
  }

  const questions = (Array.isArray(form.questions) ? form.questions : []) as FormQuestionRow[]

  // Submission inserts one `topics` row per answered question with
  // `source='form'`. We re-join by matching question text - the schema
  // doesn't carry a form_id reference yet. A small risk if the same
  // question text repeats across forms for the same client; acceptable
  // for now since we filter by submission window.
  const submittedAt = new Date(form.submitted_at)
  const windowStart = new Date(submittedAt.getTime() - 5 * 60 * 1000).toISOString()
  const windowEnd = new Date(submittedAt.getTime() + 5 * 60 * 1000).toISOString()

  const { data: topicRows } = await supabase
    .from('topics')
    .select('question, answer, pillar')
    .eq('client_id', form.client_id)
    .eq('source', 'form')
    .gte('created_at', windowStart)
    .lte('created_at', windowEnd)

  const answerByQuestion = new Map<string, string>()
  for (const row of topicRows || []) {
    if (typeof row.question === 'string' && typeof row.answer === 'string') {
      answerByQuestion.set(row.question, row.answer)
    }
  }

  const answers = questions.map((q) => ({
    id: q.id,
    text: q.text || '',
    pillar: q.pillar || null,
    answer: answerByQuestion.get(q.text || '') || null,
  }))

  return NextResponse.json({
    success: true,
    submitted: true,
    title: form.title,
    submittedAt: form.submitted_at,
    answers,
  })
}
