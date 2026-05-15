// POST /api/integrations/calendly/connect
//
// Body: { clientId: string, token: string }
//
// 1. Verifies the user is allowed to manage `clientId` (CRM admin or
//    manager via teamAuth).
// 2. Validates the Calendly PAT by hitting /users/me.
// 3. Creates a webhook subscription on Calendly pointed at our
//    /api/integrations/calendly/webhook endpoint.
// 4. Stores credentials + signing key + scheduling_url in
//    user_integrations (upsert on conflict so reconnecting works).

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import {
  verifyCalendlyToken,
  createCalendlyWebhook,
} from '@/lib/integrations/calendly'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const admin = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ success: false, error: 'Not signed in' }, { status: 401 })
    }

    const { clientId, token } = (await req.json()) as { clientId?: string; token?: string }
    if (!clientId || !token) {
      return NextResponse.json(
        { success: false, error: 'Missing clientId or token' },
        { status: 400 },
      )
    }

    // Authorization: user must be admin/manager on this CRM. Reuses
    // the existing teamAuth helper so we stay consistent with the
    // rest of the CRM access model.
    const { authorizeForClient } = await import('@/lib/crm/teamAuth')
    const auth = await authorizeForClient(clientId, { level: 'manager' })
    if (!auth.ok) {
      return NextResponse.json(
        { success: false, error: auth.error },
        { status: auth.status },
      )
    }

    // Verify the Calendly token.
    let calendlyUser
    try {
      calendlyUser = await verifyCalendlyToken(token)
    } catch (err) {
      return NextResponse.json(
        {
          success: false,
          error:
            err instanceof Error
              ? err.message
              : 'Could not verify Calendly token. Double-check the PAT.',
        },
        { status: 400 },
      )
    }

    // Register the webhook on Calendly. Free-tier accounts get a 403
    // ("upgrade to Standard") - that's a soft failure: the user can
    // still embed their scheduler on capture pages, they just won't
    // get automatic meeting logging. We save the connection anyway
    // and surface the limitation via webhook_registered=false so the
    // UI can show a "Upgrade Calendly to auto-log bookings" hint.
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin
    const callbackUrl = `${appUrl}/api/integrations/calendly/webhook`

    let subscription: { uri: string; signing_key: string } | null = null
    let webhookError: string | null = null
    try {
      subscription = await createCalendlyWebhook(token, calendlyUser, callbackUrl)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // 403 from Calendly = free-tier limitation. Any other failure is
      // unexpected (bad scope, network issue) - still fall back to no
      // webhook but log the actual reason for ops visibility.
      console.warn('[calendly/connect] webhook registration skipped:', msg)
      webhookError = msg
    }

    // Upsert the integration. ON CONFLICT (client_id, provider) UPDATE
    // covers the reconnect case where the user re-pastes a fresh PAT.
    const { error: upsertErr } = await admin.from('user_integrations').upsert(
      {
        client_id: clientId,
        user_id: user.id,
        provider: 'calendly',
        access_token: token,
        scope: 'user',
        status: 'connected',
        last_error: webhookError,
        metadata: {
          calendly_user_uri: calendlyUser.uri,
          calendly_user_email: calendlyUser.email,
          calendly_user_name: calendlyUser.name,
          scheduling_url: calendlyUser.scheduling_url,
          organization: calendlyUser.current_organization,
          webhook_uri: subscription?.uri ?? null,
          webhook_signing_key: subscription?.signing_key ?? null,
          webhook_registered: !!subscription,
        },
      },
      { onConflict: 'client_id,provider' },
    )

    if (upsertErr) {
      console.error('[calendly/connect] upsert error:', upsertErr)
      return NextResponse.json(
        { success: false, error: 'Could not save connection' },
        { status: 500 },
      )
    }

    return NextResponse.json({
      success: true,
      connection: {
        provider: 'calendly',
        email: calendlyUser.email,
        scheduling_url: calendlyUser.scheduling_url,
        webhook_registered: !!subscription,
        webhook_error: webhookError,
      },
    })
  } catch (err) {
    console.error('[calendly/connect] error:', err)
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Server error' },
      { status: 500 },
    )
  }
}
