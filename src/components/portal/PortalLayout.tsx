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

const navigation = [
  { name: 'Dashboard', href: '/portal/dashboard', icon: LayoutDashboard },
  { name: 'Leads', href: '/portal/leads', icon: Users },
  { name: 'Revenue', href: '/portal/revenue', icon: DollarSign },
  { name: 'Content', href: '/portal/content', icon: FileText },
  { name: 'Testimonials', href: '/portal/testimonials', icon: MessageSquare },
  { name: 'Automations', href: '/portal/automations', icon: Zap },
  { name: 'Settings', href: '/portal/settings', icon: Settings },
]

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
      {/* Sidebar */}
      <div className="flex flex-col h-full w-64 bg-brand-gradient">
        <div className="flex items-center justify-center h-16 px-4">
          <Image
            src="https://silly-blue-r3z2xucguf.edgeone.app/FOKUS%20CREATIVES%20logo.png"
            alt="Fokus Kreatives"
            width={100}
            height={30}
            className="object-contain w-auto h-auto max-h-8"
          />
        </div>

        <div className="px-4 py-2">
          <div className="bg-white/10 rounded-lg px-3 py-2">
            <p className="text-white/60 text-xs">Client Portal</p>
            <p className="text-white text-sm font-medium truncate">{clientName}</p>
          </div>
        </div>

        <nav className="flex-1 px-4 py-4 space-y-1">
          {navigation.map((item) => {
            const isActive = pathname === item.href
            return (
              <Link
                key={item.name}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all duration-200',
                  isActive
                    ? 'bg-white text-[#2B79F7] shadow-md'
                    : 'text-white/80 hover:bg-white/10 hover:text-white'
                )}
              >
                <item.icon className="h-5 w-5" />
                {item.name}
              </Link>
            )
          })}
        </nav>

        <div className="px-4 py-6 border-t border-white/10">
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 px-4 py-3 w-full rounded-lg text-sm font-medium text-white/80 hover:bg-white/10 hover:text-white transition-all duration-200"
          >
            <LogOut className="h-5 w-5" />
            Logout
          </button>
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  )
}