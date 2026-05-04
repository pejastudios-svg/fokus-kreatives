import { NextRequest, NextResponse } from 'next/server'
import { adminClient, authorizeForClient } from '@/lib/crm/teamAuth'

// List all pending (not-yet-accepted) invites for a client. Includes
// expiry + role so the team page can show "expires in 3 days" and let
// admins resend or cancel.

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

  // Read-only list. Any active CRM member can see who's pending - the
  // resend / cancel actions are still admin-only on the per-invite route.
  const auth = await authorizeForClient(clientId, { level: 'member' })
  if (!auth.ok) {
    return NextResponse.json(
      { success: false, error: auth.error },
      { status: auth.status },
    )
  }

  const { data, error } = await adminClient
    .from('crm_invites')
    .select('id, email, name, role, token, expires_at, created_at')
    .eq('client_id', clientId)
    .is('accepted_at', null)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('crm/team/invites list error:', error)
    return NextResponse.json(
      { success: false, error: error.message || 'Fetch failed' },
      { status: 500 },
    )
  }

  return NextResponse.json({ success: true, invites: data || [] })
}
