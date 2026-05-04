import { NextRequest, NextResponse } from 'next/server'
import { adminClient, authorizeForClient } from '@/lib/crm/teamAuth'
import type { CrmRole } from '@/lib/crm/teamAuth'
import { createClient as createServerClient } from '@/lib/supabase/server'

// Active member operations: PATCH to change role, DELETE to remove from
// the CRM. DELETE requires the caller's password as a confirmation
// (mirrors the agency-side /api/team/remove pattern).

export const dynamic = 'force-dynamic'

interface PatchBody {
  clientId?: string
  role?: CrmRole
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params
  const body = (await req.json()) as PatchBody
  const clientId = body.clientId
  const role = body.role
  if (!clientId) {
    return NextResponse.json(
      { success: false, error: 'Missing clientId' },
      { status: 400 },
    )
  }
  if (!role || !['admin', 'manager', 'employee'].includes(role)) {
    return NextResponse.json(
      { success: false, error: 'Invalid role' },
      { status: 400 },
    )
  }

  // Role changes on active members are admin-only.
  const auth = await authorizeForClient(clientId, { level: 'admin' })
  if (!auth.ok) {
    return NextResponse.json(
      { success: false, error: auth.error },
      { status: auth.status },
    )
  }

  const { error } = await adminClient
    .from('client_memberships')
    .update({ role })
    .eq('client_id', clientId)
    .eq('user_id', userId)

  if (error) {
    console.error('crm/team/members PATCH error:', error)
    return NextResponse.json(
      { success: false, error: error.message || 'Role update failed' },
      { status: 500 },
    )
  }
  return NextResponse.json({ success: true })
}

interface DeleteBody {
  clientId?: string
  password?: string
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params
  const body = (await req.json().catch(() => ({}))) as DeleteBody
  const clientId = body.clientId
  const password = body.password ?? ''
  if (!clientId) {
    return NextResponse.json(
      { success: false, error: 'Missing clientId' },
      { status: 400 },
    )
  }

  // Removing a member is admin-only and additionally gated by the
  // caller's password below.
  const auth = await authorizeForClient(clientId, { level: 'admin' })
  if (!auth.ok) {
    return NextResponse.json(
      { success: false, error: auth.error },
      { status: auth.status },
    )
  }
  if (auth.caller.user.id === userId) {
    return NextResponse.json(
      { success: false, error: 'You cannot remove yourself from this CRM' },
      { status: 400 },
    )
  }
  if (!auth.caller.user.email) {
    return NextResponse.json(
      { success: false, error: 'No email on session' },
      { status: 400 },
    )
  }

  // Re-verify the caller's password as the final security gate. We use
  // the cookie-bound server client (NOT admin) so signInWithPassword
  // actually checks credentials.
  const supabase = await createServerClient()
  const { error: pwErr } = await supabase.auth.signInWithPassword({
    email: auth.caller.user.email,
    password,
  })
  if (pwErr) {
    return NextResponse.json(
      { success: false, error: 'Incorrect password' },
      { status: 403 },
    )
  }

  const { error } = await adminClient
    .from('client_memberships')
    .delete()
    .eq('client_id', clientId)
    .eq('user_id', userId)

  if (error) {
    console.error('crm/team/members DELETE error:', error)
    return NextResponse.json(
      { success: false, error: error.message || 'Remove failed' },
      { status: 500 },
    )
  }
  return NextResponse.json({ success: true })
}
