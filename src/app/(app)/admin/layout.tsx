// Server layout for /admin/*. Runs the two-gate check on every nav:
//   1. Signed in + role=admin (otherwise hard redirect to /dashboard)
//   2. Fresh admin_reauth_until cookie (otherwise redirect to /admin-unlock)
//
// The unlock page lives at /admin-unlock (NOT /admin/locked) so this
// layout doesn't apply to it - otherwise the layout's "reauth_required"
// redirect would loop the unlock page back to itself when the cookie
// is still missing.
//
// The cookie is sliding - it doesn't auto-refresh on layout render
// because that would defeat the inactivity-timeout semantics. The cookie
// is set once on successful password reauth and lasts 15 min. To stay
// inside admin past 15 min, the user re-enters their password (same
// pattern as the rest of the app's session timeout).

import { redirect } from 'next/navigation'
import { checkAdminAccess } from '@/lib/admin/guard'

export const dynamic = 'force-dynamic'

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const gate = await checkAdminAccess()
  if (gate.state === 'unauthorized') redirect('/dashboard')
  if (gate.state === 'reauth_required') redirect('/admin-unlock')

  return <>{children}</>
}
