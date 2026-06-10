// POST /api/integrations/google/disconnect
//
// Body: { clientId: string }
//
// Revokes the OAuth tokens on Google's side (best-effort) and removes
// the row from user_integrations. Capture pages with
// meeting_integration='google_meet' fall back to the manual date/time
// flow without a Meet link until the user reconnects or picks a
// different integration.

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { revokeGoogleToken } from '@/lib/integrations/google'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const admin = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

interface IntegrationRow {
  access_token: string | null
  refresh_token: string | null
}

export async function POST(req: NextRequest) {
  try {
    const { clientId } = (await req.json()) as { clientId?: string }
    if (!clientId) {
      return NextResponse.json(
        { success: false, error: 'Missing clientId' },
        { status: 400 },
      )
    }

    const { authorizeForClient } = await import('@/lib/crm/teamAuth')
    const auth = await authorizeForClient(clientId, { level: 'manager' })
    if (!auth.ok) {
      return NextResponse.json(
        { success: false, error: auth.error },
        { status: auth.status },
      )
    }

    const { data: row } = await admin
      .from('user_integrations')
      .select('access_token, refresh_token')
      .eq('client_id', clientId)
      .eq('provider', 'google_meet')
      .maybeSingle()

    // Revoke the refresh_token (preferred) or access_token. Revoking
    // the refresh_token also invalidates all access tokens derived
    // from it, so it's the cleanest single call.
    const integration = row as IntegrationRow | null
    const tokenToRevoke = integration?.refresh_token || integration?.access_token
    if (tokenToRevoke) {
      const { openSecret } = await import('@/lib/crypto/secretBox')
      await revokeGoogleToken(openSecret(tokenToRevoke))
    }

    const { error } = await admin
      .from('user_integrations')
      .delete()
      .eq('client_id', clientId)
      .eq('provider', 'google_meet')

    if (error) {
      console.error('[google/disconnect] delete error:', error)
      return NextResponse.json(
        { success: false, error: 'Could not remove connection' },
        { status: 500 },
      )
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[google/disconnect] error:', err)
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Server error' },
      { status: 500 },
    )
  }
}
