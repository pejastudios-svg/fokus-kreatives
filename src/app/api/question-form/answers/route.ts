import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'
import type { FormTopic } from '@/lib/types/questionForm'

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
    .select('id, client_id, title, questions, topics, submitted_at')
    .eq('token', token)
    .maybeSingle()

  if (error || !form) {
    return NextResponse.json({ success: false, error: 'Form not found' }, { status: 404 })
  }

  if (!form.submitted_at) {
    return NextResponse.json({ success: true, submitted: false, answers: [], topics: [] })
  }

  const formTopics = (Array.isArray(form.topics) ? form.topics : []) as FormTopic[]
  const isTopicForm = formTopics.length > 0

  if (isTopicForm) {
    // Look up answers by topic_group_id (deterministic). Returns the
    // grouped shape expected by the M2 viewer.
    const groupIds = formTopics.map((t) => topicGroupIdFor(form.id, t.id))
    const { data: rows } = await supabase
      .from('topics')
      .select('answer, input_type, thin_flag, topic_group_id, group_position, audio_url')
      .eq('client_id', form.client_id)
      .eq('source', 'form')
      .in('topic_group_id', groupIds)

    const byGroup = new Map<
      string,
      Array<{
        input_type: string
        answer: string
        thin_flag: boolean
        group_position: number | null
        audio_url: string | null
      }>
    >()
    for (const r of rows || []) {
      if (!r.topic_group_id) continue
      const list = byGroup.get(r.topic_group_id) || []
      list.push({
        input_type: r.input_type || 'untyped',
        answer: r.answer || '',
        thin_flag: !!r.thin_flag,
        group_position: r.group_position ?? null,
        audio_url: r.audio_url ?? null,
      })
      byGroup.set(r.topic_group_id, list)
    }

    const topicsOut = formTopics.map((t) => {
      const gid = topicGroupIdFor(form.id, t.id)
      const stored = byGroup.get(gid) || []
      const byType = new Map<string, { answer: string; thin_flag: boolean; audio_url: string | null }>()
      for (const s of stored)
        byType.set(s.input_type, { answer: s.answer, thin_flag: s.thin_flag, audio_url: s.audio_url })

      const questions = t.questions.map((q) => {
        const hit = byType.get(q.input_type)
        return {
          id: q.id,
          input_type: q.input_type,
          text: q.text,
          answer: hit?.answer ?? null,
          thin_flag: hit?.thin_flag ?? false,
          audio_url: hit?.audio_url ?? null,
        }
      })

      return {
        id: t.id,
        title: t.title,
        pillar_hint: t.pillar_hint,
        questions,
        thin_count: questions.filter((q) => q.thin_flag).length,
      }
    })

    return NextResponse.json({
      success: true,
      submitted: true,
      isTopicForm: true,
      title: form.title,
      submittedAt: form.submitted_at,
      topics: topicsOut,
      // legacy field stays so callers expecting `answers` don't break.
      answers: [],
    })
  }

  // Legacy path - flat questions matched by text inside the submission window.
  const questions = (Array.isArray(form.questions) ? form.questions : []) as FormQuestionRow[]
  const submittedAt = new Date(form.submitted_at)
  const windowStart = new Date(submittedAt.getTime() - 5 * 60 * 1000).toISOString()
  const windowEnd = new Date(submittedAt.getTime() + 5 * 60 * 1000).toISOString()

  const { data: topicRows } = await supabase
    .from('topics')
    .select('question, answer, pillar, thin_flag, audio_url')
    .eq('client_id', form.client_id)
    .eq('source', 'form')
    .gte('created_at', windowStart)
    .lte('created_at', windowEnd)

  const answerByQuestion = new Map<
    string,
    { answer: string; thin_flag: boolean; audio_url: string | null }
  >()
  for (const row of topicRows || []) {
    if (typeof row.question === 'string' && typeof row.answer === 'string') {
      answerByQuestion.set(row.question, {
        answer: row.answer,
        thin_flag: !!row.thin_flag,
        audio_url: row.audio_url ?? null,
      })
    }
  }

  const answers = questions.map((q) => {
    const hit = answerByQuestion.get(q.text || '')
    return {
      id: q.id,
      text: q.text || '',
      pillar: q.pillar || null,
      answer: hit?.answer ?? null,
      thin_flag: hit?.thin_flag ?? false,
      audio_url: hit?.audio_url ?? null,
    }
  })

  return NextResponse.json({
    success: true,
    submitted: true,
    isTopicForm: false,
    title: form.title,
    submittedAt: form.submitted_at,
    topics: [],
    answers,
  })
}
