'use client'

import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
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
  Menu,
  ChevronDown,
  Inbox,
  FileSignature,
  Mail,
} from 'lucide-react'
import { createClient, ensureRealtimeAuth } from '@/lib/supabase/client'
import { effectiveCrmTier, type CustomConfig, type TierKey } from '@/lib/campaignTiers'
import { Loading } from '@/components/ui/Loading'
import { PageTransition } from '@/components/ui/PageTransition'
import { CrmRoleProvider } from '@/components/crm/CrmRoleContext'
import { NotificationPopupListener } from '@/components/notifications/NotificationPopupListener'
import { useIdleTimeout } from '@/hooks/useIdleTimeout'
import { UpgradeFeaturesModal } from '@/components/crm/UpgradeFeaturesModal'

interface CRMLayoutProps {
  children: React.ReactNode
}

type Role = 'admin' | 'manager' | 'employee' | 'guest' | 'client'

interface ClientInfo {
  id: string
  name: string
  business_name: string
  archived_at?: string | null
  package_tier?: TierKey | null
  custom_config?: CustomConfig | null
  profile_picture_url?: string | null
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
  // Inbox badge - reflects unread CRM-scoped notifications for THIS
  // client. Source of truth is the `notifications` table (no
  // localStorage cache needed). Recomputes live via the supabase
  // channel below.
  const [inboxUnreadCount, setInboxUnreadCount] = useState(0)

  // Popup inside CRM (leads/meetings/payments; approval popups handled globally)
  const [popup, setPopup] = useState<{ type: 'lead' | 'meeting' | 'payment'; title: string; subtitle?: string } | null>(null)
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
    // A popup that fires while the tab is hidden would dismiss before the
    // user ever switches back - they hear the sound, see nothing. Hold it
    // until the tab is visible, THEN start the countdown.
    const start = () => {
      if (popupTimerRef.current) clearTimeout(popupTimerRef.current)
      popupTimerRef.current = setTimeout(() => setPopup(null), 9000)
    }
    if (document.hidden) {
      const onVis = () => {
        if (!document.hidden) {
          start()
          document.removeEventListener('visibilitychange', onVis)
        }
      }
      document.addEventListener('visibilitychange', onVis)
      return () => {
        document.removeEventListener('visibilitychange', onVis)
        if (popupTimerRef.current) clearTimeout(popupTimerRef.current)
      }
    }
    start()
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

  const checkAccess = useCallback(async () => {
    setIsLoading(true)
    setIsAuthorized(false)

    try {
      if (!clientId) {
        console.error('CRMLayout: missing clientId from params', params)
        router.push('/clients')
        return
      }

      // The whole auth check runs server-side. Doing it in the browser
      // was unreliable for new CRM team members because RLS on
      // client_memberships hides their own row, so the membership
      // lookup returned null and we'd fall through to /login.
      const res = await fetch(
        `/api/crm/auth?clientId=${encodeURIComponent(clientId)}`,
        { cache: 'no-store' },
      )

      if (res.status === 401) {
        router.push('/login')
        return
      }

      const json = (await res.json()) as {
        authorized: boolean
        crmRole?: Role
        isClientUser?: boolean
        user?: {
          id: string
          email: string | null
          name: string | null
          profilePictureUrl: string | null
        }
        client?: ClientInfo
        error?: string
      }

      if (!res.ok || !json.authorized) {
        console.warn('CRM auth denied:', json.error)
        router.push('/login')
        return
      }

      // Client portal users with no CRM access (Foundation, or a custom plan
      // set to no CRM) shouldn't reach the CRM - bounce to the slim portal.
      if (json.isClientUser && json.client && effectiveCrmTier(json.client) === 'lower') {
        router.push('/portal')
        return
      }

      // Hydrate state from the route's response.
      setUserRole((json.crmRole as Role) || 'employee')
      setIsClientUser(!!json.isClientUser)
      setUserName(json.user?.name || json.user?.email || 'User')
      setUserEmail(json.user?.email || '')
      // Auth metadata avatar still wins for users who connected via OAuth.
      const { data: { user: sessionUser } } = await supabase.auth.getUser()
      setUserPicture(
        json.user?.profilePictureUrl ||
          sessionUser?.user_metadata?.avatar_url ||
          null,
      )
      if (json.client) setClientInfo(json.client)
      setIsAuthorized(true)
    } catch (err) {
      console.error('CRM checkAccess error:', err)
      router.push('/login')
    } finally {
      setIsLoading(false)
    }
  }, [clientId, router, supabase, params])

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

  // Inbox badge: recomputes the unread CRM-scoped notification count
  // for this client. Refetches initially, on every change to the
  // notifications table for this user, and whenever the user
  // navigates back into the CRM. Source of truth = notifications
  // table - the inbox page marks rows read, which fires the channel
  // and brings the badge down to zero automatically.
  useEffect(() => {
    if (!clientId || !isAuthorized) return
    let cancelled = false

    const CRM_TYPES = [
      'lead_created',
      'capture_submission',
      'meeting_created',
      'meeting_rescheduled',
      'payment_created',
      'payment_due',
      'payment_marked_paid',
    ]

    // Popup watermark: only payment rows created AFTER this moment pop.
    // The popup rides on refresh() rather than the realtime payload, so a
    // 15s poll keeps popups working even when realtime delivery fails.
    let lastSeen = new Date().toISOString()

    const refresh = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data, error } = await supabase
        .from('notifications')
        .select('id, data, type, created_at')
        .eq('user_id', user.id)
        .is('read_at', null)
        .in('type', CRM_TYPES)
      if (error || cancelled) return
      const mine = (data || []).filter((n) => {
        const d = n.data as { clientId?: unknown } | null
        return typeof d?.clientId === 'string' && d.clientId === clientId
      })
      if (!cancelled) setInboxUnreadCount(mine.length)

      const freshPayments = mine
        .filter((n) => n.type.startsWith('payment') && (n.created_at as string) > lastSeen)
        .sort((a, b) => ((a.created_at as string) < (b.created_at as string) ? 1 : -1))
      if (freshPayments.length > 0 && !cancelled) {
        const n = freshPayments[0]
        lastSeen = n.created_at as string
        const d = n.data as Record<string, unknown>
        const amount = d?.amount
        const currency = d?.currency
        const fromAgreement = typeof d?.fromAgreement === 'string' ? (d.fromAgreement as string) : ''
        setPopup({
          type: 'payment',
          title:
            n.type === 'payment_marked_paid'
              ? 'Invoice marked paid'
              : n.type === 'payment_due'
                ? 'Payment due'
                : 'Payment recorded',
          subtitle:
            [
              amount != null && currency ? `${currency} ${amount}` : '',
              fromAgreement ? `From agreement: ${fromAgreement}` : '',
            ]
              .filter(Boolean)
              .join(' · ') || undefined,
        })
        playNotificationSound()
      }
    }

    void refresh()
    const pollTimer = setInterval(() => void refresh(), 15000)

    // Same-tab fast path: the inbox page announces every mutation (mark
    // read, delete, clear) with the exact new unread count, so the badge
    // updates the instant the user acts. We apply that count immediately
    // (no bounce) and reconcile against the DB on a short delay - once the
    // write has settled - so realtime delivery isn't required.
    let localReconcile: ReturnType<typeof setTimeout> | null = null
    const onLocalChange = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | { clientId?: string; unread?: number }
        | undefined
      if (detail && detail.clientId === clientId && typeof detail.unread === 'number') {
        setInboxUnreadCount(detail.unread)
      }
      if (localReconcile) clearTimeout(localReconcile)
      localReconcile = setTimeout(() => void refresh(), 1500)
    }
    window.addEventListener('fk:notifications-changed', onLocalChange)

    let channel: ReturnType<typeof supabase.channel> | null = null
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || cancelled) return
      // RLS-gated realtime needs the user JWT on the socket - a restored
      // session doesn't propagate it reliably, which silently drops events.
      await ensureRealtimeAuth()
      channel = supabase
        .channel(`crm-inbox-badge-${clientId}-${user.id}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'notifications',
            filter: `user_id=eq.${user.id}`,
          },
          // Just a fast trigger - refresh() owns badge AND payment popups,
          // so the 15s poll below covers any realtime delivery failure.
          () => void refresh(),
        )
        .subscribe((status) => {
          if (status !== 'SUBSCRIBED' && status !== 'CLOSED') {
            console.warn('[crm-badge] realtime channel status:', status)
          }
        })
    })()

    return () => {
      cancelled = true
      clearInterval(pollTimer)
      if (localReconcile) clearTimeout(localReconcile)
      window.removeEventListener('fk:notifications-changed', onLocalChange)
      if (channel) supabase.removeChannel(channel)
    }
  }, [supabase, clientId, isAuthorized])

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
    Inbox: ['top', 'middle'],
    Leads: ['top', 'middle'],
    Revenue: ['top'],
    Meetings: ['top', 'middle'],
    Agreements: ['top'],
    Emails: ['top'],
    Team: ['top', 'middle'],
    'Capture Pages': ['top', 'middle'],
  }
  // Null/unset tier keeps backwards-compatible full access. A set tier (incl.
  // custom, which maps its CRM access onto a fixed tier's matrix) is enforced.
  const clientTier: PackageTier | null = clientInfo?.package_tier
    ? effectiveCrmTier(clientInfo)
    : null
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
      Inbox: 'inbox',
      Leads: 'leads',
      Revenue: 'revenue',
      Meetings: 'meetings',
      Agreements: 'agreements',
      Emails: 'emails',
      Team: 'team',
      'Capture Pages': 'capture',
    }
    return map[name] || name.toLowerCase()
  }

  // Tab definitions drive the nav, the locked-tab calculation, and the
  // upgrade modal (which carries its own per-feature marketing copy).
  // Every CRM role sees every tab. Per-role write gating happens INSIDE
  // each page (e.g. employees can view leads but can't add custom fields,
  // can view team but can't invite). Hiding tabs entirely from employees
  // would leave them with just "Dashboard", which defeats the point of
  // having an employee role at all.
  const allTabs = [
    { name: 'Dashboard', icon: LayoutDashboard, roles: ['admin','manager','employee','guest'] as Role[] },
    { name: 'Inbox', icon: Inbox, roles: ['admin','manager','employee'] as Role[] },
    { name: 'Leads', icon: Users, roles: ['admin','manager','employee'] as Role[] },
    { name: 'Revenue', icon: DollarSign, roles: ['admin','manager','employee'] as Role[] },
    { name: 'Meetings', icon: Calendar, roles: ['admin','manager','employee'] as Role[] },
    { name: 'Agreements', icon: FileSignature, roles: ['admin','manager','employee'] as Role[] },
    { name: 'Emails', icon: Mail, roles: ['admin','manager','employee'] as Role[] },
    { name: 'Team', icon: UserCircleIcon, roles: ['admin','manager','employee'] as Role[] },
    { name: 'Capture Pages', icon: FileInput, roles: ['admin','manager','employee'] as Role[] },
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
      agreements: 'Agreements',
      emails: 'Emails',
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
    <div className="agency-scope flex flex-col h-screen min-h-0 bg-[var(--bg-secondary)] dark:bg-black">
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
                src={
                  clientInfo?.profile_picture_url ||
                  'https://silly-blue-r3z2xucguf.edgeone.app/FOKUS%20CREATIVES%20logo.png'
                }
                alt={clientInfo?.business_name || clientInfo?.name || 'Logo'}
                width={32}
                height={32}
                unoptimized
                className="h-8 w-8 rounded-full object-cover bg-white ring-1 ring-[var(--border-primary)]"
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
              const showInboxBadge = item.name === 'Inbox' && inboxUnreadCount > 0
              const badgeCount = showLeadsBadge
                ? newLeadsCount
                : showMeetingsBadge
                ? newMeetingsCount
                : showInboxBadge
                ? inboxUnreadCount
                : 0
              // Badge style: light-blue pill on inactive tabs (works
              // on both light + dark mode), white-on-blue on the
              // active tab so it stays legible.
              const badgeClass = isActive
                ? 'bg-white/95 text-[#1E54B7]'
                : 'bg-[#2B79F7]/15 text-[#2B79F7]'
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
                  {badgeCount > 0 && (
                    <span
                      className={cn(
                        'ml-0.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold',
                        badgeClass,
                      )}
                    >
                      {badgeValue(badgeCount)}
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
                  <div className="absolute top-full right-0 mt-2 w-64 max-w-[calc(100vw-1rem)] z-50 bg-[var(--bg-secondary)] rounded-2xl shadow-2xl border border-[var(--border-primary)] overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
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
                src={
                  clientInfo?.profile_picture_url ||
                  'https://silly-blue-r3z2xucguf.edgeone.app/FOKUS%20CREATIVES%20logo.png'
                }
                alt={clientInfo?.business_name || clientInfo?.name || 'Logo'}
                width={32}
                height={32}
                unoptimized
                className="h-8 w-8 rounded-full object-cover bg-white ring-1 ring-[var(--border-primary)]"
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
                const showInboxBadge = item.name === 'Inbox' && inboxUnreadCount > 0
                const badgeCount = showLeadsBadge
                  ? newLeadsCount
                  : showMeetingsBadge
                  ? newMeetingsCount
                  : showInboxBadge
                  ? inboxUnreadCount
                  : 0
                const badgeClass = isActive
                  ? 'bg-white/95 text-[#1E54B7]'
                  : 'bg-[#2B79F7]/15 text-[#2B79F7]'
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
                    {badgeCount > 0 && (
                      <span
                        className={cn(
                          'inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold',
                          badgeClass,
                        )}
                      >
                        {badgeValue(badgeCount)}
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

      {/* Main - `scrollbar-gutter: stable` reserves the scrollbar lane at
          the very right edge so the content never shifts when the bar
          appears, and the bar sits at the screen edge rather than next to
          the cards. */}
      <main
        className="flex-1 min-h-0 overflow-auto"
        style={{ scrollbarGutter: 'stable' }}
      >
        <PageTransition>
          <CrmRoleProvider
            role={
              // The auth route can return 'guest' / 'client', but pages
              // only need the three real CRM roles. Anything outside the
              // trio gets the safest interpretation (employee).
              userRole === 'admin' || userRole === 'manager'
                ? userRole
                : 'employee'
            }
            isClientUser={isClientUser}
            workspaceName={
              clientInfo?.business_name || clientInfo?.name || 'Workspace'
            }
          >
            <div className="min-h-full">{children}</div>
          </CrmRoleProvider>
        </PageTransition>

        {/* Local CRM popup (leads/meetings) */}
        {popup && createPortal(
          <div className="fixed bottom-4 right-4 z-[90] max-w-sm">
            <div className="bg-[var(--bg-tertiary)] border border-[var(--border-secondary)] rounded-xl px-4 py-3 shadow-theme-lg flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[var(--text-primary)]">{popup.title}</p>
                {popup.subtitle && <p className="text-xs text-[var(--text-tertiary)] mt-1 truncate">{popup.subtitle}</p>}
              </div>
              <button onClick={() => setPopup(null)} className="p-1 rounded-lg hover:bg-[var(--bg-card-hover)] text-[var(--text-tertiary)]">
                ×
              </button>
            </div>
          </div>,
          document.body,
        )}

        {/* Global notifications popup (approvals + mentions etc) */}
        <NotificationPopupListener />

        {/* Upgrade-tier modal: shows locked features with blurred previews
            and a "See more" expand for each. Only renders for middle-tier
            client portal users (button is hidden otherwise). */}
        {showUpgradeModal && (
          <UpgradeFeaturesModal
            lockedTabs={lockedTabs}
            onClose={() => setShowUpgradeModal(false)}
          />
        )}
      </main>
    </div>
  )
}