// GET /api/integrations/zoom/connect?clientId=<crm-id>
//
// Mirrors the Google connect route: authorize the caller, sign a
// state token, set the matching nonce cookie, redirect to Zoom's
// consent screen.

import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { buildZoomAuthUrl, signZoomState } from '@/lib/integrations/zoom'

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

  const zoomClientId = process.env.ZOOM_CLIENT_ID
  if (!zoomClientId) {
    return NextResponse.json(
      {
        success: false,
        error:
          'ZOOM_CLIENT_ID is not set. Configure Zoom OAuth credentials in env first.',
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
  const redirectUri = `${appUrl}/api/integrations/zoom/callback`

  const nonce = randomBytes(16).toString('hex')
  const state = signZoomState({ clientId, nonce })
  const authUrl = buildZoomAuthUrl({
    clientId: zoomClientId,
    redirectUri,
    state,
  })

  const res = NextResponse.redirect(authUrl)
  res.cookies.set('z_oauth_nonce', nonce, {
    httpOnly: true,
    sameSite: 'lax',
    secure: appUrl.startsWith('https://'),
    path: '/',
    maxAge: 600,
  })
  return res
}
