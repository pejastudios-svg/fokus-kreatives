import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import type { SeriesQuestion } from '@/lib/types/seriesForm'
import { getAgencyRecipientsForClient } from '@/lib/clientRecipients'

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
  seriesTitle: string,
  count: number,
) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin
  const clientUrl = `${appUrl}/clients/${clientId}`

  const recipients = await getAgencyRecipientsForClient(supabase, clientId)
  const userIds = recipients.map((r) => r.id).filter(Boolean)
  const emails = recipients.map((r) => r.email).filter((e): e is string => Boolean(e))

  try {
    if (userIds.length) {
      await fetch(`${appUrl}/api/notifications/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userIds,
          type: 'series_form_submitted',
          data: {
            clientId,
            clientName: businessName || clientName,
            seriesTitle,
            count,
            url: clientUrl,
          },
        }),
      })
    }
  } catch (err) {
    console.error('series-form in-app notification error:', err)
  }

  try {
    const secret = process.env.APPS_SCRIPT_SECRET
    if (secret) {
      const to = emails.length
        ? Array.from(new Set([...emails, AGENCY_NOTIFY_EMAIL]))
        : [AGENCY_NOTIFY_EMAIL]
      await fetch(`${appUrl}/api/notify-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'series_form_submitted',
          payload: {
            secret,
            to,
            clientName: clientName || 'A client',
            businessName: businessName || '',
            seriesTitle,
            count,
            url: clientUrl,
          },
        }),
      })
    }
  } catch (err) {
    console.error('series-form email notification error:', err)
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
      .from('series_forms')
      .select('id, client_id, title, questions')
      .eq('token', token)
      .maybeSingle()

    if (lookupErr || !form) {
      return NextResponse.json({ success: false, error: 'Invalid or expired link' }, { status: 404 })
    }

    const questions = (Array.isArray(form.questions) ? form.questions : []) as SeriesQuestion[]
    const questionMap = new Map<string, SeriesQuestion>()
    for (const q of questions) {
      if (q && typeof q.id === 'string') questionMap.set(q.id, q)
    }

    const rows: {
      series_form_id: string
      client_id: string
      question_id: string
      question_text: string
      entry_index: number
      answer: string
    }[] = []

    for (const [qid, rawAnswer] of Object.entries(answers)) {
      if (typeof rawAnswer !== 'string') continue
      const answer = rawAnswer.trim()
      if (!answer) continue
      const q = questionMap.get(qid)
      if (!q) continue
      rows.push({
        series_form_id: form.id,
        client_id: form.client_id,
        question_id: qid,
        question_text: q.text,
        entry_index: q.entry_index,
        answer,
      })
    }

    if (!rows.length) {
      return NextResponse.json(
        { success: false, error: 'Please answer at least one question.' },
        { status: 400 },
      )
    }

    // Replace any prior answers for this form so resubmits don't dupe.
    const { error: clearErr } = await supabase
      .from('series_answers')
      .delete()
      .eq('series_form_id', form.id)
    if (clearErr) {
      console.error('series-form clear prior answers error:', clearErr)
    }

    const { error: insertErr } = await supabase.from('series_answers').insert(rows)
    if (insertErr) {
      console.error('series-form submit insert error:', insertErr)
      return NextResponse.json(
        { success: false, error: 'Failed to save answers' },
        { status: 500 },
      )
    }

    const { error: updateErr } = await supabase
      .from('series_forms')
      .update({ submitted_at: new Date().toISOString() })
      .eq('id', form.id)

    if (updateErr) {
      console.error('series-form submit mark error:', updateErr)
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
      form.title || 'Series',
      rows.length,
    ).catch((e) => console.error('series notifyAgency error:', e))

    return NextResponse.json({ success: true, saved: rows.length })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('series-form submit exception:', err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
