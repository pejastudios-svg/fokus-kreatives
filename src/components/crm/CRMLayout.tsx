'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useRouter, useParams } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard,
  Users,
  MessageSquare,
  DollarSign,
  UserPlus,
  Calendar,
  FileInput,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Moon,
  Sun,
  Menu,
  X,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Loading } from '@/components/ui/Loading'
import { Tooltip } from '@/components/ui/Tooltip'

interface CRMLayoutProps {
  children: React.ReactNode
}

type Role = 'admin' | 'manager' | 'employee' | 'guest' | 'client'

interface ClientInfo {
  id: string
  name: string
  business_name: string
}

// Simple cache to avoid re-fetching client info too often
const clientCache = new Map<string, ClientInfo>()

// Super admin emails – always admins for any CRM
const SUPER_ADMINS = [
  'jedidiahbenenoch@gmail.com',
  'fokuskreatives@gmail.com',
]

export function CRMLayout({ children }: CRMLayoutProps) {
  const pathname = usePathname()
  const router = useRouter()
  const params = useParams()
  const clientId = params.clientId as string
  const supabase = createClient()
      const handleNavClick = (itemName: string) => {
    switch (itemName) {
      case 'Leads':
        setNewLeadsCount(0)
        break
      case 'Meetings':
        setNewMeetingsCount(0)
        break
      default:
        break
    }
  }

  const [isLoading, setIsLoading] = useState(true)
  const [isAuthorized, setIsAuthorized] = useState(false)
  const [clientInfo, setClientInfo] = useState<ClientInfo | null>(clientCache.get(clientId) || null)
  const [userRole, setUserRole] = useState<Role>('employee')
  const [userName, setUserName] = useState<string>('')
  const [userEmail, setUserEmail] = useState<string>('')
  const [userPicture, setUserPicture] = useState<string | null>(null)
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)

    // New leads/meetings counts for this CRM
  const [newLeadsCount, setNewLeadsCount] = useState(0)
  const [newMeetingsCount, setNewMeetingsCount] = useState(0)

  // Popup notification for this CRM
  const [popup, setPopup] = useState<{
    type: 'lead' | 'meeting'
    title: string
    subtitle?: string
  } | null>(null)

  const popupTimerRef = useRef<NodeJS.Timeout | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

    useEffect(() => {
    // Prepare notification sound for this CRM
    audioRef.current = new Audio('/notifications.mp3')
  }, [])

    const playNotificationSound = () => {
    if (!audioRef.current) return
    try {
      audioRef.current.currentTime = 0
      audioRef.current
        .play()
        .then(() => {
          console.log('Notification sound played')
        })
        .catch((err) => {
          console.warn('Notification sound blocked/failed', err)
        })
    } catch (err) {
      console.warn('Notification sound exception', err)
    }
  }

    useEffect(() => {
    if (!popup) return
    if (popupTimerRef.current) {
      clearTimeout(popupTimerRef.current)
    }
    popupTimerRef.current = setTimeout(() => {
      setPopup(null)
    }, 10000)
    return () => {
      if (popupTimerRef.current) {
        clearTimeout(popupTimerRef.current)
      }
    }
  }, [popup])

  

  // Main access check: auth + users table
  const checkAccess = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      router.push('/login')
      return
    }

    // Fetch user row from users table
    const { data: userRow, error } = await supabase
      .from('users')
      .select('role, email, name, profile_picture_url, client_id')
      .eq('id', user.id)
      .single()

    if (error || !userRow) {
      // No matching user record -> no access
      router.push('/login')
      return
    }

    const email = (userRow.email || user.email || '').toLowerCase()
    const role = (userRow.role as Role) || 'employee'
    const userClientId = userRow.client_id as string | null

    setUserName(userRow.name || email || 'User')
    setUserEmail(email || '')
    setUserPicture(userRow.profile_picture_url || null)

    // SUPER ADMINS: always admin for any CRM
    if (email && SUPER_ADMINS.includes(email)) {
      setUserRole('admin')
      await loadClientInfo()
      setIsAuthorized(true)
      setIsLoading(false)
      return
    }

    // CLIENT user: admin on their own CRM
    if (role === 'client') {
      // Optional: ensure this CRM matches their client_id
      // If you want to restrict, uncomment:
      // if (userClientId && userClientId !== clientId) {
      //   router.push('/login')
      //   return
      // }
      setUserRole('admin')
      await loadClientInfo()
      setIsAuthorized(true)
      setIsLoading(false)
      return
    }

    // Non-client: must have matching client_id for this CRM
    if (!userClientId || userClientId !== clientId) {
      // They belong to a different CRM or none
      router.push('/login')
      return
    }

    // At this point role should be one of admin, manager, employee, guest
    setUserRole(role)
    await loadClientInfo()
    setIsAuthorized(true)
    setIsLoading(false)
  }, [clientId, router, supabase])

  if (clientCache.get(clientId)?.archived_at) {
  // CRM is archived, no access
  router.push('/clients') // or a dedicated "Archived" message
  return
}

  useEffect(() => {
    if (clientId) {
      checkAccess()
    }
  }, [clientId, checkAccess])

  const loadClientInfo = async () => {
    if (clientCache.has(clientId)) {
      setClientInfo(clientCache.get(clientId)!)
      return
    }

    const { data, error } = await supabase
  .from('clients')
  .select('id, name, business_name, archived_at')
  .eq('id', clientId)
  .single()

    if (!error && data) {
      clientCache.set(clientId, data as ClientInfo)
      setClientInfo(data as ClientInfo)
    }
  }

    useEffect(() => {
    if (!clientId) return

    console.log('CRM notifications subscribed for client', clientId)


    // New leads for this CRM
    const leadsChannel = supabase
      .channel(`crm-leads-${clientId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'leads',
          filter: `client_id=eq.${clientId}`,
        },
        (payload) => {
        console.log('Realtime lead INSERT for CRM', clientId, payload)
          const newLead = payload.new as any
          const leadName =
            newLead.data?.name ||
            newLead.name ||
            'New lead'

          setNewLeadsCount((prev) => prev + 1)
          setPopup({
            type: 'lead',
            title: 'New lead added',
            subtitle: leadName,
          })
          playNotificationSound()
        }
      )
      .subscribe()

    // New meetings for this CRM
    const meetingsChannel = supabase
      .channel(`crm-meetings-${clientId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'meetings',
          filter: `client_id=eq.${clientId}`,
        },
        (payload) => {
        console.log('Realtime meeting INSERT for CRM', clientId, payload)
          const newMeeting = payload.new as any
          const meetingTitle = newMeeting.title || 'New meeting'

          setNewMeetingsCount((prev) => prev + 1)
          setPopup({
            type: 'meeting',
            title: 'New meeting scheduled',
            subtitle: meetingTitle,
          })
          playNotificationSound()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(leadsChannel)
      supabase.removeChannel(meetingsChannel)
    }
  }, [supabase, clientId])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  // Navigation based on user role
  const getNavigation = () => {
    const allNav = [
      {
        name: 'Dashboard',
        href: `/crm/${clientId}/dashboard`,
        icon: LayoutDashboard,
        roles: ['admin', 'manager', 'employee', 'guest'] as Role[],
      },
      {
        name: 'Leads',
        href: `/crm/${clientId}/leads`,
        icon: Users,
        roles: ['admin', 'manager'],
      },
      {
        name: 'Revenue',
        href: `/crm/${clientId}/revenue`,
        icon: DollarSign,
        roles: ['admin', 'manager'],
      },
      {
        name: 'Team',
        href: `/crm/${clientId}/team`,
        icon: Users,
        roles: ['admin', 'manager'],
      },
      {
        name: 'Meetings',
        href: `/crm/${clientId}/meetings`,
        icon: Calendar,
        roles: ['admin', 'manager'],
      },
      {
        name: 'Capture Pages',
        href: `/crm/${clientId}/capture`,
        icon: FileInput,
        roles: ['admin'],
      },
      {
        name: 'Settings',
        href: `/crm/${clientId}/settings`,
        icon: Settings,
        roles: ['admin'],
      },
    ]

    return allNav.filter(item => item.roles.includes(userRole))
  }

  if (isLoading || !isAuthorized) {
    return <Loading fullScreen text="Loading workspace..." />
  }

  const navigation = getNavigation()

  return (
    <div className="flex h-screen min-h-0 dark">
      {/* Sidebar */}
      <aside
        className={cn(
          'flex flex-col h-full bg-[#0A0F1C] border-r border-[#1E293B] transition-all duration-300',
          sidebarOpen ? 'w-64' : 'w-20'
        )}
      >
        {/* Logo */}
        <div className="flex items-center justify-between h-16 px-4 border-b border-[#1E293B]">
          <Link
            href={`/crm/${clientId}/dashboard`}
            className={cn('flex items-center', !sidebarOpen && 'mx-auto')}
          >
            <Image
              src="https://silly-blue-r3z2xucguf.edgeone.app/FOKUS%20CREATIVES%20logo.png"
              alt="Fokus Kreatives"
              width={sidebarOpen ? 100 : 32}
              height={32}
              className="object-contain h-8 w-auto"
              priority
            />
          </Link>
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className={cn(
              'p-2 rounded-lg hover:bg-[#1E293B] text-[#64748B] hover:text-white transition-colors',
              !sidebarOpen && 'hidden lg:block'
            )}
          >
            {sidebarOpen ? (
              <ChevronLeft className="h-5 w-5" />
            ) : (
              <ChevronRight className="h-5 w-5" />
            )}
          </button>
        </div>

        {/* Client Info */}
        {sidebarOpen && (
          <div className="px-4 py-4 border-b border-[#1E293B]">
            <div className="bg-[#1E293B] rounded-xl px-4 py-3">
              <p className="text-[#64748B] text-xs font-medium uppercase tracking-wider">
                Workspace
              </p>
              <p className="text-white text-sm font-semibold truncate mt-1">
                {clientInfo?.business_name || clientInfo?.name || 'Loading...'}
              </p>
            </div>
          </div>
        )}

        {/* Navigation */}
                <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navigation.map((item) => {
            const isActive =
              pathname === item.href || pathname.startsWith(item.href + '/')

            const showLeadsBadge =
              item.name === 'Leads' && newLeadsCount > 0
            const showMeetingsBadge =
              item.name === 'Meetings' && newMeetingsCount > 0

            const badgeValue = (count: number) =>
              count > 9 ? '9+' : String(count)

            return sidebarOpen ? (
              <Link
                key={item.name}
                href={item.href}
                onClick={() => handleNavClick(item.name)}
                className={cn(
                  'flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200',
                  isActive
                    ? 'bg-[#2B79F7] text-white shadow-lg shadow-[#2B79F7]/25'
                    : 'text-[#94A3B8] hover:bg-[#1E293B] hover:text-white'
                )}
              >
                <item.icon className="h-5 w-5 flex-shrink-0" />
                <span className="flex-1">{item.name}</span>

                {showLeadsBadge && (
                  <span className="ml-2 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-[#2B79F7] text-white text-[10px] font-semibold shadow-[0_0_8px_rgba(43,121,247,0.8)]">
                    {badgeValue(newLeadsCount)}
                  </span>
                )}
                {showMeetingsBadge && (
                  <span className="ml-2 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-[#2B79F7] text-white text-[10px] font-semibold shadow-[0_0_8px_rgba(43,121,247,0.8)]">
                    {badgeValue(newMeetingsCount)}
                  </span>
                )}
              </Link>
            ) : (
              <Tooltip key={item.name} content={item.name} position="right">
                <Link
                  href={item.href}
                  onClick={() => handleNavClick(item.name)}
                  className={cn(
                    'relative flex items-center justify-center p-3 rounded-xl transition-all duration-200',
                    isActive
                      ? 'bg-[#2B79F7] text-white shadow-lg shadow-[#2B79F7]/25'
                      : 'text-[#94A3B8] hover:bg-[#1E293B] hover:text-white'
                  )}
                >
                  <div className="relative">
                    <item.icon className="h-5 w-5" />
                    {showLeadsBadge && (
                      <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-[16px] px-1 rounded-full bg-[#2B79F7] text-white text-[9px] font-semibold flex items-center justify-center shadow-[0_0_6px_rgba(43,121,247,0.8)]">
                        {badgeValue(newLeadsCount)}
                      </span>
                    )}
                    {showMeetingsBadge && (
                      <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-[16px] px-1 rounded-full bg-[#2B79F7] text-white text-[9px] font-semibold flex items-center justify-center shadow-[0_0_6px_rgba(43,121,247,0.8)]">
                        {badgeValue(newMeetingsCount)}
                      </span>
                    )}
                  </div>
                </Link>
              </Tooltip>
            )
          })}
        </nav>

        {/* Bottom Section */}
        <div className="px-3 py-4 border-t border-[#1E293B] space-y-2">

          {/* User Profile */}
          <div className="relative">
            <button
              onClick={() => setShowUserMenu(!showUserMenu)}
              className={cn(
                'flex items-center gap-3 w-full rounded-xl hover:bg-[#1E293B] transition-all duration-200',
                sidebarOpen ? 'px-4 py-3' : 'p-3 justify-center'
              )}
            >
              {userPicture ? (
                <img
                  src={userPicture}
                  alt={userName}
                  className="h-8 w-8 rounded-full object-cover ring-2 ring-[#2B79F7]"
                />
              ) : (
                <div className="h-8 w-8 rounded-full bg-gradient-to-br from-[#2B79F7] to-[#1E54B7] flex items-center justify-center text-white text-sm font-semibold flex-shrink-0">
                  {(userName || userEmail || 'U').charAt(0).toUpperCase()}
                </div>
              )}
              {sidebarOpen && (
                <>
                  <div className="flex-1 min-w-0 text-left">
                    <p className="text-white text-sm font-medium truncate">
                      {userName}
                    </p>
                    <p className="text-[#64748B] text-xs capitalize">
                      {userRole}
                    </p>
                  </div>
                  <ChevronLeft
                    className={cn(
                      'h-4 w-4 text-[#64748B] transition-transform duration-200',
                      showUserMenu && 'rotate-90'
                    )}
                  />
                </>
              )}
            </button>

            {showUserMenu && (
              <div
                className={cn(
                  'absolute bottom-full mb-2 bg-[#1E293B] rounded-xl shadow-xl border border-[#334155] overflow-hidden z-50',
                  sidebarOpen ? 'left-0 right-0' : 'left-full ml-2 w-48'
                )}
              >
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-3 px-4 py-3 w-full text-sm text-red-400 hover:bg-[#334155] hover:text-red-300 transition-colors"
                >
                  <LogOut className="h-4 w-4" />
                  Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 min-h-0 overflow-auto bg-[#0F172A] transition-colors duration-200">
        <div className="page-enter min-h-full">
          {children}
        </div>
      </main>
            {/* Popup notification for this CRM */}
      {popup && (
        <div className="fixed bottom-4 right-4 z-50 max-w-sm">
          <div className="bg-[#1E293B] border border-[#334155] rounded-xl px-4 py-3 shadow-theme-lg flex items-start gap-3">
            <div className="mt-0.5">
              {popup.type === 'lead' ? (
                <Users className="h-4 w-4 text-[#2B79F7]" />
              ) : (
                <Calendar className="h-4 w-4 text-[#2B79F7]" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white">{popup.title}</p>
              {popup.subtitle && (
                <p className="text-xs text-gray-300 mt-1 truncate">
                  {popup.subtitle}
                </p>
              )}
            </div>
            <button
              onClick={() => setPopup(null)}
              className="p-1 rounded-lg hover:bg-[#334155] text-gray-400"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}