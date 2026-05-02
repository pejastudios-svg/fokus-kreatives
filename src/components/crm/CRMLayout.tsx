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
  UserCircleIcon,
  Sparkles,
  X,
  Lock,
  Menu,
  ChevronDown,
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
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
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
    }
    return map[name] || name.toLowerCase()
  }

  // Short copy that explains each tab in the upgrade modal. Keep these tight
  // - they show in a tooltip-style popover, not as marketing copy.
  // Settings is no longer a nav tab (lives in the profile dropdown), so it's
  // omitted from this map.
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
  }
  const allTabs = [
    { name: 'Dashboard', icon: LayoutDashboard, roles: ['admin','manager','employee','guest'] as Role[] },
    { name: 'Leads', icon: Users, roles: ['admin','manager'] as Role[] },
    { name: 'Revenue', icon: DollarSign, roles: ['admin','manager'] as Role[] },
    { name: 'Meetings', icon: Calendar, roles: ['admin','manager'] as Role[] },
    { name: 'Team', icon: UserCircleIcon, roles: ['admin', 'manager'] as Role[] },
    { name: 'Capture Pages', icon: FileInput, roles: ['admin','manager'] as Role[] },
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
    // Settings is intentionally omitted: it's reachable for everyone via
    // the profile dropdown, so we don't tier-gate the route either.
    const segmentToTabName: Record<string, string> = {
      dashboard: 'Dashboard',
      leads: 'Leads',
      revenue: 'Revenue',
      meetings: 'Meetings',
      team: 'Team',
      capture: 'Capture Pages',
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

  const initial = (userName || userEmail || 'U').charAt(0).toUpperCase()
  const badgeValue = (count: number) => (count > 9 ? '9+' : String(count))

  return (
    <div className="flex flex-col h-screen min-h-0 bg-[var(--bg-secondary)]">
      {/* Top nav - three-zone layout: left = brand, center = nav, right = actions.
          The center zone uses `flex-1 justify-center` so the nav stays
          visually centered regardless of how much space the side groups take. */}
      <header className="sticky top-0 z-30 bg-[var(--bg-primary)]/95 backdrop-blur-md border-b border-[var(--border-primary)]">
        <div className="flex items-center h-16 px-4 sm:px-6 gap-2 md:gap-4">
          {/* LEFT: burger (mobile) + logo + workspace */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              className="md:hidden p-2 -ml-2 rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] transition-colors"
              aria-label="Open navigation"
            >
              <Menu className="h-5 w-5" />
            </button>
            <Link href={`/crm/${clientId}/dashboard`} className="flex items-center gap-2">
              <Image
                src="https://silly-blue-r3z2xucguf.edgeone.app/FOKUS%20CREATIVES%20logo.png"
                alt="Fokus Kreatives"
                width={32}
                height={32}
                className="object-contain h-7 w-auto"
                priority
              />
            </Link>
            <div className="hidden md:flex items-center gap-2 pl-3 border-l border-[var(--border-primary)] min-w-0 max-w-[240px]">
              <span className="text-[var(--text-tertiary)] text-[10px] font-semibold uppercase tracking-wider shrink-0">
                Workspace
              </span>
              <span className="text-[var(--text-primary)] text-sm font-semibold truncate">
                {clientInfo?.business_name || clientInfo?.name || 'Loading...'}
              </span>
            </div>
          </div>

          {/* CENTER: desktop nav (centered via flex-1) */}
          <nav className="hidden md:flex flex-1 justify-center items-center gap-1 overflow-x-auto scrollbar-none">
            {navigation.map((item) => {
              const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
              const showLeadsBadge = item.name === 'Leads' && newLeadsCount > 0
              const showMeetingsBadge = item.name === 'Meetings' && newMeetingsCount > 0
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  onClick={() => handleNavClick(item.name)}
                  className={cn(
                    'inline-flex items-center gap-2 px-3.5 py-2 rounded-full text-sm font-medium transition-all duration-150 shrink-0',
                    isActive
                      ? 'bg-[#2B79F7] text-white shadow-md shadow-[#2B79F7]/30'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]',
                  )}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  <span>{item.name}</span>
                  {(showLeadsBadge || showMeetingsBadge) && (
                    <span className="ml-0.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-white/90 text-[#1E54B7] text-[10px] font-bold">
                      {badgeValue(showLeadsBadge ? newLeadsCount : newMeetingsCount)}
                    </span>
                  )}
                </Link>
              )
            })}
          </nav>

          {/* RIGHT: unlock-more + profile, pinned far right */}
          <div className="ml-auto md:ml-0 shrink-0 flex items-center gap-2">
            {showUnlockButton && (
              <button
                type="button"
                onClick={() => setShowUpgradeModal(true)}
                className="hidden sm:inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-gradient-to-r from-[#2B79F7] to-[#1E54B7] text-white text-xs font-semibold hover:opacity-90 transition-opacity"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Unlock more
              </button>
            )}

            {/* Profile dropdown trigger */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowUserMenu((v) => !v)}
                className="flex items-center gap-1 p-1 rounded-full hover:bg-[var(--bg-tertiary)] transition-colors"
                aria-label="Profile menu"
              >
                {userPicture ? (
                  <Image
                    src={userPicture}
                    alt={userName}
                    width={32}
                    height={32}
                    unoptimized
                    className="h-8 w-8 rounded-full object-cover ring-2 ring-[#2B79F7]"
                  />
                ) : (
                  <div className="h-8 w-8 rounded-full bg-gradient-to-br from-[#2B79F7] to-[#1E54B7] flex items-center justify-center text-white text-sm font-semibold">
                    {initial}
                  </div>
                )}
                <ChevronDown className="hidden sm:block h-3.5 w-3.5 text-[var(--text-tertiary)]" />
              </button>

              {showUserMenu && (
                <>
                  {/* Backdrop catches outside-clicks; pointer-events on the
                      menu itself stay live. */}
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setShowUserMenu(false)}
                  />
                  <div className="absolute top-full right-0 mt-2 w-64 z-50 bg-[var(--bg-secondary)] rounded-2xl shadow-2xl border border-[var(--border-primary)] overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
                    <div className="px-4 py-3 border-b border-[var(--border-primary)]">
                      <p className="text-[var(--text-primary)] text-sm font-semibold truncate">{userName || 'Signed in'}</p>
                      {userEmail && (
                        <p className="text-[var(--text-tertiary)] text-xs truncate">{userEmail}</p>
                      )}
                      {userRole && (
                        <span className="mt-1.5 inline-block px-2 py-0.5 rounded-full bg-[var(--bg-tertiary)] text-[10px] uppercase tracking-wider text-[var(--text-secondary)] font-medium">
                          {userRole}
                        </span>
                      )}
                    </div>
                    <Link
                      href={`/crm/${clientId}/settings`}
                      onClick={() => setShowUserMenu(false)}
                      className="flex items-center gap-3 px-4 py-2.5 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
                    >
                      <Settings className="h-4 w-4 text-[var(--text-secondary)]" />
                      Settings
                    </Link>
                    <button
                      type="button"
                      onClick={handleLogout}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-400 hover:bg-[var(--bg-tertiary)] hover:text-red-300 transition-colors border-t border-[var(--border-primary)]"
                    >
                      <LogOut className="h-4 w-4" />
                      Logout
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Mobile slide-in nav drawer */}
      {mobileNavOpen && (
        <div
          className="md:hidden fixed inset-0 z-50 bg-black/50 backdrop-blur-sm animate-in fade-in duration-150"
          onClick={() => setMobileNavOpen(false)}
        >
          <div
            className="bg-[var(--bg-primary)] w-72 max-w-[85vw] h-full border-r border-[var(--border-primary)] flex flex-col animate-in slide-in-from-left duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between h-16 px-4 border-b border-[var(--border-primary)]">
              <Image
                src="https://silly-blue-r3z2xucguf.edgeone.app/FOKUS%20CREATIVES%20logo.png"
                alt="Fokus Kreatives"
                width={32}
                height={32}
                className="object-contain h-7 w-auto"
              />
              <button
                type="button"
                onClick={() => setMobileNavOpen(false)}
                className="p-2 rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
                aria-label="Close navigation"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="px-4 py-4 border-b border-[var(--border-primary)]">
              <p className="text-[var(--text-tertiary)] text-[10px] font-semibold uppercase tracking-wider">
                Workspace
              </p>
              <p className="text-[var(--text-primary)] text-sm font-semibold truncate mt-1">
                {clientInfo?.business_name || clientInfo?.name || 'Loading...'}
              </p>
            </div>
            <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
              {navigation.map((item) => {
                const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
                const showLeadsBadge = item.name === 'Leads' && newLeadsCount > 0
                const showMeetingsBadge = item.name === 'Meetings' && newMeetingsCount > 0
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    onClick={() => {
                      handleNavClick(item.name)
                      setMobileNavOpen(false)
                    }}
                    className={cn(
                      'flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all',
                      isActive
                        ? 'bg-[#2B79F7] text-white'
                        : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]',
                    )}
                  >
                    <item.icon className="h-5 w-5 shrink-0" />
                    <span className="flex-1">{item.name}</span>
                    {(showLeadsBadge || showMeetingsBadge) && (
                      <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-white/90 text-[#1E54B7] text-[10px] font-bold">
                        {badgeValue(showLeadsBadge ? newLeadsCount : newMeetingsCount)}
                      </span>
                    )}
                  </Link>
                )
              })}
              {showUnlockButton && (
                <button
                  type="button"
                  onClick={() => {
                    setShowUpgradeModal(true)
                    setMobileNavOpen(false)
                  }}
                  className="w-full mt-3 flex items-center gap-2 px-4 py-3 rounded-xl bg-gradient-to-r from-[#2B79F7] to-[#1E54B7] text-white text-sm font-semibold"
                >
                  <Sparkles className="h-4 w-4" />
                  Unlock more features
                </button>
              )}
            </nav>
          </div>
        </div>
      )}

      {/* Main */}
      <main className="flex-1 min-h-0 overflow-auto">
        <PageTransition>
          <div className="min-h-full">{children}</div>
        </PageTransition>

        {/* Local CRM popup (leads/meetings) */}
        {popup && (
          <div className="fixed bottom-4 right-4 z-50 max-w-sm">
            <div className="bg-[var(--bg-tertiary)] border border-[var(--border-secondary)] rounded-xl px-4 py-3 shadow-theme-lg flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[var(--text-primary)]">{popup.title}</p>
                {popup.subtitle && <p className="text-xs text-[var(--text-tertiary)] mt-1 truncate">{popup.subtitle}</p>}
              </div>
              <button onClick={() => setPopup(null)} className="p-1 rounded-lg hover:bg-[var(--bg-card-hover)] text-[var(--text-tertiary)]">
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
              className="relative w-full max-w-lg rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-primary)] shadow-2xl"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
            >
              <button
                type="button"
                onClick={() => setShowUpgradeModal(false)}
                className="absolute top-3 right-3 p-1.5 rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>

              <div className="p-6">
                <div className="flex items-center gap-2 text-[#2B79F7]">
                  <Sparkles className="h-5 w-5" />
                  <span className="text-xs font-semibold uppercase tracking-wider">Available on the Top tier</span>
                </div>
                <h3 className="mt-2 text-xl font-semibold text-[var(--text-primary)]">Unlock more features</h3>
                <p className="mt-1 text-sm text-[var(--text-tertiary)]">
                  Upgrade to the Top package to add the features below to your CRM.
                </p>

                <div className="mt-5 grid grid-cols-2 gap-3">
                  {lockedTabs.map((t) => (
                    <Tooltip
                      key={t.name}
                      content={featureCopy[t.name] || ''}
                      position="top"
                    >
                      <div className="relative flex items-center gap-2 px-3 py-2.5 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-secondary)] text-[var(--text-secondary)] cursor-default">
                        <t.icon className="h-4 w-4 shrink-0 text-[var(--text-secondary)]" />
                        <span className="text-sm font-medium truncate">{t.name}</span>
                        <Lock className="h-3 w-3 ml-auto shrink-0 text-[var(--text-tertiary)]" />
                      </div>
                    </Tooltip>
                  ))}
                </div>

                <p className="mt-5 text-[11px] text-[var(--text-tertiary)]">
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