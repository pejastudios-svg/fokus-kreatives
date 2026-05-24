'use client'

// Client-side wrapper that consumes the server-evaluated admin access
// state and either renders children (when access is OK) or pushes the
// user to the appropriate destination.
//
// Why this isn't a server-side redirect():
//
// Next.js 16's app router has a bug where an async Server Component
// layout that calls `redirect()` after an `await` puts the internal
// `Router` component into an inconsistent state - it ends up calling
// a different number of hooks across renders and crashes with
// "Rendered more hooks than during the previous render." (Stack trace
// points to app-router.tsx, not user code.)
//
// Keeping the auth check on the server (so the cookie + role lookup
// still gates access at the request boundary) but moving the actual
// navigation to a client effect sidesteps the bug entirely - the
// server only ever returns JSX, never throws a redirect-mid-render.

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  gate: 'ok' | 'reauth_required' | 'unauthorized'
  children: React.ReactNode
}

export function AdminAccessGate({ gate, children }: Props) {
  const router = useRouter()

  useEffect(() => {
    if (gate === 'unauthorized') {
      router.replace('/dashboard')
    } else if (gate === 'reauth_required') {
      router.replace('/admin-unlock')
    }
  }, [gate, router])

  if (gate !== 'ok') {
    // Brief blank state while the client-side navigation runs. The
    // unauthorized user sees nothing, which is fine - it's faster than
    // a flash of admin UI they shouldn't have seen.
    return null
  }

  return <>{children}</>
}
