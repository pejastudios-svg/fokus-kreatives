'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard,
  Users,
  DollarSign,
  FileText,
  MessageSquare,
  Zap,
  Settings,
  LogOut,
  Loader2,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'



interface PortalLayoutProps {
  children: React.ReactNode
}

export function PortalLayout({ children }: PortalLayoutProps) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const [isLoading, setIsLoading] = useState(true)
  const [isAuthorized, setIsAuthorized] = useState(false)
  const [clientName, setClientName] = useState('')

  useEffect(() => {
    checkAuth()
  }, [])

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
      setClientName(userData.name || 'Client')
    } else {
      router.push('/dashboard')
      return
    }

    setIsLoading(false)
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

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
    </div>
  )
}