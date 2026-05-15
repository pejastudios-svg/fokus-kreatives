// Server-side admin access guard.
//
// Two gates, BOTH must pass:
//   1. The signed-in user has users.role === 'admin'
//   2. A fresh admin_reauth cookie exists (set when the user re-enters
//      their password). Cookie has a 15-minute sliding TTL that mirrors
//      the existing app inactivity timeout - so as long as the user is
//      active in the app, admin stays unlocked.
//
// Usage (in a server component or route handler):
//   const gate = await checkAdminAccess()
//   if (!gate.ok) { ...redirect to /admin-unlock or 403... }
//
// Gate states:
//   'unauthorized'  - not signed in or not role=admin. Hard 403 / sign-in.
//   'reauth_required' - signed in as admin but no fresh reauth cookie.
//                       The /admin layout redirects to /admin-unlock.
//   'ok'            - both gates pass. Proceed.

import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'

export const ADMIN_REAUTH_COOKIE = 'admin_reauth_until'
/** 15 minutes, matches the app's inactivity timeout. The cookie value
 *  is the expiry timestamp (ISO); we check it on every admin request. */
export const ADMIN_REAUTH_TTL_MS = 15 * 60 * 1000

export interface AdminGateResult {
  ok: boolean
  state: 'ok' | 'reauth_required' | 'unauthorized'
  userId: string | null
  email: string | null
}

export async function checkAdminAccess(): Promise<AdminGateResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { ok: false, state: 'unauthorized', userId: null, email: null }
  }

  // Role check via users table.
  const { data: row } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()
  if (!row || row.role !== 'admin') {
    return { ok: false, state: 'unauthorized', userId: user.id, email: user.email ?? null }
  }

  // Reauth cookie check. The cookie value is an ISO timestamp - if it's
  // in the future, the user reauthed recently and we extend (sliding).
  const jar = await cookies()
  const raw = jar.get(ADMIN_REAUTH_COOKIE)?.value
  if (!raw) {
    return { ok: false, state: 'reauth_required', userId: user.id, email: user.email ?? null }
  }
  const expiryMs = Date.parse(raw)
  if (!Number.isFinite(expiryMs) || expiryMs < Date.now()) {
    return { ok: false, state: 'reauth_required', userId: user.id, email: user.email ?? null }
  }

  return { ok: true, state: 'ok', userId: user.id, email: user.email ?? null }
}

/** Build the cookie attributes for setting the reauth cookie. Used by
 *  both the reauth route and the sliding-refresh layout (each touch on
 *  an admin page bumps the expiry forward). */
export function buildReauthCookie(now = Date.now()): {
  name: string
  value: string
  options: { httpOnly: boolean; secure: boolean; sameSite: 'lax'; path: string; maxAge: number }
} {
  const expiry = new Date(now + ADMIN_REAUTH_TTL_MS).toISOString()
  return {
    name: ADMIN_REAUTH_COOKIE,
    value: expiry,
    options: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: Math.floor(ADMIN_REAUTH_TTL_MS / 1000),
    },
  }
}
