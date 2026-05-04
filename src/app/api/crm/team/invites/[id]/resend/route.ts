import { NextRequest, NextResponse } from 'next/server'
import { adminClient, authorizeForClient } from '@/lib/crm/teamAuth'

// Regenerate a pending invite's token + bump expires_at. Rotating the
// token invalidates any older email so a leaked link can't be used
// after a resend.

export const dynamic = 'force-dynamic'

function generateToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  const { data: invite, error: lookupErr } = await adminClient
    .from('crm_invites')
    .select('id, client_id, email, name, role, accepted_at')
    .eq('id', id)
    .maybeSingle()
  if (lookupErr) {
    return NextResponse.json(
      { success: false, error: lookupErr.message },
      { status: 500 },
    )
  }
  if (!invite) {
    return NextResponse.json(
      { success: false, error: 'Invite not found' },
      { status: 404 },
    )
  }
  if (invite.accepted_at) {
    return NextResponse.json(
      { success: false, error: 'Invite already accepted' },
      { status: 400 },
    )
  }

  // Resending invalidates the prior token + extends access window, so
  // it's admin-only along with the rest of the team-write endpoints.
  const auth = await authorizeForClient(invite.client_id, { level: 'admin' })
  if (!auth.ok) {
    return NextResponse.json(
      { success: false, error: auth.error },
      { status: auth.status },
    )
  }

  const token = generateToken()
  const expiresAt = new Date(
    Date.now() + 7 * 24 * 60 * 60 * 1000,
  ).toISOString()

  const { data, error: updateErr } = await adminClient
    .from('crm_invites')
    .update({ token, expires_at: expiresAt })
    .eq('id', id)
    .select('id, token, expires_at, email, name, role, client_id')
    .single()

  if (updateErr || !data) {
    console.error('crm/team/invites/resend error:', updateErr)
    return NextResponse.json(
      { success: false, error: updateErr?.message || 'Resend failed' },
      { status: 500 },
    )
  }

  return NextResponse.json({
    success: true,
    invite: {
      id: data.id,
      token: data.token,
      expiresAt: data.expires_at,
      email: data.email,
      name: data.name,
      role: data.role,
      clientId: data.client_id,
    },
  })
}
