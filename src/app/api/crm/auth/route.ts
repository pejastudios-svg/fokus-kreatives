import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'

// CRM access check. The browser-side check in CRMLayout was failing for
// newly-activated CRM team members because RLS on client_memberships
// blocks them from reading their own row. This route uses the service
// role to do the same lookup and returns whether the caller has access
// to the given client + their CRM role + the bare client info CRMLayout
// needs to render.

export const dynamic = 'force-dynamic'

const admin = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

type CrmRole = 'admin' | 'manager' | 'employee' | 'guest' | 'client'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const clientId = searchParams.get('clientId')
  if (!clientId) {
    return NextResponse.json(
      { authorized: false, error: 'Missing clientId' },
      { status: 400 },
    )
  }

  try {
    const supabase = await createServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json(
        { authorized: false, error: 'Not authenticated' },
        { status: 401 },
      )
    }

    // Load profile via service role so RLS doesn't return null for the
    // user's own row.
    const { data: userRow } = await admin
      .from('users')
      .select('id, email, name, role, client_id, profile_picture_url, is_agency_user')
      .eq('id', user.id)
      .maybeSingle()

    if (!userRow) {
      return NextResponse.json(
        { authorized: false, error: 'User row missing' },
        { status: 401 },
      )
    }

    const appRole = (userRow.role as CrmRole) || 'employee'
    const userClientId = userRow.client_id as string | null

    // Resolve effective CRM role.
    let crmRole: CrmRole | null = null
    let isClientUser = false

    if (appRole === 'admin' && !userClientId) {
      // Agency admin: full access to every CRM.
      crmRole = 'admin'
    } else if (appRole === 'client' && userClientId === clientId) {
      // Client portal user on their own CRM.
      crmRole = 'admin'
      isClientUser = true
    } else {
      // Anyone else needs an active membership for this client.
      const { data: mem } = await admin
        .from('client_memberships')
        .select('role')
        .eq('client_id', clientId)
        .eq('user_id', user.id)
        .maybeSingle()
      if (mem?.role) crmRole = mem.role as CrmRole
    }

    if (!crmRole) {
      return NextResponse.json(
        { authorized: false, error: 'No CRM access for this client' },
        { status: 403 },
      )
    }

    const { data: client } = await admin
      .from('clients')
      .select('id, name, business_name, archived_at, package_tier')
      .eq('id', clientId)
      .maybeSingle()

    return NextResponse.json({
      authorized: true,
      crmRole,
      isClientUser,
      user: {
        id: userRow.id,
        email: userRow.email,
        name: userRow.name,
        profilePictureUrl: userRow.profile_picture_url,
      },
      client,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('crm/auth unhandled:', msg)
    return NextResponse.json(
      { authorized: false, error: msg },
      { status: 500 },
    )
  }
}
