// Unsubscribe endpoint for campaign emails.
//
// POST /api/e/u/{token}  - performs the unsubscribe. Auth-free + idempotent:
//   this is also the RFC 8058 one-click target (Gmail/Yahoo POST here from
//   their own servers when the user clicks the native Unsubscribe button).
// GET  /api/e/u/{token}  - info for the landing page (who, which sender).
//
// Effect: the address lands in email_suppressions for that client. The lead
// row never changes - every future send resolves its audience minus this
// list, so they simply stop receiving campaigns.

import { NextRequest, NextResponse } from 'next/server'
import { admin } from '@/lib/emailOutbox'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function loadSend(token: string) {
  if (!token) return null
  const { data } = await admin()
    .from('email_campaign_sends')
    .select('id, client_id, to_email')
    .eq('token', token)
    .maybeSingle()
  return data
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params
  const send = await loadSend(token)
  if (!send) {
    return NextResponse.json({ success: false, error: 'Link not found' }, { status: 404 })
  }
  const db = admin()
  const [{ data: client }, { data: existing }] = await Promise.all([
    db
      .from('clients')
      .select('email_from_name, business_name, name')
      .eq('id', send.client_id)
      .maybeSingle(),
    db
      .from('email_suppressions')
      .select('id')
      .eq('client_id', send.client_id)
      .eq('email', send.to_email.toLowerCase())
      .maybeSingle(),
  ])
  return NextResponse.json({
    success: true,
    email: send.to_email,
    senderName:
      client?.email_from_name || client?.business_name || client?.name || 'this sender',
    alreadyUnsubscribed: Boolean(existing),
  })
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params
  const send = await loadSend(token)
  if (!send) {
    return NextResponse.json({ success: false, error: 'Link not found' }, { status: 404 })
  }
  try {
    const { error } = await admin()
      .from('email_suppressions')
      .upsert(
        {
          client_id: send.client_id,
          email: send.to_email.toLowerCase(),
          reason: 'unsubscribed',
          source_send_id: send.id,
        },
        { onConflict: 'client_id,email', ignoreDuplicates: true },
      )
    if (error) {
      console.error('[e/u] suppression insert failed:', error)
      return NextResponse.json({ success: false, error: 'Could not unsubscribe' }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[e/u] unsubscribe failed:', err)
    return NextResponse.json({ success: false, error: 'Could not unsubscribe' }, { status: 500 })
  }
}
