import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

// Activate an invite. Two flavors:
//   1. CRM team invite (crm_invites row) - provision auth user, ensure
//      a public.users row matches, insert client_memberships, stamp
//      crm_invites.accepted_at.
//   2. Legacy portal client invite (users.invitation_token) - provision
//      auth user, align placeholder users row to new auth uid, mark
//      accepted, clear token.
//
// On success returns the email + a redirectTo path. The browser then
// signs in via supabase.auth.signInWithPassword to start the session.

export const dynamic = 'force-dynamic'

const admin = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

interface AcceptBody {
  token?: string
  password?: string
}

/**
 * Create a Supabase Auth user with this email + password. If the auth
 * user already exists (e.g., from a previous half-completed flow), find
 * them and reset their password to what was just typed. Returns the
 * auth.users.id.
 */
async function provisionAuthUser(
  email: string,
  password: string,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const createRes = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (!createRes.error) {
    return { ok: true, id: createRes.data.user!.id }
  }

  const msg = (createRes.error.message || '').toLowerCase()
  const alreadyRegistered =
    msg.includes('already registered') ||
    msg.includes('already exists') ||
    msg.includes('duplicate') ||
    createRes.error.code === 'email_exists'

  if (!alreadyRegistered) {
    return { ok: false, error: createRes.error.message || 'Auth create failed' }
  }

  // Find the existing auth user and force-reset their password.
  const { data: list } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  })
  const match = list.users.find(
    (u) => (u.email || '').toLowerCase() === email.toLowerCase(),
  )
  if (!match) {
    return { ok: false, error: 'Auth user collision but none found' }
  }
  const { error: updErr } = await admin.auth.admin.updateUserById(match.id, {
    password,
    email_confirm: true,
  })
  if (updErr) return { ok: false, error: updErr.message || 'Password reset failed' }
  return { ok: true, id: match.id }
}

/**
 * Make sure exactly one public.users row exists for this auth uid with
 * the given profile data. Three cases to handle in order:
 *
 *   1. A row at this auth uid already exists (trigger or prior accept):
 *      update it.
 *   2. A row with this email exists at a DIFFERENT id (a stale
 *      placeholder from an earlier failed attempt, or an older flow
 *      that pre-dates auth uid alignment): re-point any FK references
 *      to the new auth uid, delete the stale row, then insert fresh.
 *   3. Nothing exists: plain insert.
 *
 * Without case 2, we'd hit `duplicate key value violates unique
 * constraint "users_email_key"` whenever a stale row with the email
 * lingered.
 */
async function ensureUserRow(
  authUserId: string,
  email: string,
  name: string | null,
  // role here is the GLOBAL app role (admin/manager/employee/client),
  // NOT the per-CRM role. CRM team members are 'employee' globally and
  // their CRM-level role lives in client_memberships.
  appRole: 'admin' | 'manager' | 'employee' | 'client',
  appClientId: string | null,
  // Agency staff vs everyone else. Critical to preserve through
  // activation - if we drop this, an agency manager / employee gets
  // demoted to a non-agency account and the dashboard auth guard
  // bounces them back to /login.
  isAgencyUser: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const baseFields = {
    email,
    name,
    role: appRole,
    client_id: appClientId,
    is_agency_user: isAgencyUser,
    invitation_accepted: true,
    invitation_token: null,
  }

  // Case 1: row at this auth uid already exists.
  const { data: byId } = await admin
    .from('users')
    .select('id')
    .eq('id', authUserId)
    .maybeSingle()
  if (byId) {
    const { error } = await admin
      .from('users')
      .update(baseFields)
      .eq('id', authUserId)
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  }

  // Case 2: row with this email but a different id. Migrate FK references
  // first so the delete doesn't orphan memberships, then drop the stale row.
  const { data: byEmail } = await admin
    .from('users')
    .select('id')
    .eq('email', email)
    .maybeSingle()
  if (byEmail && byEmail.id !== authUserId) {
    const tablesPointingAtUserId = ['client_memberships'] as const
    for (const table of tablesPointingAtUserId) {
      const { error: fkErr } = await admin
        .from(table)
        .update({ user_id: authUserId })
        .eq('user_id', byEmail.id)
      if (fkErr) {
        console.error(
          `invite/accept ${table} FK repoint error (stale row):`,
          fkErr,
        )
      }
    }
    const { error: delErr } = await admin
      .from('users')
      .delete()
      .eq('id', byEmail.id)
    if (delErr) return { ok: false, error: delErr.message }
  }

  // Case 3: insert fresh.
  const { error } = await admin.from('users').insert({
    id: authUserId,
    ...baseFields,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as AcceptBody
    const token = body.token?.trim()
    const password = body.password ?? ''

    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Missing token' },
        { status: 400 },
      )
    }
    if (password.length < 6) {
      return NextResponse.json(
        { success: false, error: 'Password must be at least 6 characters' },
        { status: 400 },
      )
    }

    // ---- Branch 1: crm_invites (new path) -----------------------------
    const { data: crmInvite } = await admin
      .from('crm_invites')
      .select('id, client_id, email, name, role, expires_at, accepted_at')
      .eq('token', token)
      .maybeSingle()

    if (crmInvite) {
      if (crmInvite.accepted_at) {
        return NextResponse.json(
          { success: false, error: 'This invitation has already been used' },
          { status: 410 },
        )
      }
      if (new Date(crmInvite.expires_at) < new Date()) {
        return NextResponse.json(
          { success: false, error: 'This invitation has expired. Ask for a new one.' },
          { status: 410 },
        )
      }

      const provision = await provisionAuthUser(crmInvite.email, password)
      if (!provision.ok) {
        return NextResponse.json(
          { success: false, error: provision.error },
          { status: 500 },
        )
      }

      const ensure = await ensureUserRow(
        provision.id,
        crmInvite.email,
        crmInvite.name,
        // Global app role for CRM team members is always 'employee' -
        // their per-client role lives in client_memberships.
        'employee',
        null,
        // CRM members aren't agency staff.
        false,
      )
      if (!ensure.ok) {
        return NextResponse.json(
          { success: false, error: ensure.error },
          { status: 500 },
        )
      }

      // Insert / update the membership for this client.
      const { error: memErr } = await admin
        .from('client_memberships')
        .upsert(
          {
            client_id: crmInvite.client_id,
            user_id: provision.id,
            role: crmInvite.role,
          },
          { onConflict: 'client_id,user_id' },
        )
      if (memErr) {
        console.error('invite/accept membership upsert error:', memErr)
        return NextResponse.json(
          { success: false, error: memErr.message || 'Membership failed' },
          { status: 500 },
        )
      }

      // Stamp the invite as accepted (kept for audit, never re-served).
      await admin
        .from('crm_invites')
        .update({ accepted_at: new Date().toISOString() })
        .eq('id', crmInvite.id)

      return NextResponse.json({
        success: true,
        email: crmInvite.email,
        redirectTo: `/crm/${crmInvite.client_id}/dashboard`,
      })
    }

    // ---- Branch 2: legacy invite stashed on the users row. Covers
    // both agency staff invites (is_agency_user=true) and portal client
    // invites (role='client'). Both are activated via this branch.
    const { data: invitee } = await admin
      .from('users')
      .select(
        'id, email, name, role, client_id, invitation_accepted, invitation_expires_at, is_agency_user',
      )
      .eq('invitation_token', token)
      .maybeSingle()

    if (!invitee) {
      return NextResponse.json(
        { success: false, error: 'Invalid or expired invite' },
        { status: 404 },
      )
    }
    if (invitee.invitation_accepted) {
      return NextResponse.json(
        { success: false, error: 'This invitation has already been used' },
        { status: 410 },
      )
    }
    if (
      invitee.invitation_expires_at &&
      new Date(invitee.invitation_expires_at) < new Date()
    ) {
      return NextResponse.json(
        {
          success: false,
          error: 'This invitation has expired. Ask for a new one.',
        },
        { status: 410 },
      )
    }
    if (!invitee.email) {
      return NextResponse.json(
        { success: false, error: 'Invitee row has no email' },
        { status: 500 },
      )
    }

    const provision = await provisionAuthUser(invitee.email, password)
    if (!provision.ok) {
      return NextResponse.json(
        { success: false, error: provision.error },
        { status: 500 },
      )
    }

    // Re-point any FK references from the placeholder uuid to the new auth uid.
    if (invitee.id !== provision.id) {
      await admin
        .from('client_memberships')
        .update({ user_id: provision.id })
        .eq('user_id', invitee.id)
    }

    // Ensure exactly one canonical users row with the new auth uid.
    // Critical: preserve is_agency_user - dropping it on activation
    // would demote agency staff and bounce them off /dashboard.
    const ensure = await ensureUserRow(
      provision.id,
      invitee.email,
      invitee.name,
      (invitee.role as 'admin' | 'manager' | 'employee' | 'client') || 'client',
      invitee.client_id,
      !!invitee.is_agency_user,
    )
    if (!ensure.ok) {
      return NextResponse.json(
        { success: false, error: ensure.error },
        { status: 500 },
      )
    }

    // Delete the orphaned placeholder if its id changed.
    if (invitee.id !== provision.id) {
      await admin.from('users').delete().eq('id', invitee.id)
    }

    // Pick a landing URL. Agency staff land in the agency app; client
    // portal users land in their own CRM; CRM-only members land in the
    // CRM they have a membership for.
    let redirectTo = '/dashboard'
    if (invitee.is_agency_user) {
      redirectTo = '/dashboard'
    } else if (invitee.role === 'client' && invitee.client_id) {
      redirectTo = `/crm/${invitee.client_id}/dashboard`
    } else {
      const { data: mem } = await admin
        .from('client_memberships')
        .select('client_id')
        .eq('user_id', provision.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (mem?.client_id) redirectTo = `/crm/${mem.client_id}/dashboard`
    }

    return NextResponse.json({
      success: true,
      email: invitee.email,
      redirectTo,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('invite/accept unhandled:', msg)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
