'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Loader2 } from 'lucide-react'
import { useIdleTimeout } from '@/hooks/useIdleTimeout'

interface AuthGuardProps {
  children: React.ReactNode
}

export function AuthGuard({ children }: AuthGuardProps) {
  const [isLoading, setIsLoading] = useState(true)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const router = useRouter()

  useIdleTimeout(isAuthenticated)
  

  useEffect(() => {
    const supabase = createClient()
    const checkAuth = async () => {
      // Routing decisions go through /api/me/landing so they use the
      // service role - browser-side queries against `users` and
      // `client_memberships` are RLS-blocked for CRM team members and
      // would silently return null, which used to bounce them back to
      // /login in a redirect loop.
      const res = await fetch('/api/me/landing', { cache: 'no-store' })
      if (res.status === 401) {
        router.push('/login')
        return
      }
      const json = (await res.json()) as
        | { authed: false }
        | { authed: true; signOut: true; reason: string }
        | { authed: true; destination: string }
      if (!('authed' in json) || !json.authed) {
        router.push('/login')
        return
      }
      if ('signOut' in json && json.signOut) {
        await supabase.auth.signOut()
        router.push('/login')
        return
      }
      if (!('destination' in json)) {
        router.push('/login')
        return
      }
      // AuthGuard wraps the AGENCY app. If the user's actual landing
      // is somewhere else (a CRM, the portal), bounce them there.
      if (json.destination !== '/dashboard') {
        router.push(json.destination)
        return
      }
      setIsAuthenticated(true)
      setIsLoading(false)
    }

    checkAuth()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || !session) {
        router.push('/login')
      }
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [router])

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[var(--bg-tertiary)] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-brand-primary" />
          <p className="text-[var(--text-tertiary)]">Loading...</p>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return null
  }

  return <>{children}</>
}