import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'

// List CRM members for a client. Uses the service-role admin client so
// the embedded users join returns rows even when the caller's RLS
// policy on `users` only lets them read their own row. The browser
// query at team/page.tsx was returning empty rows because the join
// silently produced null users -> the page rendered "No team members".
//
// Caller must be authenticated AND have admin/manager rights on the
// client (agency admin, CRM admin/manager, or the client portal user).

export const dynamic = 'force-dynamic'

const admin = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function GET(req: NextRequest) {
  try {
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

    const { searchParams } = new URL(req.url)
    const clientId = searchParams.get('clientId')
    if (!clientId) {
      return NextResponse.json(
        { success: false, error: 'Missing clientId' },
        { status: 400 },
      )
    }

    // Authorize the caller (same rules as the invite route).
    const { data: me } = await admin
      .from('users')
      .select('role, client_id')
      .eq('id', user.id)
      .maybeSingle()

    let allowed = me?.role === 'admin' && !me?.client_id

    if (!allowed) {
      // Read-only list: any active CRM membership can see the team
      // (employees included). Per-member writes live on a separate
      // route and stay admin-only.
      const { data: mem } = await admin
        .from('client_memberships')
        .select('role')
        .eq('client_id', clientId)
        .eq('user_id', user.id)
        .maybeSingle()
      if (
        mem?.role === 'admin' ||
        mem?.role === 'manager' ||
        mem?.role === 'employee'
      ) {
        allowed = true
      }
    }
    if (!allowed && me?.role === 'client' && me?.client_id === clientId) {
      allowed = true
    }
    if (!allowed) {
      return NextResponse.json(
        { success: false, error: 'Forbidden' },
        { status: 403 },
      )
    }

    // Fetch memberships + the joined user rows. Service role bypasses
    // RLS so we always get a populated user object.
    const { data, error } = await admin
      .from('client_memberships')
      .select(
        `role, created_at,
         users:user_id(id, email, name, profile_picture_url, invitation_token, invitation_accepted, created_at)`,
      )
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('crm/members fetch error:', error)
      return NextResponse.json(
        { success: false, error: error.message || 'Fetch failed' },
        { status: 500 },
      )
    }

    type DbUser = {
      id: string
      email: string
      name: string | null
      profile_picture_url: string | null
      invitation_token: string | null
      invitation_accepted: boolean
      created_at: string
    }

    const members = (data || [])
      .map((m) => {
        const item = m as { role: string; users: DbUser | DbUser[] | null }
        const u = Array.isArray(item.users) ? item.users[0] : item.users
        if (!u?.id) return null
        return {
          id: u.id,
          email: u.email,
          name: u.name,
          profile_picture_url: u.profile_picture_url,
          invitation_token: u.invitation_token,
          invitation_accepted: !!u.invitation_accepted,
          created_at: u.created_at,
          role: item.role,
        }
      })
      .filter(Boolean)

    return NextResponse.json({ success: true, members })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('crm/members unhandled:', msg)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
