import { NextRequest, NextResponse } from 'next/server'
import { adminClient, authorizeForClient } from '@/lib/crm/teamAuth'
import type { CrmRole } from '@/lib/crm/teamAuth'

// Single-invite operations: PATCH to change the role, DELETE to cancel.
// Both require the caller to have admin/manager rights on the invite's
// client.

export const dynamic = 'force-dynamic'

async function loadInviteAndAuthorize(
  id: string,
): Promise<
  | { ok: true; clientId: string }
  | { ok: false; status: number; error: string }
> {
  const { data: invite, error } = await adminClient
    .from('crm_invites')
    .select('client_id')
    .eq('id', id)
    .maybeSingle()
  if (error) {
    return { ok: false, status: 500, error: error.message }
  }
  if (!invite) {
    return { ok: false, status: 404, error: 'Invite not found' }
  }
  // Both PATCH (role change) and DELETE (cancel) on a pending invite
  // mutate team access, so they're admin-only.
  const auth = await authorizeForClient(invite.client_id, { level: 'admin' })
  if (!auth.ok) return auth
  return { ok: true, clientId: invite.client_id }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const ok = await loadInviteAndAuthorize(id)
  if (!ok.ok) {
    return NextResponse.json(
      { success: false, error: ok.error },
      { status: ok.status },
    )
  }

  const body = (await req.json()) as { role?: CrmRole }
  const role = body.role
  if (!role || !['admin', 'manager', 'employee'].includes(role)) {
    return NextResponse.json(
      { success: false, error: 'Invalid role' },
      { status: 400 },
    )
  }

  const { error } = await adminClient
    .from('crm_invites')
    .update({ role })
    .eq('id', id)
  if (error) {
    console.error('crm/team/invites PATCH error:', error)
    return NextResponse.json(
      { success: false, error: error.message || 'Update failed' },
      { status: 500 },
    )
  }
  return NextResponse.json({ success: true })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const ok = await loadInviteAndAuthorize(id)
  if (!ok.ok) {
    return NextResponse.json(
      { success: false, error: ok.error },
      { status: ok.status },
    )
  }
  const { error } = await adminClient.from('crm_invites').delete().eq('id', id)
  if (error) {
    console.error('crm/team/invites DELETE error:', error)
    return NextResponse.json(
      { success: false, error: error.message || 'Delete failed' },
      { status: 500 },
    )
  }
  return NextResponse.json({ success: true })
}
