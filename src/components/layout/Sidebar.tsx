'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard,
  Users,
  UserCircle,
  Search,
  MessageSquare,
  Settings,
  LogOut,
  ChevronDown,
  ClipboardList,
  InstagramIcon,
  Calendar1Icon,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

const baseNavigation = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Clients', href: '/clients', icon: Users },
  { name: 'Team', href: '/team', icon: UserCircle },
  { name: 'Competitors', href: '/competitors', icon: Search },
  { name: 'Message Suggestions', href: '/automations', icon: MessageSquare },
  { name: 'Approvals', href: '/approvals', icon: ClipboardList },
  { name: 'Settings', href: '/settings', icon: Settings },
]

export function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  
  const [userName, setUserName] = useState('')
const [userPicture, setUserPicture] = useState<string | null>(null)
const [userRole, setUserRole] = useState<string | null>(null)
const [showUserMenu, setShowUserMenu] = useState(false)

  useEffect(() => {
    loadUserProfile()
  }, [])

  const loadUserProfile = async () => {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (user) {
    const { data } = await supabase
      .from('users')
      .select('name, profile_picture_url, role')
      .eq('id', user.id)
      .single()

    if (data) {
      setUserName(data.name || '')
      setUserPicture(data.profile_picture_url)
      setUserRole(data.role || null)
    }
  }
}

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

const filteredNavigation = baseNavigation

  return (
    <div className="flex flex-col h-full w-64 bg-brand-gradient">
      {/* Logo */}
      <div className="flex items-center justify-center h-16 px-4">
        <Image
          src="https://silly-blue-r3z2xucguf.edgeone.app/FOKUS%20CREATIVES%20logo.png"
          alt="Fokus Kreatives"
          width={100}
          height={30}
          className="object-contain w-auto h-auto max-h-8"
        />
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-4 py-6 space-y-2">
        {filteredNavigation.map((item) => {
  const isActive = pathname.startsWith(item.href)
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                'flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200',
                isActive
                  ? 'bg-white text-[#2B79F7] shadow-lg'
                  : 'text-white/80 hover:bg-white/10 hover:text-white'
              )}
            >
              <item.icon className="h-5 w-5" />
              {item.name}
            </Link>
          )
        })}
      </nav>

      {/* User Menu */}
      <div className="px-4 py-4 border-t border-white/10">
        <div className="relative">
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="flex items-center gap-3 px-4 py-3 w-full rounded-xl hover:bg-white/10 transition-all duration-200"
          >
            {userPicture ? (
              <img src={userPicture} alt={userName} className="h-8 w-8 rounded-full object-cover ring-2 ring-white/20" />
            ) : (
              <div className="h-8 w-8 rounded-full bg-white/20 flex items-center justify-center text-white text-sm font-semibold">
                {userName.charAt(0).toUpperCase() || 'U'}
              </div>
            )}
            <div className="flex-1 min-w-0 text-left">
              <p className="text-white text-sm font-medium truncate">{userName || 'User'}</p>
            </div>
            <ChevronDown className={cn(
              "h-4 w-4 text-white/50 transition-transform duration-200",
              showUserMenu && "rotate-180"
            )} />
          </button>

          {showUserMenu && (
            <div className="absolute bottom-full left-0 right-0 mb-2 bg-white rounded-xl shadow-xl overflow-hidden animate-in slide-in-from-bottom-2 fade-in duration-200">
              <Link
                href="/settings"
                className="flex items-center gap-3 px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                onClick={() => setShowUserMenu(false)}
              >
                <Settings className="h-4 w-4" />
                Settings
              </Link>
              <button
                onClick={handleLogout}
                className="flex items-center gap-3 px-4 py-3 w-full text-sm text-red-600 hover:bg-red-50 transition-colors"
              >
                <LogOut className="h-4 w-4" />
                Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}