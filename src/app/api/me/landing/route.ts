import { NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'

// Resolves where the signed-in user belongs. Used by both AuthGuard
// and the login page so neither has to do its own RLS-bound lookups
// (which broke for CRM team members - RLS hides their own
// client_memberships row, the lookup returns null, and they get
// bounced to /login in a redirect loop).
//
// Returns:
//   { authed: false }                                    - not signed in
//   { authed: true, signOut: true }                      - orphan: no row, force signout
//   { authed: true, destination: '/dashboard' }          - agency staff
//   { authed: true, destination: '/portal/approvals' }   - client on Lower tier
//   { authed: true, destination: '/crm/<id>/dashboard' } - everyone else (client owner / CRM member)

export const dynamic = 'force-dynamic'

const admin = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

type LandingResponse =
  | { authed: false }
  | { authed: true; signOut: true; reason: string }
  | { authed: true; destination: string }

export async function GET() {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json<LandingResponse>({ authed: false }, { status: 401 })
  }

  const { data: userRow } = await admin
    .from('users')
    .select('id, role, client_id, is_agency_user')
    .eq('id', user.id)
    .maybeSingle()

  if (!userRow) {
    return NextResponse.json<LandingResponse>({
      authed: true,
      signOut: true,
      reason: 'No user row',
    })
  }

  // Agency staff land on the main agency dashboard.
  if (userRow.is_agency_user) {
    return NextResponse.json<LandingResponse>({
      authed: true,
      destination: '/dashboard',
    })
  }

  // Client portal users: lower tier goes to the slim portal, everyone
  // else to their own CRM dashboard.
  if (userRow.role === 'client' && userRow.client_id) {
    const { data: client } = await admin
      .from('clients')
      .select('package_tier')
      .eq('id', userRow.client_id)
      .maybeSingle()
    if (client?.package_tier === 'lower') {
      return NextResponse.json<LandingResponse>({
        authed: true,
        destination: '/portal/approvals',
      })
    }
    return NextResponse.json<LandingResponse>({
      authed: true,
      destination: `/crm/${userRow.client_id}/dashboard`,
    })
  }

  // CRM team members (employee/manager/admin invited to a specific
  // client). Use the service role so RLS can't hide their own row.
  const { data: mem } = await admin
    .from('client_memberships')
    .select('client_id, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (mem?.client_id) {
    return NextResponse.json<LandingResponse>({
      authed: true,
      destination: `/crm/${mem.client_id}/dashboard`,
    })
  }

  // Authed but no role context anywhere - treat as orphan.
  return NextResponse.json<LandingResponse>({
    authed: true,
    signOut: true,
    reason: 'No agency role, no client, no memberships',
  })
}
