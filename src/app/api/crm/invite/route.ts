import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'

// CRM team invite endpoint. Runs the user lookup, the user-row insert
// (when the invitee is brand new), and the client_memberships upsert
// using the SERVICE ROLE key so RLS doesn't block the writes. The
// browser-side flow can't do this directly because the table's RLS
// only allows reads, not writes from the anon user.
//
// Caller must be authenticated AND must have admin/manager rights for
// the target client (either as an agency admin OR via an existing
// client_memberships row with role=admin/manager).

export const dynamic = 'force-dynamic'

const admin = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

interface InviteBody {
  clientId?: string
  email?: string
  name?: string
  role?: 'admin' | 'manager' | 'employee' | 'guest'
}

export async function POST(req: NextRequest) {
  try {
    // ---- Auth: caller must be signed in --------------------------------
    const supabase = await createServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Not authenticated' },
        { status: 401 },
      )
    }

    const body = (await req.json()) as InviteBody
    const clientId = body.clientId?.trim()
    const email = body.email?.trim().toLowerCase()
    const name = body.name?.trim() || ''
    const role = (body.role || 'manager') as Exclude<InviteBody['role'], undefined>

    if (!clientId || !email) {
      return NextResponse.json(
        { success: false, error: 'Missing clientId or email' },
        { status: 400 },
      )
    }

    // ---- Authorization: caller must be admin/manager on this client ---
    // Agency admins (role=admin in users table) can invite to any CRM.
    // Otherwise the caller must have an existing membership with
    // admin/manager role on the specific client.
    const { data: me } = await admin
      .from('users')
      .select('role, client_id, is_agency_user')
      .eq('id', user.id)
      .maybeSingle()

    let allowed = me?.role === 'admin' && !me?.client_id

    if (!allowed) {
      const { data: mem } = await admin
        .from('client_memberships')
        .select('role')
        .eq('client_id', clientId)
        .eq('user_id', user.id)
        .maybeSingle()
      if (mem?.role === 'admin' || mem?.role === 'manager') allowed = true
    }

    // Client portal users count as admin in their own CRM.
    if (!allowed && me?.role === 'client' && me?.client_id === clientId) {
      allowed = true
    }

    if (!allowed) {
      return NextResponse.json(
        { success: false, error: 'You need admin or manager access on this CRM' },
        { status: 403 },
      )
    }

    // ---- Find or create the invitee user row --------------------------
    const { data: existingUser } = await admin
      .from('users')
      .select('id, email, invitation_accepted, invitation_token, is_agency_user, role')
      .eq('email', email)
      .maybeSingle()

    let userId: string
    let invitationToken: string | null = null
    let inviteAccepted = false
    let createdNew = false

    if (existingUser?.id) {
      userId = existingUser.id
      inviteAccepted = !!existingUser.invitation_accepted
      invitationToken = existingUser.invitation_token || null

      // If they exist but haven't activated yet, ensure they have a token
      // we can drop into the email's accept link.
      if (!inviteAccepted && !invitationToken) {
        invitationToken = crypto.randomUUID()
        await admin
          .from('users')
          .update({ invitation_token: invitationToken })
          .eq('id', userId)
      }
    } else {
      invitationToken = crypto.randomUUID()
      const { data: created, error: insertErr } = await admin
        .from('users')
        .insert({
          email,
          name,
          role: 'employee',
          is_agency_user: false,
          invitation_token: invitationToken,
          invitation_accepted: false,
          client_id: null,
        })
        .select('id')
        .single()

      if (insertErr || !created) {
        console.error('crm/invite user insert error:', insertErr)
        return NextResponse.json(
          {
            success: false,
            error: insertErr?.message || 'Failed to create invitee user',
          },
          { status: 500 },
        )
      }
      userId = created.id
      createdNew = true
    }

    // ---- Upsert the client_memberships row ----------------------------
    const { error: memErr } = await admin
      .from('client_memberships')
      .upsert(
        { client_id: clientId, user_id: userId, role },
        { onConflict: 'client_id,user_id' },
      )

    if (memErr) {
      console.error('crm/invite membership upsert error:', memErr)
      return NextResponse.json(
        {
          success: false,
          error: memErr.message || 'Failed to grant CRM access',
        },
        { status: 500 },
      )
    }

    return NextResponse.json({
      success: true,
      userId,
      createdNew,
      inviteAccepted,
      invitationToken,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('crm/invite unhandled error:', msg)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
