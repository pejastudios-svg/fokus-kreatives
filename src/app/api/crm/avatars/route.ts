import { NextRequest, NextResponse } from 'next/server'
import { adminClient, authorizeForClient } from '@/lib/crm/teamAuth'

export const dynamic = 'force-dynamic'

// GET /api/crm/avatars?clientId=... - email -> profile picture map for
// everyone known to this workspace (the client's accounts + agency staff).
// Google exposes no public photo URL for arbitrary Gmail addresses, so for
// people in OUR system the uploaded profile picture is the reliable source;
// unknown addresses fall back to public resolvers client-side.
export async function GET(req: NextRequest) {
  const clientId = new URL(req.url).searchParams.get('clientId')
  if (!clientId) {
    return NextResponse.json({ success: false, error: 'Missing clientId' }, { status: 400 })
  }
  const auth = await authorizeForClient(clientId, { level: 'member' })
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
  }

  const { data, error } = await adminClient
    .from('users')
    .select('email, profile_picture_url, client_id')
    .not('profile_picture_url', 'is', null)
    .or(`client_id.eq.${clientId},client_id.is.null`)

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  const avatars: Record<string, string> = {}
  for (const row of data || []) {
    const email = (row.email as string | null)?.trim().toLowerCase()
    const url = (row.profile_picture_url as string | null)?.trim()
    if (email && url) avatars[email] = url
  }
  return NextResponse.json({ success: true, avatars })
}
