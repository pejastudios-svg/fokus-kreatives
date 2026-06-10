// POST /api/integrations/gmail-smtp/test
//
// Body: { clientId: string }
//
// Sends a test email through the client's connected Gmail TO that same
// address, so the agency/client can confirm end-to-end delivery (and see
// the avatar + no "via") before any customer-facing email goes out.

import { NextRequest, NextResponse } from 'next/server'
import { getClientSmtp, buildTransport } from '@/lib/email/smtpSender'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const { clientId } = (await req.json()) as { clientId?: string }
    if (!clientId) {
      return NextResponse.json({ success: false, error: 'Missing clientId' }, { status: 400 })
    }

    const { authorizeForClient } = await import('@/lib/crm/teamAuth')
    const auth = await authorizeForClient(clientId, { level: 'manager' })
    if (!auth.ok) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
    }

    const creds = await getClientSmtp(clientId)
    if (!creds) {
      return NextResponse.json(
        { success: false, error: 'Client email is not connected' },
        { status: 400 },
      )
    }

    const transport = buildTransport(creds)
    try {
      await transport.sendMail({
        from: creds.address,
        to: creds.address,
        subject: 'Test: your CRM email connection works',
        html:
          '<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;">' +
          '<p>This is a test from your CRM.</p>' +
          '<p>Invoices and meeting emails to your customers will now send from <b>' +
          creds.address +
          '</b>.</p>' +
          '</div>',
      })
    } finally {
      transport.close()
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Test send failed'
    console.error('[gmail-smtp/test] error:', err)
    return NextResponse.json({ success: false, error: msg.slice(0, 300) }, { status: 500 })
  }
}
