import { NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { effectiveCrmTier, type CustomConfig, type TierKey } from '@/lib/campaignTiers'

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

interface UserContext {
  id: string
  email: string | null
  role: 'admin' | 'manager' | 'employee' | 'client' | null
  isAgencyUser: boolean
  clientId: string | null
}

type LandingResponse =
  | { authed: false }
  | { authed: true; signOut: true; reason: string }
  | { authed: true; destination: string; user: UserContext }

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
    .select('id, email, role, client_id, is_agency_user')
    .eq('id', user.id)
    .maybeSingle()

  if (!userRow) {
    return NextResponse.json<LandingResponse>({
      authed: true,
      signOut: true,
      reason: 'No user row',
    })
  }

  // Caller-friendly bundle. Used by AuthGuard / CRMLayout so child
  // pages can read the user's role from context instead of doing
  // their own duplicate fetch (which caused the loading flicker on
  // role-gated buttons like Add / Delete / Archive).
  const userCtx: UserContext = {
    id: userRow.id,
    email: userRow.email,
    role: (userRow.role as UserContext['role']) ?? null,
    isAgencyUser: !!userRow.is_agency_user,
    clientId: userRow.client_id ?? null,
  }

  // Agency staff land on the main agency dashboard.
  if (userRow.is_agency_user) {
    return NextResponse.json<LandingResponse>({
      authed: true,
      destination: '/dashboard',
      user: userCtx,
    })
  }

  // Client portal users: lower tier goes to the slim portal, everyone
  // else to their own CRM dashboard.
  if (userRow.role === 'client' && userRow.client_id) {
    const { data: client } = await admin
      .from('clients')
      .select('package_tier, custom_config')
      .eq('id', userRow.client_id)
      .maybeSingle()
    // Foundation (lower) - and any custom plan with no CRM access - land on the
    // slim portal; everyone else gets their full CRM dashboard.
    const crmTier = effectiveCrmTier({
      package_tier: (client?.package_tier as TierKey | null) ?? null,
      custom_config: (client?.custom_config as CustomConfig | null) ?? null,
    })
    if (crmTier === 'lower') {
      return NextResponse.json<LandingResponse>({
        authed: true,
        destination: '/portal/approvals',
        user: userCtx,
      })
    }
    return NextResponse.json<LandingResponse>({
      authed: true,
      destination: `/crm/${userRow.client_id}/dashboard`,
      user: userCtx,
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
      user: userCtx,
    })
  }

  // Authed but no role context anywhere - treat as orphan.
  return NextResponse.json<LandingResponse>({
    authed: true,
    signOut: true,
    reason: 'No agency role, no client, no memberships',
  })
}
