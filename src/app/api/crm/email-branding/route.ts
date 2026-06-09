// GET  /api/crm/email-branding?clientId=...   -> { fromName, replyTo, defaultName }
// POST /api/crm/email-branding { clientId, fromName, replyTo }
//
// Per-client white-label email settings (option 1). Outward-facing emails
// (invoice, meeting confirmations) display `fromName` as the sender and set
// Reply-To to `replyTo`. Service-role writes gated by authorizeForClient so
// CRM managers can edit regardless of clients-table RLS.

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const admin = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function GET(req: NextRequest) {
  const clientId = new URL(req.url).searchParams.get('clientId')
  if (!clientId) {
    return NextResponse.json({ success: false, error: 'Missing clientId' }, { status: 400 })
  }
  const { authorizeForClient } = await import('@/lib/crm/teamAuth')
  const auth = await authorizeForClient(clientId, { level: 'manager' })
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
  }

  const { data, error } = await admin
    .from('clients')
    .select('business_name, name, email_from_name, email_reply_to')
    .eq('id', clientId)
    .maybeSingle()
  if (error || !data) {
    return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 })
  }

  return NextResponse.json({
    success: true,
    fromName: data.email_from_name || '',
    replyTo: data.email_reply_to || '',
    // What the sender name falls back to when fromName is left empty.
    defaultName: data.business_name || data.name || '',
  })
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      clientId?: string
      fromName?: string
      replyTo?: string
    }
    const clientId = body.clientId
    if (!clientId) {
      return NextResponse.json({ success: false, error: 'Missing clientId' }, { status: 400 })
    }
    const { authorizeForClient } = await import('@/lib/crm/teamAuth')
    const auth = await authorizeForClient(clientId, { level: 'manager' })
    if (!auth.ok) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
    }

    const replyTo = (body.replyTo || '').trim()
    if (replyTo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyTo)) {
      return NextResponse.json(
        { success: false, error: 'Reply-to must be a valid email address' },
        { status: 400 },
      )
    }

    const { error } = await admin
      .from('clients')
      .update({
        email_from_name: (body.fromName || '').trim() || null,
        email_reply_to: replyTo || null,
      })
      .eq('id', clientId)
    if (error) {
      console.error('[email-branding] save error:', error)
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
