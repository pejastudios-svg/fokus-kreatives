'use client'

import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { NotificationPopupListener } from '@/components/notifications/NotificationPopupListener'
import { Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

interface PortalLayoutProps {
  children: React.ReactNode
}

export function PortalLayout({ children }: PortalLayoutProps) {
  const router = useRouter()
  // Fix: Memoize supabase to prevent infinite loops in dependencies
  const supabase = useMemo(() => createClient(), [])

  const [isLoading, setIsLoading] = useState(true)
  const [isAuthorized, setIsAuthorized] = useState(false)

  useEffect(() => {
    // Fix: Define function inside useEffect to avoid hoisting and dependency issues
    const checkAuth = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      
      if (!user) {
        router.push('/login')
        return
      }

      // Check if user is a client or admin
      const { data: userData } = await supabase
        .from('users')
        .select('role, name, client_id')
        .eq('id', user.id)
        .single()

      if (!userData) {
        router.push('/login')
        return
      }

      // Allow clients and admins to view portal
      if (userData.role === 'client' || userData.role === 'admin' || userData.role === 'manager') {
        setIsAuthorized(true)
      } else {
        router.push('/dashboard')
        return
      }

      setIsLoading(false)
    }

    checkAuth()
  }, [supabase, router])

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[#2B79F7]" />
      </div>
    )
  }

  if (!isAuthorized) {
    return null
  }

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>

      <NotificationPopupListener />
    </div>
  )
}