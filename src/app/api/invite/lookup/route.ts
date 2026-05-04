import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

// Look up invite info for the activation page. Reads from the new
// crm_invites table (CRM team invites) AND falls back to the legacy
// users.invitation_token column (portal client invites).

export const dynamic = 'force-dynamic'

const admin = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const token = searchParams.get('token')

  if (!token) {
    return NextResponse.json(
      { success: false, error: 'Missing token' },
      { status: 400 },
    )
  }

  try {
    // ---- 1. Try the new crm_invites table first --------------------
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

      // Resolve workspace name for the friendly "joining {Workspace}" line.
      const { data: client } = await admin
        .from('clients')
        .select('name, business_name')
        .eq('id', crmInvite.client_id)
        .maybeSingle()

      return NextResponse.json({
        success: true,
        kind: 'crm',
        invite: {
          email: crmInvite.email,
          name: crmInvite.name,
          role: crmInvite.role,
          clientId: crmInvite.client_id,
          clientName:
            client?.business_name || client?.name || 'a client CRM',
          expiresAt: crmInvite.expires_at,
        },
      })
    }

    // ---- 2. Legacy: agency invite + portal client invite stashed on
    // the users row. We must read invitation_expires_at + is_agency_user
    // here - they're needed to (a) reject expired invites and (b) keep
    // an agency staff member's role intact through activation.
    const { data: user } = await admin
      .from('users')
      .select(
        'id, email, name, role, client_id, invitation_accepted, invitation_expires_at, is_agency_user',
      )
      .eq('invitation_token', token)
      .maybeSingle()

    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Invalid or expired invite' },
        { status: 404 },
      )
    }
    if (user.invitation_accepted) {
      return NextResponse.json(
        { success: false, error: 'This invitation has already been used' },
        { status: 410 },
      )
    }
    if (
      user.invitation_expires_at &&
      new Date(user.invitation_expires_at) < new Date()
    ) {
      return NextResponse.json(
        {
          success: false,
          error: 'This invitation has expired. Ask for a new one.',
        },
        { status: 410 },
      )
    }

    return NextResponse.json({
      success: true,
      kind: 'legacy',
      invite: {
        email: user.email,
        name: user.name,
        role: user.role,
        clientId: user.client_id,
        expiresAt: user.invitation_expires_at,
        isAgencyUser: !!user.is_agency_user,
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('invite/lookup unhandled:', msg)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
