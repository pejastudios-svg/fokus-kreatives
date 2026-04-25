import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import type { FormQuestion } from '@/lib/types/questionForm'
import type { TopicPillar } from '@/lib/types/topics'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const AGENCY_NOTIFY_EMAIL = 'fokuskreatives@gmail.com'

interface Body {
  token?: string
  answers?: Record<string, string>
}

async function notifyAgency(
  req: NextRequest,
  clientId: string,
  clientName: string,
  businessName: string | null,
  count: number,
) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin
  const clientUrl = `${appUrl}/clients/${clientId}`

  try {
    const { data: teamUsers } = await supabase
      .from('users')
      .select('id')
      .neq('role', 'client')

    const userIds = (teamUsers || []).map((u) => u.id).filter(Boolean)
    if (userIds.length) {
      await fetch(`${appUrl}/api/notifications/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userIds,
          type: 'question_form_submitted',
          data: {
            clientId,
            clientName: businessName || clientName,
            count,
            url: clientUrl,
          },
        }),
      })
    }
  } catch (err) {
    console.error('question-form in-app notification error:', err)
  }

  try {
    const secret = process.env.APPS_SCRIPT_SECRET
    if (secret) {
      await fetch(`${appUrl}/api/notify-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'question_form_submitted',
          payload: {
            secret,
            to: [AGENCY_NOTIFY_EMAIL],
            clientName: clientName || 'A client',
            businessName: businessName || '',
            count,
            url: clientUrl,
          },
        }),
      })
    }
  } catch (err) {
    console.error('question-form email notification error:', err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body
    const token = body.token?.trim()
    const answers = body.answers || {}

    if (!token) {
      return NextResponse.json({ success: false, error: 'Missing token' }, { status: 400 })
    }

    const { data: form, error: lookupErr } = await supabase
      .from('question_forms')
      .select('id, client_id, questions')
      .eq('token', token)
      .maybeSingle()

    if (lookupErr || !form) {
      return NextResponse.json({ success: false, error: 'Invalid or expired link' }, { status: 404 })
    }

    const questions = (Array.isArray(form.questions) ? form.questions : []) as FormQuestion[]
    const questionMap = new Map<string, FormQuestion>()
    for (const q of questions) {
      if (q && typeof q.id === 'string') questionMap.set(q.id, q)
    }

    const rows: {
      client_id: string
      question: string
      answer: string
      pillar: TopicPillar
      source: 'form'
    }[] = []

    for (const [qid, rawAnswer] of Object.entries(answers)) {
      if (typeof rawAnswer !== 'string') continue
      const answer = rawAnswer.trim()
      if (!answer) continue
      const q = questionMap.get(qid)
      if (!q) continue
      rows.push({
        client_id: form.client_id,
        question: q.text,
        answer,
        pillar: q.pillar,
        source: 'form',
      })
    }

    if (!rows.length) {
      return NextResponse.json(
        { success: false, error: 'Please answer at least one question.' },
        { status: 400 },
      )
    }

    const { error: insertErr } = await supabase.from('topics').insert(rows)
    if (insertErr) {
      console.error('question-form submit insert error:', insertErr)
      return NextResponse.json({ success: false, error: 'Failed to save answers' }, { status: 500 })
    }

    const { error: updateErr } = await supabase
      .from('question_forms')
      .update({ submitted_at: new Date().toISOString() })
      .eq('id', form.id)

    if (updateErr) {
      console.error('question-form submit mark error:', updateErr)
    }

    const { data: client } = await supabase
      .from('clients')
      .select('name, business_name')
      .eq('id', form.client_id)
      .maybeSingle()

    notifyAgency(
      req,
      form.client_id,
      client?.name || 'A client',
      client?.business_name || null,
      rows.length,
    ).catch((e) => console.error('notifyAgency error:', e))

    return NextResponse.json({ success: true, saved: rows.length })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('question-form submit exception:', err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
