'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Loader2 } from 'lucide-react'

interface AuthGuardProps {
  children: React.ReactNode
}

export function AuthGuard({ children }: AuthGuardProps) {
  const [isLoading, setIsLoading] = useState(true)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const router = useRouter()
  

  useEffect(() => {
  const supabase = createClient()
  const checkAuth = async () => {
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    router.push('/login')
    return
  }

  const { data: userRow } = await supabase
    .from('users')
    .select('id, role, client_id, is_agency_user')
    .eq('id', user.id)
    .maybeSingle()

  if (!userRow) {
    await supabase.auth.signOut()
    router.push('/login')
    return
  }

if (userRow.role === 'client') {
  setIsLoading(false)
  router.push('/portal/approvals')
  return
}

// ✅ Agency users stay in agency app
if (userRow.is_agency_user) {
  setIsAuthenticated(true)
  setIsLoading(false)
  return
}

// not agency user: send to first CRM
const { data: mem } = await supabase
  .from('client_memberships')
  .select('client_id')
  .eq('user_id', user.id)
  .limit(1)
  .maybeSingle()

setIsLoading(false)

if (mem?.client_id) {
  router.push(`/crm/${mem.client_id}/dashboard`)
  return
}

await supabase.auth.signOut()
router.push('/login')
return
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
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-brand-primary" />
          <p className="text-gray-500">Loading...</p>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return null
  }

  return <>{children}</>
}