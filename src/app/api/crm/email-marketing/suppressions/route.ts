// Suppression list (unsubscribed / bounced / manual do-not-email).
//
// GET    ?clientId=...      -> list with the email that triggered each one
// POST   { clientId, email }            manual suppression
// DELETE { clientId, id }               resubscribe (manual, deliberate)

import { NextRequest, NextResponse } from 'next/server'
import { admin } from '@/lib/emailOutbox'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const clientId = new URL(req.url).searchParams.get('clientId')
  if (!clientId) {
    return NextResponse.json({ success: false, error: 'Missing clientId' }, { status: 400 })
  }
  const { authorizeForClient } = await import('@/lib/crm/teamAuth')
  const auth = await authorizeForClient(clientId, { level: 'member' })
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
  }
  const db = admin()

  const { data: rows, error } = await db
    .from('email_suppressions')
    .select('id, email, reason, source_send_id, created_at')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
  if (error) {
    return NextResponse.json({ success: false, error: 'Could not load' }, { status: 500 })
  }

  // "Unsubscribed from <email subject>" context for the UI.
  const sendIds = (rows || []).map((r) => r.source_send_id).filter(Boolean) as string[]
  const subjectBySend = new Map<string, string>()
  if (sendIds.length > 0) {
    const { data: sends } = await db
      .from('email_campaign_sends')
      .select('id, email_id')
      .in('id', sendIds)
    const emailIds = (sends || []).map((s) => s.email_id as string)
    const { data: emails } = emailIds.length
      ? await db.from('email_campaign_emails').select('id, subject').in('id', emailIds)
      : { data: [] as Array<{ id: string; subject: string }> }
    const subjectByEmail = new Map((emails || []).map((e) => [e.id as string, e.subject as string]))
    for (const s of sends || []) {
      subjectBySend.set(s.id as string, subjectByEmail.get(s.email_id as string) || '')
    }
  }

  return NextResponse.json({
    success: true,
    suppressions: (rows || []).map((r) => ({
      ...r,
      source_subject: r.source_send_id ? subjectBySend.get(r.source_send_id as string) || '' : '',
    })),
  })
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { clientId?: string; email?: string }
    const clientId = body.clientId
    const email = (body.email || '').trim().toLowerCase()
    if (!clientId || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ success: false, error: 'Need a clientId and valid email' }, { status: 400 })
    }
    const { authorizeForClient } = await import('@/lib/crm/teamAuth')
    const auth = await authorizeForClient(clientId, { level: 'manager' })
    if (!auth.ok) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
    }
    const { error } = await admin()
      .from('email_suppressions')
      .upsert(
        { client_id: clientId, email, reason: 'manual' },
        { onConflict: 'client_id,email', ignoreDuplicates: true },
      )
    if (error) {
      return NextResponse.json({ success: false, error: 'Could not save' }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Server error' },
      { status: 500 },
    )
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = (await req.json()) as { clientId?: string; id?: string }
    if (!body.clientId || !body.id) {
      return NextResponse.json({ success: false, error: 'Missing clientId or id' }, { status: 400 })
    }
    const { authorizeForClient } = await import('@/lib/crm/teamAuth')
    const auth = await authorizeForClient(body.clientId, { level: 'manager' })
    if (!auth.ok) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
    }
    const { error } = await admin()
      .from('email_suppressions')
      .delete()
      .eq('id', body.id)
      .eq('client_id', body.clientId)
    if (error) {
      return NextResponse.json({ success: false, error: 'Could not remove' }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Server error' },
      { status: 500 },
    )
  }
}
