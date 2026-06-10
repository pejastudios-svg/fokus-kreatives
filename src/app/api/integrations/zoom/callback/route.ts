// GET /api/integrations/zoom/callback?code=...&state=...
//
// Zoom OAuth callback. Same flow as Google's callback - verify state
// + nonce, exchange code for tokens, fetch user info, upsert. Bounce
// back to settings with ?zoom=connected|error.

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { encryptSecret } from '@/lib/crypto/secretBox'
import {
  exchangeZoomCode,
  fetchZoomUser,
  verifyZoomState,
} from '@/lib/integrations/zoom'

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
  u.searchParams.set('zoom', status)
  if (errMsg) u.searchParams.set('error', errMsg)
  return NextResponse.redirect(u.toString())
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const zoomError = searchParams.get('error')
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin

  if (zoomError) {
    const parsed = state ? verifyZoomState(state) : null
    if (!parsed) return NextResponse.redirect(`${appUrl}/`)
    return settingsRedirect(appUrl, parsed.clientId, 'error', zoomError)
  }

  if (!code || !state) {
    return NextResponse.json(
      { success: false, error: 'Missing code or state' },
      { status: 400 },
    )
  }

  const parsed = verifyZoomState(state)
  if (!parsed) {
    return NextResponse.json(
      { success: false, error: 'Invalid OAuth state' },
      { status: 400 },
    )
  }
  const cookieNonce = req.cookies.get('z_oauth_nonce')?.value
  if (!cookieNonce || cookieNonce !== parsed.nonce) {
    return NextResponse.json(
      { success: false, error: 'OAuth nonce mismatch - retry the connect flow' },
      { status: 400 },
    )
  }

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

  const redirectUri = `${appUrl}/api/integrations/zoom/callback`
  let tokens
  try {
    tokens = await exchangeZoomCode({ code, redirectUri })
  } catch (err) {
    console.error('[zoom/callback] token exchange failed:', err)
    return settingsRedirect(
      appUrl,
      parsed.clientId,
      'error',
      err instanceof Error ? err.message : 'Token exchange failed',
    )
  }

  let zoomUser
  try {
    zoomUser = await fetchZoomUser(tokens.access_token)
  } catch (err) {
    console.error('[zoom/callback] userinfo failed:', err)
    return settingsRedirect(
      appUrl,
      parsed.clientId,
      'error',
      'Could not read Zoom account',
    )
  }

  const expiresAt = new Date(Date.now() + (tokens.expires_in - 60) * 1000).toISOString()
  const fullName =
    [zoomUser.first_name, zoomUser.last_name].filter(Boolean).join(' ') || null

  const { error: upsertErr } = await admin.from('user_integrations').upsert(
    {
      client_id: parsed.clientId,
      user_id: user.id,
      provider: 'zoom',
      // Stored AES-256-GCM encrypted; readers go through openSecret().
      access_token: encryptSecret(tokens.access_token),
      refresh_token: encryptSecret(tokens.refresh_token),
      scope: tokens.scope,
      expires_at: expiresAt,
      status: 'connected',
      last_error: null,
      metadata: {
        zoom_user_id: zoomUser.id,
        zoom_user_email: zoomUser.email,
        zoom_user_name: fullName,
        zoom_account_id: zoomUser.account_id ?? null,
      },
    },
    { onConflict: 'client_id,provider' },
  )

  if (upsertErr) {
    console.error('[zoom/callback] upsert error:', upsertErr)
    return settingsRedirect(appUrl, parsed.clientId, 'error', 'Could not save connection')
  }

  const res = settingsRedirect(appUrl, parsed.clientId, 'connected')
  res.cookies.delete('z_oauth_nonce')
  return res
}
