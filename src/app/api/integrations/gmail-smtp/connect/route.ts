// POST /api/integrations/gmail-smtp/connect
//
// Body: { clientId: string, address: string, appPassword: string }
//
// White-label option 2 connect: verifies the Gmail app password with a LIVE
// SMTP login, then stores it AES-256-GCM encrypted in user_integrations
// (provider='gmail_smtp'). From then on, outward emails for this client
// (invoices, meeting confirmations/reschedules) send from their own Gmail.

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { encryptSecret } from '@/lib/crypto/secretBox'
import { verifySmtpLogin } from '@/lib/email/smtpSender'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const admin = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      clientId?: string
      address?: string
      appPassword?: string
    }
    const clientId = body.clientId
    const address = (body.address || '').trim().toLowerCase()
    // Google displays app passwords as "xxxx xxxx xxxx xxxx" - strip spaces.
    const appPassword = (body.appPassword || '').replace(/\s+/g, '')

    if (!clientId || !address || !appPassword) {
      return NextResponse.json(
        { success: false, error: 'Missing clientId, address, or app password' },
        { status: 400 },
      )
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      return NextResponse.json(
        { success: false, error: 'Enter a valid email address' },
        { status: 400 },
      )
    }
    if (appPassword.length !== 16) {
      return NextResponse.json(
        { success: false, error: 'App passwords are 16 characters (spaces are ignored)' },
        { status: 400 },
      )
    }
    if (!process.env.EMAIL_CRED_KEY) {
      return NextResponse.json(
        { success: false, error: 'EMAIL_CRED_KEY is not configured on the server' },
        { status: 500 },
      )
    }

    const { authorizeForClient } = await import('@/lib/crm/teamAuth')
    const auth = await authorizeForClient(clientId, { level: 'manager' })
    if (!auth.ok) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
    }

    // Live SMTP login so a typo / missing 2FA fails HERE with a clear
    // message, not silently at send time later.
    try {
      await verifySmtpLogin({ address, appPassword })
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'SMTP login failed'
      const friendly = /username and password not accepted|5\.7\.8|535/i.test(raw)
        ? 'Gmail rejected the login. Check that 2-Step Verification is ON for this account and the app password was copied correctly.'
        : `Could not reach Gmail SMTP: ${raw.slice(0, 200)}`
      return NextResponse.json({ success: false, error: friendly }, { status: 400 })
    }

    const { error: upsertErr } = await admin.from('user_integrations').upsert(
      {
        client_id: clientId,
        user_id: auth.caller.user.id,
        provider: 'gmail_smtp',
        access_token: encryptSecret(appPassword),
        refresh_token: null,
        scope: 'smtp',
        expires_at: null,
        status: 'connected',
        last_error: null,
        metadata: { gmail_address: address, verified_at: new Date().toISOString() },
      },
      { onConflict: 'client_id,provider' },
    )
    if (upsertErr) {
      console.error('[gmail-smtp/connect] upsert error:', upsertErr)
      return NextResponse.json(
        { success: false, error: 'Could not save the connection' },
        { status: 500 },
      )
    }

    return NextResponse.json({ success: true, address })
  } catch (err) {
    console.error('[gmail-smtp/connect] error:', err)
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Server error' },
      { status: 500 },
    )
  }
}
