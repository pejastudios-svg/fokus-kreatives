'use client'

import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useRouter, useParams } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard,
  Users,
  DollarSign,
  Calendar,
  FileInput,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
  UserCircleIcon,
  Sparkles,
  X,
  Lock,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Loading } from '@/components/ui/Loading'
import { Tooltip } from '@/components/ui/Tooltip'
import { PageTransition } from '@/components/ui/PageTransition'
import { NotificationPopupListener } from '@/components/notifications/NotificationPopupListener'
import { useIdleTimeout } from '@/hooks/useIdleTimeout'

interface CRMLayoutProps {
  children: React.ReactNode
}

type Role = 'admin' | 'manager' | 'employee' | 'guest' | 'client'

interface ClientInfo {
  id: string
  name: string
  business_name: string
  archived_at?: string | null
  package_tier?: 'top' | 'middle' | 'lower' | null
}

type PackageTier = 'top' | 'middle' | 'lower'

export function CRMLayout({ children }: CRMLayoutProps) {
  const pathname = usePathname()
  const pathnameRef = useRef(pathname)

useEffect(() => {
  pathnameRef.current = pathname
}, [pathname])
  const router = useRouter()
  const params = useParams()
  const clientId = (params.clientid || params.clientId) as string
  const supabase = useMemo(() => createClient(), [])

  const [isLoading, setIsLoading] = useState(true)
  const [isAuthorized, setIsAuthorized] = useState(false)

  useIdleTimeout(isAuthorized)

  const [clientInfo, setClientInfo] = useState<ClientInfo | null>(null)

  // Whether the *currently signed-in user* is a client portal user (vs agency
  // staff). Tier-based nav filtering only applies to client users; agency
  // staff always see every CRM tab so they can manage on the client's behalf.
  const [isClientUser, setIsClientUser] = useState(false)

  const [userRole, setUserRole] = useState<Role>('employee')
  const [userName, setUserName] = useState('')
  const [userEmail, setUserEmail] = useState('')
  const [userPicture, setUserPicture] = useState<string | null>(null)

  const [showUserMenu, setShowUserMenu] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [showUpgradeModal, setShowUpgradeModal] = useState(false)

  // FIX: Track which client ID we have successfully authorized
  const successClientId = useRef<string | null>(null)

  // CRM badge counts (persisted)
  const [countsLoaded, setCountsLoaded] = useState(false)
  const [leadsViewed, setLeadsViewed] = useState(false)
  const [meetingsViewed, setMeetingsViewed] = useState(false)
  const [newLeadsCount, setNewLeadsCount] = useState(0)
  const [newMeetingsCount, setNewMeetingsCount] = useState(0)

  // Popup inside CRM (for leads/meetings only; approval popups handled globally)
  const [popup, setPopup] = useState<{ type: 'lead' | 'meeting'; title: string; subtitle?: string } | null>(null)
  const popupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const playNotificationSound = () => {
    if (!audioRef.current) return
    try {
      audioRef.current.currentTime = 0
      audioRef.current.play().catch(() => {})
    } catch {}
  }

  // Load persisted counts
  useEffect(() => {
    if (typeof window === 'undefined') return

    const leadsCount = localStorage.getItem(`crm-${clientId}-leads-count`)
    const meetingsCount = localStorage.getItem(`crm-${clientId}-meetings-count`)
    const leadsViewedStatus = localStorage.getItem(`crm-${clientId}-leads-viewed`)
    const meetingsViewedStatus = localStorage.getItem(`crm-${clientId}-meetings-viewed`)

    if (leadsCount) setNewLeadsCount(parseInt(leadsCount))
    if (meetingsCount) setNewMeetingsCount(parseInt(meetingsCount))
    if (leadsViewedStatus === 'true') setLeadsViewed(true)
    if (meetingsViewedStatus === 'true') setMeetingsViewed(true)

    setCountsLoaded(true)
  }, [clientId])

  // Persist counts after loaded
  useEffect(() => {
    if (!countsLoaded || typeof window === 'undefined') return
    localStorage.setItem(`crm-${clientId}-leads-count`, String(newLeadsCount))
    localStorage.setItem(`crm-${clientId}-meetings-count`, String(newMeetingsCount))
  }, [clientId, newLeadsCount, newMeetingsCount, countsLoaded])

  useEffect(() => {
    if (!countsLoaded || typeof window === 'undefined') return
    localStorage.setItem(`crm-${clientId}-leads-viewed`, String(leadsViewed))
    localStorage.setItem(`crm-${clientId}-meetings-viewed`, String(meetingsViewed))
  }, [clientId, leadsViewed, meetingsViewed, countsLoaded])

  useEffect(() => {
    audioRef.current = new Audio(`/notifications.mp3?v=${Date.now()}`)
  }, [])

  useEffect(() => {
    if (!popup) return
    if (popupTimerRef.current) clearTimeout(popupTimerRef.current)
    popupTimerRef.current = setTimeout(() => setPopup(null), 9000)
    return () => {
      if (popupTimerRef.current) clearTimeout(popupTimerRef.current)
    }
  }, [popup])

  const handleNavClick = (itemName: string) => {
    if (itemName === 'Leads') {
      setLeadsViewed(true)
      setNewLeadsCount(0)
    }
    if (itemName === 'Meetings') {
      setMeetingsViewed(true)
      setNewMeetingsCount(0)
    }
  }

  const loadClientInfo = useCallback(async () => {
    const { data } = await supabase
      .from('clients')
      .select('id, name, business_name, archived_at, package_tier')
      .eq('id', clientId)
      .single()

    if (data) setClientInfo(data as ClientInfo)
  }, [clientId, supabase])

  const checkAccess = useCallback(async () => {
  setIsLoading(true)
  setIsAuthorized(false)

  try {
if (!clientId) {
  console.error('CRMLayout: missing clientId from params', params)
  router.push('/clients')
  return
}

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      router.push('/login')
      return
    }

    const { data: userRow } = await supabase
      .from('users')
      .select('role, email, name, profile_picture_url, client_id, is_agency_user')
      .eq('id', user.id)
      .single()

    if (!userRow) {
      router.push('/login')
      return
    }

    const email = (userRow.email || user.email || '').toLowerCase()
    const role = (userRow.role as Role) || 'employee'
    const userClientId = userRow.client_id as string | null

    setUserName(userRow.name || email || 'User')
    setUserEmail(email || '')
    // FIX: Fallback to Google/Auth picture if the database field is empty
    setUserPicture(userRow.profile_picture_url || user.user_metadata?.avatar_url || null)

    // ✅ Allow managers/employees to access this CRM if they have membership
if (role !== 'client' && role !== 'admin') {
  const { data: mem } = await supabase
    .from('client_memberships')
    .select('role')
    .eq('client_id', clientId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (mem) {
    setUserRole(mem.role as Role)
    await loadClientInfo()
    setIsAuthorized(true)
    return
  }
}
    // ✅ IMPORTANT FIX:
    // Agency admins (client_id is null) can access ANY client CRM
    if (role === 'admin' && !userClientId) {
      setUserRole('admin')
      await loadClientInfo()
      setIsAuthorized(true)
      return
    }

    // Client: can only access their own CRM, and only if their package_tier
    // includes CRM at all (Lower has no CRM access, Middle is gated to a
    // subset via the navigation filter below).
    if (role === 'client') {
      if (!userClientId || userClientId !== clientId) {
        router.push('/login')
        return
      }

      const { data: clientRow } = await supabase
        .from('clients')
        .select('package_tier')
        .eq('id', clientId)
        .single()
      const tier = (clientRow?.package_tier ?? null) as PackageTier | null

      // Only block when the tier is *explicitly* 'lower'. Null tiers stay
      // backwards-compatible with existing clients (full access) until you
      // assign them a tier on the client edit page.
      if (tier === 'lower') {
        router.push('/portal')
        return
      }

      setIsClientUser(true)
      setUserRole('admin') // client acts as admin in their CRM
      await loadClientInfo()
      setIsAuthorized(true)
      return
    }

    // If not agency admin and not client, allow membership-based access
    // (Clients are handled in the block above, so we don't need to check role !== 'client')
    if (!(role === 'admin' && !userClientId && userRow.is_agency_user)) {
      const { data: mem } = await supabase
        .from('client_memberships')
        .select('role')
        .eq('client_id', clientId)
        .eq('user_id', user.id)
        .maybeSingle()

      if (mem?.role) {
        setUserRole(mem.role as Role)
        await loadClientInfo()
        setIsAuthorized(true)
        setIsLoading(false)
        return
      }
    }

    // Non-client (manager/employee) must match client_id for now
    if (!userClientId || userClientId !== clientId) {
      router.push('/login')
      return
    }
    

  } catch (err) {
    console.error('CRM checkAccess error:', err)
    router.push('/login')
  } finally {
    setIsLoading(false)
  }
}, [clientId, router, supabase, loadClientInfo, params])

// FIX: Keep track of the last successfully loaded client ID
  useEffect(() => {
    if (isAuthorized && clientId) {
      successClientId.current = clientId
    }
  }, [isAuthorized, clientId])

 useEffect(() => {
    if (clientId) {
      // FIX: If we are already authorized for this client ID, skip the loading check
      // This prevents the full-screen spinner from showing when navigating between tabs
      if (isAuthorized && successClientId.current === clientId) {
        return
      }
      checkAccess()
    }
  }, [clientId, checkAccess, isAuthorized])

  // Realtime for leads/meetings inserts (badge + popup)
  useEffect(() => {
    if (!clientId || !isAuthorized) return

    const leadsChannel = supabase
      .channel(`crm-leads-${clientId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'leads', filter: `client_id=eq.${clientId}` },
        (payload) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const newLead = payload.new as any
          const leadName = newLead?.data?.name || newLead?.name || 'New lead'

  const onLeadsPage = pathnameRef.current.startsWith(`/crm/${clientId}/leads`)

  // ✅ Only count if you're NOT currently viewing the leads page
  if (!onLeadsPage) {
    setNewLeadsCount((p) => p + 1)
  }

  setPopup({ type: 'lead', title: 'New lead added', subtitle: leadName })
  playNotificationSound()
}
      )
      .subscribe()

    const meetingsChannel = supabase
      .channel(`crm-meetings-${clientId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'meetings', filter: `client_id=eq.${clientId}` },
        (payload) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const m = payload.new as any
          const title = m?.title || 'New meeting'

  const onMeetingsPage = pathnameRef.current.startsWith(`/crm/${clientId}/meetings`)

  if (!onMeetingsPage) {
    setNewMeetingsCount((p) => p + 1)
  }

  setPopup({ type: 'meeting', title: 'New meeting scheduled', subtitle: title })
  playNotificationSound()
}
      )
      .subscribe()

    return () => {
      supabase.removeChannel(leadsChannel)
      supabase.removeChannel(meetingsChannel)
    }
  }, [supabase, clientId, isAuthorized, leadsViewed, meetingsViewed])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  // Tier-scoped tabs - only enforced for client portal users. Agency staff
  // always see every tab regardless of the client's package tier so they can
  // manage on the client's behalf. Null tier = backwards-compatible full
  // access (existing clients keep what they had until you assign a tier).
  const allowedTiersByTab: Record<string, PackageTier[]> = {
    Dashboard: ['top'],
    Leads: ['top', 'middle'],
    Revenue: ['top'],
    Meetings: ['top', 'middle'],
    Team: ['top'],
    'Capture Pages': ['top', 'middle'],
    Settings: ['top'],
  }
  const clientTier = (clientInfo?.package_tier ?? null) as PackageTier | null
  const passesTier = (name: string) => {
    if (!isClientUser) return true
    if (clientTier === null) return true
    return allowedTiersByTab[name]?.includes(clientTier) ?? false
  }

  // Tab name → URL segment. Most are lowercase but "Capture Pages" lands at
  // /capture so we hardcode the map rather than slugify dynamically.
  const tabSlug = (name: string): string => {
    const map: Record<string, string> = {
      Dashboard: 'dashboard',
      Leads: 'leads',
      Revenue: 'revenue',
      Meetings: 'meetings',
      Team: 'team',
      'Capture Pages': 'capture',
      Settings: 'settings',
    }
    return map[name] || name.toLowerCase()
  }

  // Short copy that explains each tab in the upgrade modal. Keep these tight
  // - they show in a tooltip-style popover, not as marketing copy.
  const featureCopy: Record<string, string> = {
    Dashboard:
      'At-a-glance KPIs for your CRM - leads, meetings, revenue trends in one view.',
    Leads: 'Capture, track, and manage every lead that comes through your business.',
    Revenue:
      'Track invoices, payments, and revenue forecasts for your client work.',
    Meetings: 'Schedule meetings, send reminders, and keep a log of every call.',
    Team: 'Manage who on your side has access to this CRM workspace.',
    'Capture Pages':
      'Build embeddable lead-capture pages tied to this CRM in minutes.',
    Settings:
      'Custom field definitions, capture-page styling, and integration toggles.',
  }
  const allTabs = [
    { name: 'Dashboard', icon: LayoutDashboard, roles: ['admin','manager','employee','guest'] as Role[] },
    { name: 'Leads', icon: Users, roles: ['admin','manager'] as Role[] },
    { name: 'Revenue', icon: DollarSign, roles: ['admin','manager'] as Role[] },
    { name: 'Meetings', icon: Calendar, roles: ['admin','manager'] as Role[] },
    { name: 'Team', icon: UserCircleIcon, roles: ['admin', 'manager'] as Role[] },
    { name: 'Capture Pages', icon: FileInput, roles: ['admin','manager'] as Role[] },
    { name: 'Settings', icon: Settings, roles: ['admin','manager'] as Role[] },
  ]

  const navigation = allTabs
    .map((t) => ({ ...t, href: `/crm/${clientId}/${tabSlug(t.name)}` }))
    .filter((n) => n.roles.includes(userRole))
    .filter((n) => passesTier(n.name))

  // Tabs the current client tier doesn't include - drives the "Unlock more"
  // modal. Empty for top-tier and for null-tier (backwards-compat full access).
  const lockedTabs = isClientUser
    ? allTabs.filter(
        (t) =>
          allowedTiersByTab[t.name]?.includes(clientTier as PackageTier) === false,
      )
    : []
  const showUnlockButton = isClientUser && clientTier === 'middle' && lockedTabs.length > 0

  // Defense-in-depth: if a client portal user navigates directly to a tab
  // their tier doesn't include (e.g., Middle visiting /revenue), bounce them
  // to the first tab they CAN see. Agency staff aren't tier-gated so they
  // skip this guard.
  useEffect(() => {
    if (!isAuthorized) return
    if (!isClientUser) return
    if (clientTier === null) return
    const segment = pathname.split('/')[3] || ''
    const segmentToTabName: Record<string, string> = {
      dashboard: 'Dashboard',
      leads: 'Leads',
      revenue: 'Revenue',
      meetings: 'Meetings',
      team: 'Team',
      capture: 'Capture Pages',
      settings: 'Settings',
    }
    const tabName = segmentToTabName[segment]
    if (!tabName) return
    const allowed = allowedTiersByTab[tabName]
    if (allowed?.includes(clientTier)) return
    const fallback = navigation[0]?.href
    if (fallback) router.replace(fallback)
    else router.replace('/portal')
    // navigation + allowedTiersByTab are recomputed every render, so we key
    // off the primitives that actually trigger a real re-check.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, isAuthorized, isClientUser, clientTier, router])

  if (isLoading || !isAuthorized) {
    return <Loading fullScreen text="Loading workspace..." />
  }

  if (clientInfo?.archived_at) {
    router.push('/clients')
    return null
  }

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
          <Link href={`/crm/${clientId}/dashboard`} className={cn('flex items-center', !sidebarOpen && 'mx-auto')}>
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
            {sidebarOpen ? <ChevronLeft className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
          </button>
        </div>

        {/* Client Info */}
        {sidebarOpen && (
          <div className="px-4 py-4 border-b border-[#1E293B]">
            <div className="bg-[#1E293B] rounded-xl px-4 py-3">
              <p className="text-[#64748B] text-xs font-medium uppercase tracking-wider">Workspace</p>
              <p className="text-white text-sm font-semibold truncate mt-1">
                {clientInfo?.business_name || clientInfo?.name || 'Loading...'}
              </p>
            </div>
          </div>
        )}

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navigation.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
            const showLeadsBadge = item.name === 'Leads' && newLeadsCount > 0
            const showMeetingsBadge = item.name === 'Meetings' && newMeetingsCount > 0
            const badgeValue = (count: number) => (count > 9 ? '9+' : String(count))

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
                <item.icon className="h-5 w-5 shrink-0" />
                <span className="flex-1">{item.name}</span>

                {showLeadsBadge && (
                  <span className="ml-2 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-[#2B79F7] text-white text-[10px] font-semibold">
                    {badgeValue(newLeadsCount)}
                  </span>
                )}
                {showMeetingsBadge && (
                  <span className="ml-2 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-[#2B79F7] text-white text-[10px] font-semibold">
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
                      <span className="absolute -top-1.5 -right-1.5 min-w-4 h-4 px-1 rounded-full bg-[#2B79F7] text-white text-[9px] font-semibold flex items-center justify-center">
                        {badgeValue(newLeadsCount)}
                      </span>
                    )}
                    {showMeetingsBadge && (
                      <span className="absolute -top-1.5 -right-1.5 min-w-4 h-4 px-1 rounded-full bg-[#2B79F7] text-white text-[9px] font-semibold flex items-center justify-center">
                        {badgeValue(newMeetingsCount)}
                      </span>
                    )}
                  </div>
                </Link>
              </Tooltip>
            )
          })}
        </nav>

        {/* Unlock More - middle-tier client portal users only. Shows the
            tabs they can't access today as a teaser, with hover tooltips
            explaining each feature. Top-tier sees nothing here, lower-tier
            never gets here at all (they're redirected to /portal). */}
        {showUnlockButton && (
          sidebarOpen ? (
            <button
              type="button"
              onClick={() => setShowUpgradeModal(true)}
              className="mx-3 mb-2 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-[#2B79F7] to-[#1E54B7] text-white text-sm font-medium hover:opacity-90 transition-opacity"
            >
              <Sparkles className="h-4 w-4 shrink-0" />
              <span>Unlock more features</span>
            </button>
          ) : (
            <Tooltip content="Unlock more features" position="right">
              <button
                type="button"
                onClick={() => setShowUpgradeModal(true)}
                className="mx-3 mb-2 flex items-center justify-center p-3 rounded-xl bg-gradient-to-r from-[#2B79F7] to-[#1E54B7] text-white hover:opacity-90 transition-opacity"
              >
                <Sparkles className="h-5 w-5" />
              </button>
            </Tooltip>
          )
        )}

        {/* User / Logout */}
        <div className="px-3 py-4 border-t border-[#1E293B]">
          <div className="relative">
            <button
              onClick={() => setShowUserMenu((v) => !v)}
              className={cn(
                'flex items-center gap-3 w-full rounded-xl hover:bg-[#1E293B] transition-all duration-200',
                sidebarOpen ? 'px-4 py-3' : 'p-3 justify-center'
              )}
            >
              {userPicture ? (
               <Image 
              src={userPicture} 
              alt={userName} 
              width={32} 
              height={32} 
              unoptimized
              className="rounded-full object-cover ring-2 ring-[#2B79F7]" 
              />
              ) : (
                <div className="h-8 w-8 rounded-full bg-linear-to-br from-[#2B79F7] to-[#1E54B7] flex items-center justify-center text-white text-sm font-semibold">
                  {(userName || userEmail || 'U').charAt(0).toUpperCase()}
                </div>
              )}

              {sidebarOpen && (
                <div className="flex-1 min-w-0 text-left">
                  <p className="text-white text-sm font-medium truncate">{userName}</p>
                  <p className="text-[#64748B] text-xs capitalize">{userRole}</p>
                </div>
              )}
            </button>

            {showUserMenu && (
              <div className={cn(
                'absolute bottom-full mb-2 bg-[#1E293B] rounded-xl shadow-xl border border-[#334155] overflow-hidden z-50',
                sidebarOpen ? 'left-0 right-0' : 'left-full ml-2 w-48'
              )}>
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

      {/* Main */}
      <main className="flex-1 min-h-0 overflow-auto bg-[#0F172A] transition-colors duration-200">
        <PageTransition>
          <div className="min-h-full">{children}</div>
        </PageTransition>

        {/* Local CRM popup (leads/meetings) */}
        {popup && (
          <div className="fixed bottom-4 right-4 z-50 max-w-sm">
            <div className="bg-[#1E293B] border border-[#334155] rounded-xl px-4 py-3 shadow-theme-lg flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white">{popup.title}</p>
                {popup.subtitle && <p className="text-xs text-gray-300 mt-1 truncate">{popup.subtitle}</p>}
              </div>
              <button onClick={() => setPopup(null)} className="p-1 rounded-lg hover:bg-[#334155] text-gray-400">
                ×
              </button>
            </div>
          </div>
        )}

        {/* Global notifications popup (approvals + mentions etc) */}
        <NotificationPopupListener />

        {/* Upgrade-tier modal: shows the locked features as badges with a
            hover tooltip per badge. Backdrop click closes. Only renders for
            middle-tier client portal users (button is hidden otherwise). */}
        {showUpgradeModal && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowUpgradeModal(false)}
          >
            <div
              className="relative w-full max-w-lg rounded-2xl bg-[#0F172A] border border-[#1E293B] shadow-2xl"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
            >
              <button
                type="button"
                onClick={() => setShowUpgradeModal(false)}
                className="absolute top-3 right-3 p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-[#1E293B] transition-colors"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>

              <div className="p-6">
                <div className="flex items-center gap-2 text-[#2B79F7]">
                  <Sparkles className="h-5 w-5" />
                  <span className="text-xs font-semibold uppercase tracking-wider">Available on the Top tier</span>
                </div>
                <h3 className="mt-2 text-xl font-semibold text-white">Unlock more features</h3>
                <p className="mt-1 text-sm text-gray-400">
                  Upgrade to the Top package to add the features below to your CRM.
                </p>

                <div className="mt-5 grid grid-cols-2 gap-3">
                  {lockedTabs.map((t) => (
                    <Tooltip
                      key={t.name}
                      content={featureCopy[t.name] || ''}
                      position="top"
                    >
                      <div className="relative flex items-center gap-2 px-3 py-2.5 rounded-xl bg-[#1E293B] border border-[#334155] text-gray-300 cursor-default">
                        <t.icon className="h-4 w-4 shrink-0 text-[#94A3B8]" />
                        <span className="text-sm font-medium truncate">{t.name}</span>
                        <Lock className="h-3 w-3 ml-auto shrink-0 text-[#64748B]" />
                      </div>
                    </Tooltip>
                  ))}
                </div>

                <p className="mt-5 text-[11px] text-gray-500">
                  Hover any badge for a quick description. Reach out to your account manager to upgrade.
                </p>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}