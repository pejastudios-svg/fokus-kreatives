// GET /api/integrations/google/connect?clientId=<crm-id>
//
// Initiates Google OAuth. We:
//   1. Verify the caller is a manager+ on the target CRM.
//   2. Sign a state token encoding (clientId, nonce).
//   3. Redirect the browser to Google's consent page.
//
// Google sends the user back to /callback with the auth code.

import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { buildGoogleAuthUrl, signState } from '@/lib/integrations/google'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const clientId = searchParams.get('clientId')
  if (!clientId) {
    return NextResponse.json(
      { success: false, error: 'Missing clientId' },
      { status: 400 },
    )
  }

  const googleClientId = process.env.GOOGLE_CLIENT_ID
  if (!googleClientId) {
    return NextResponse.json(
      {
        success: false,
        error:
          'GOOGLE_CLIENT_ID is not set. Configure Google OAuth credentials in env first.',
      },
      { status: 500 },
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

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin
  const redirectUri = `${appUrl}/api/integrations/google/callback`

  // Nonce binds the state to a single attempt - we set it as a
  // httpOnly cookie and verify it matches on callback. Prevents
  // attackers from injecting their own state to attach a stolen
  // Google account to a victim CRM.
  const nonce = randomBytes(16).toString('hex')
  const state = signState({ clientId, nonce })
  const authUrl = buildGoogleAuthUrl({
    clientId: googleClientId,
    redirectUri,
    state,
  })

  const res = NextResponse.redirect(authUrl)
  res.cookies.set('g_oauth_nonce', nonce, {
    httpOnly: true,
    sameSite: 'lax',
    secure: appUrl.startsWith('https://'),
    path: '/',
    maxAge: 600, // 10 minutes - more than enough for the consent flow
  })
  return res
}
