import { NextRequest, NextResponse } from 'next/server'
import { adminClient, authorizeForClient } from '@/lib/crm/teamAuth'
import type { CrmRole } from '@/lib/crm/teamAuth'

// Create (or refresh) a pending CRM invite. If an invite already exists
// for the same (client_id, email), update it in place - generate a new
// token, bump expires_at, swap role/name. The team page expects this
// idempotent behavior so re-inviting an email never fails on a stale
// row.

export const dynamic = 'force-dynamic'

interface InviteBody {
  clientId?: string
  email?: string
  name?: string
  role?: CrmRole
}

function generateToken(): string {
  // 32 bytes -> 64-char hex. Sufficient entropy, URL-safe, no padding.
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as InviteBody
    const clientId = body.clientId?.trim()
    const email = body.email?.trim().toLowerCase()
    const name = body.name?.trim() || null
    const role: CrmRole = (body.role || 'manager') as CrmRole

    if (!clientId || !email) {
      return NextResponse.json(
        { success: false, error: 'Missing clientId or email' },
        { status: 400 },
      )
    }
    if (!['admin', 'manager', 'employee'].includes(role)) {
      return NextResponse.json(
        { success: false, error: 'Invalid role' },
        { status: 400 },
      )
    }

    // Inviting a new member changes who has access to the CRM, so this
    // is admin-only. Managers can see the team but can't grow it.
    const auth = await authorizeForClient(clientId, { level: 'admin' })
    if (!auth.ok) {
      return NextResponse.json(
        { success: false, error: auth.error },
        { status: auth.status },
      )
    }

    // If they're already an active member, reject. Resend / role change
    // for active members has its own endpoint.
    const { data: existingMembership } = await adminClient
      .from('client_memberships')
      .select('user_id, users:user_id(email)')
      .eq('client_id', clientId)
      .limit(50)
    type MemRow = { user_id: string; users: { email: string } | { email: string }[] | null }
    const memberAlready = (existingMembership as MemRow[] | null)?.some((m) => {
      const u = Array.isArray(m.users) ? m.users[0] : m.users
      return (u?.email || '').toLowerCase() === email
    })
    if (memberAlready) {
      return NextResponse.json(
        { success: false, error: 'That email is already a member of this CRM' },
        { status: 409 },
      )
    }

    // Upsert into crm_invites - one pending invite per (client, email).
    const token = generateToken()
    const expiresAt = new Date(
      Date.now() + 7 * 24 * 60 * 60 * 1000,
    ).toISOString()

    const { data: invite, error: upsertErr } = await adminClient
      .from('crm_invites')
      .upsert(
        {
          client_id: clientId,
          email,
          name,
          role,
          token,
          invited_by: auth.caller.user.id,
          expires_at: expiresAt,
          accepted_at: null,
        },
        { onConflict: 'client_id,email' },
      )
      .select('id, token, expires_at')
      .single()

    if (upsertErr || !invite) {
      console.error('crm/team/invite upsert error:', upsertErr)
      return NextResponse.json(
        { success: false, error: upsertErr?.message || 'Failed to save invite' },
        { status: 500 },
      )
    }

    return NextResponse.json({
      success: true,
      invite: {
        id: invite.id,
        token: invite.token,
        expiresAt: invite.expires_at,
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('crm/team/invite unhandled:', msg)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
