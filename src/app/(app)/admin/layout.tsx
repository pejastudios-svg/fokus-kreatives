// Server layout for /admin/*. Runs the two-gate check on every nav:
//   1. Signed in + role=admin (otherwise redirect to /dashboard)
//   2. Fresh admin_reauth_until cookie (otherwise redirect to /admin-unlock)
//
// The unlock page lives at /admin-unlock (NOT /admin/locked) so this
// layout doesn't apply to it - otherwise the gate's "reauth_required"
// state would loop the unlock page back to itself when the cookie is
// still missing.
//
// We deliberately do NOT call `redirect()` from this async layout.
// Next.js 16's app router crashes with "Rendered more hooks than
// during the previous render." inside its own Router component when
// an async server layout throws a redirect after an `await`. Instead,
// the gate result is handed to a client component (AdminAccessGate)
// that calls router.replace() in an effect - the server only ever
// returns JSX, never throws mid-render. The auth check itself still
// runs server-side, so the cookie + role gate hasn't been weakened.
//
// The cookie is sliding - it doesn't auto-refresh on layout render
// because that would defeat the inactivity-timeout semantics. The
// cookie is set once on successful password reauth and lasts 15 min.
// To stay inside admin past 15 min, the user re-enters their password
// (same pattern as the rest of the app's session timeout).

import { checkAdminAccess } from '@/lib/admin/guard'
import { AdminAccessGate } from './_AccessGate'

export const dynamic = 'force-dynamic'

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const gate = await checkAdminAccess()

  return <AdminAccessGate gate={gate.state}>{children}</AdminAccessGate>
}
