// GET /api/integrations/google/callback?code=...&state=...
//
// Google redirects the user here after they grant (or deny) consent.
// We:
//   1. Verify the state signature + match against the nonce cookie.
//   2. Exchange the code for access + refresh tokens.
//   3. Fetch the user's email so we can display "connected as X".
//   4. Upsert into user_integrations.
//   5. Redirect back to the CRM settings page.
//
// We never redirect to a URL containing the tokens - everything stays
// on the server side.

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import {
  exchangeGoogleCode,
  fetchGoogleUserInfo,
  verifyState,
} from '@/lib/integrations/google'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const admin = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

function settingsRedirect(
  appUrl: string,
  clientId: string,
  status: 'connected' | 'error',
  errMsg?: string,
) {
  const u = new URL(`${appUrl}/crm/${clientId}/settings`)
  u.searchParams.set('google', status)
  if (errMsg) u.searchParams.set('error', errMsg)
  return NextResponse.redirect(u.toString())
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const googleError = searchParams.get('error')
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin

  if (googleError) {
    // User clicked "Cancel" on Google's consent page. Bounce back
    // with a friendly notice.
    const parsed = state ? verifyState(state) : null
    const fallback = `${appUrl}/`
    if (!parsed) return NextResponse.redirect(fallback)
    return settingsRedirect(appUrl, parsed.clientId, 'error', googleError)
  }

  if (!code || !state) {
    return NextResponse.json(
      { success: false, error: 'Missing code or state' },
      { status: 400 },
    )
  }

  // Verify the state we signed at connect time + the nonce cookie.
  const parsed = verifyState(state)
  if (!parsed) {
    return NextResponse.json(
      { success: false, error: 'Invalid OAuth state' },
      { status: 400 },
    )
  }
  const cookieNonce = req.cookies.get('g_oauth_nonce')?.value
  if (!cookieNonce || cookieNonce !== parsed.nonce) {
    return NextResponse.json(
      { success: false, error: 'OAuth nonce mismatch - retry the connect flow' },
      { status: 400 },
    )
  }

  // Make sure the user is still signed in and still authorized for
  // the CRM (their session could have changed during the OAuth round
  // trip; we don't want to attach a stolen Google account to a CRM
  // they no longer manage).
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ success: false, error: 'Not signed in' }, { status: 401 })
  }
  const { authorizeForClient } = await import('@/lib/crm/teamAuth')
  const auth = await authorizeForClient(parsed.clientId, { level: 'manager' })
  if (!auth.ok) {
    return NextResponse.json(
      { success: false, error: auth.error },
      { status: auth.status },
    )
  }

  const redirectUri = `${appUrl}/api/integrations/google/callback`
  let tokens
  try {
    tokens = await exchangeGoogleCode({ code, redirectUri })
  } catch (err) {
    console.error('[google/callback] token exchange failed:', err)
    return settingsRedirect(
      appUrl,
      parsed.clientId,
      'error',
      err instanceof Error ? err.message : 'Token exchange failed',
    )
  }

  let userInfo
  try {
    userInfo = await fetchGoogleUserInfo(tokens.access_token)
  } catch (err) {
    console.error('[google/callback] userinfo failed:', err)
    return settingsRedirect(
      appUrl,
      parsed.clientId,
      'error',
      'Could not read Google account',
    )
  }

  const expiresAt = new Date(Date.now() + (tokens.expires_in - 60) * 1000).toISOString()

  const { error: upsertErr } = await admin.from('user_integrations').upsert(
    {
      client_id: parsed.clientId,
      user_id: user.id,
      provider: 'google_meet',
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? null,
      scope: tokens.scope,
      expires_at: expiresAt,
      status: 'connected',
      last_error: null,
      metadata: {
        google_user_email: userInfo.email,
        google_user_name: userInfo.name ?? null,
        google_user_sub: userInfo.sub,
      },
    },
    { onConflict: 'client_id,provider' },
  )

  if (upsertErr) {
    console.error('[google/callback] upsert error:', upsertErr)
    return settingsRedirect(appUrl, parsed.clientId, 'error', 'Could not save connection')
  }

  // Drop the nonce cookie + bounce back to settings with a success flag.
  const res = settingsRedirect(appUrl, parsed.clientId, 'connected')
  res.cookies.delete('g_oauth_nonce')
  return res
}
