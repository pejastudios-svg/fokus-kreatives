import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'

// Shared auth helpers for the CRM team routes. Three access levels:
//   - "member"   : any active CRM membership (admin/manager/employee)
//                  passes. Used for READ endpoints where the whole team
//                  legitimately needs visibility (members list, pending
//                  invites list - employees can see who else is on the
//                  team but can't act on invites).
//   - "manager"  : admin OR manager on the client. Used when employees
//                  shouldn't even see the data.
//   - "admin"    : admin only. Used for WRITE endpoints that change who
//                  can access the CRM (invite, role change, remove,
//                  cancel/resend invites). Mirrors the team-page UI
//                  which hides those actions from managers and employees.
//
// Agency admins (role='admin', client_id=NULL) and the client portal
// user always satisfy the admin level for their own CRM.

export const adminClient = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export type CrmRole = 'admin' | 'manager' | 'employee'
export type AccessLevel = 'member' | 'manager' | 'admin'

export interface AuthorizedCaller {
  user: { id: string; email: string | null }
  /** True when caller's effective role on the client is admin. */
  isAdmin: boolean
}

interface AuthorizeOptions {
  /**
   * Minimum effective role the caller must have. Defaults to 'manager'
   * (admin OR manager pass). Set to 'admin' for endpoints that change
   * team membership.
   */
  level?: AccessLevel
}

export async function authorizeForClient(
  clientId: string,
  opts: AuthorizeOptions = {},
): Promise<
  | { ok: true; caller: AuthorizedCaller }
  | { ok: false; status: number; error: string }
> {
  const level: AccessLevel = opts.level || 'manager'
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, status: 401, error: 'Not authenticated' }

  // Agency admin (no client_id) is admin on every client.
  const { data: me } = await adminClient
    .from('users')
    .select('role, client_id')
    .eq('id', user.id)
    .maybeSingle()

  let effectiveRole: CrmRole | null = null

  if (me?.role === 'admin' && !me?.client_id) {
    effectiveRole = 'admin'
  } else if (me?.role === 'client' && me?.client_id === clientId) {
    // Client portal user is admin on their own CRM.
    effectiveRole = 'admin'
  } else {
    const { data: mem } = await adminClient
      .from('client_memberships')
      .select('role')
      .eq('client_id', clientId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (mem?.role === 'admin') effectiveRole = 'admin'
    else if (mem?.role === 'manager') effectiveRole = 'manager'
    else if (mem?.role === 'employee') effectiveRole = 'employee'
  }

  // Gate by required level.
  const passes =
    level === 'admin'
      ? effectiveRole === 'admin'
      : level === 'manager'
        ? effectiveRole === 'admin' || effectiveRole === 'manager'
        : // 'member' - any role on the client passes
          effectiveRole === 'admin' ||
          effectiveRole === 'manager' ||
          effectiveRole === 'employee'

  if (!passes) {
    return {
      ok: false,
      status: 403,
      error:
        level === 'admin'
          ? 'Only CRM admins can perform this action'
          : level === 'manager'
            ? 'You need admin or manager access on this CRM'
            : 'You need to be a member of this CRM',
    }
  }

  return {
    ok: true,
    caller: {
      user: { id: user.id, email: user.email ?? null },
      isAdmin: effectiveRole === 'admin',
    },
  }
}
