'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard,
  Users,
  UserCircle,
  Search,
  Settings,
  LogOut,
  ChevronDown,
  ClipboardList,
  ChevronsLeft,
  ChevronsRight,
  Sparkles,
  Sun,
  Moon,
  CalendarRange,
  ShieldCheck,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useTheme } from '@/components/providers/ThemeProvider'

const LOGO_URL = 'https://silly-blue-r3z2xucguf.edgeone.app/FOKUS%20CREATIVES%20logo.png'

const baseNavigation = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Clients', href: '/clients', icon: Users },
  { name: 'Planner', href: '/planner', icon: CalendarRange },
  { name: 'Team', href: '/team', icon: UserCircle },
  { name: 'Competitors', href: '/competitors', icon: Search },
  { name: 'Approvals', href: '/approvals', icon: ClipboardList },
  { name: 'Campaigns', href: '/campaigns', icon: Sparkles },
]

interface SidebarProps {
  /** True when the desktop sidebar is in icon-only mode. */
  collapsed?: boolean
  onToggleCollapse?: () => void
  /** True when rendered in the mobile drawer - always full-width, no collapse toggle. */
  mobile?: boolean
}

export function Sidebar({ collapsed = false, onToggleCollapse, mobile = false }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()

  const supabase = useMemo(() => createClient(), [])

  const [userName, setUserName] = useState('')
  const [userPicture, setUserPicture] = useState<string | null>(null)
  const [userRole, setUserRole] = useState<string | null>(null)
  const [showUserMenu, setShowUserMenu] = useState(false)
  const { theme, toggleTheme } = useTheme()

  // Auto-close the profile dropdown whenever the sidebar collapses (e.g. on
  // mouse-leave). Otherwise the dropdown sits there with truncated icon-only
  // labels because the sidebar shrank around it.
  useEffect(() => {
    if (collapsed) setShowUserMenu(false)
  }, [collapsed])

  useEffect(() => {
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
          setUserPicture(data.profile_picture_url || user.user_metadata?.avatar_url || null)
          setUserRole(data.role || null)
        }
      }
    }
    loadUserProfile()
  }, [supabase])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const labelHidden = !mobile && collapsed
  // Collapsed: label takes zero width & is invisible. On hover (group-hover/sidebar)
  // the wrapper expands and labels fade back in to their natural width.
  const labelClasses = cn(
    'whitespace-nowrap transition-all duration-200',
    labelHidden &&
      'max-w-0 opacity-0 overflow-hidden group-hover/sidebar:max-w-[200px] group-hover/sidebar:opacity-100',
  )

  // Row layout for nav links + user menu button:
  // - Collapsed: no padding/gap, content centered (so the icon/avatar sits in the
  //   middle of its pill instead of being shoved left by phantom gap/label space).
  // - Collapsed + hover: restore padding/gap so the label has breathing room when
  //   the rail expands.
  // - Expanded: standard padding + gap.
  const rowLayoutClasses = labelHidden
    ? 'justify-center gap-0 px-0 group-hover/sidebar:justify-start group-hover/sidebar:gap-3 group-hover/sidebar:px-3'
    : 'gap-3 px-3'

  return (
    <div
      className="flex flex-col h-full w-full bg-brand-gradient dark:border-r dark:border-[var(--border-primary)] overflow-hidden"
      onMouseLeave={() => {
        // When the desktop sidebar is in collapse-on-hover mode and the
        // cursor leaves it, the rail shrinks back to icon-only. The profile
        // dropdown anchored inside would visually clip to the narrow rail,
        // so close it on the same gesture.
        if (collapsed) setShowUserMenu(false)
      }}
    >
      {/* Logo + collapse toggle */}
      <div className="relative flex items-center justify-center h-16 shrink-0">
        <div
          className={cn(
            'flex items-center justify-center transition-all duration-200',
            labelHidden ? 'w-9 h-9' : 'w-[120px] h-9',
          )}
        >
          {/* Plain <img> so we can rely on max-w/h-full to scale the wordmark down
              into the narrow icon column when collapsed. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={LOGO_URL}
            alt="Fokus Kreatives"
            className="max-w-full max-h-full object-contain"
          />
        </div>

        {!mobile && onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            className="absolute top-1/2 -translate-y-1/2 right-2 p-1 rounded-md text-white/70 hover:text-white hover:bg-white/10 transition-all duration-200 opacity-0 group-hover/sidebar:opacity-100"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-6 space-y-1 overflow-y-auto overflow-x-hidden">
        {baseNavigation.map((item) => {
          const isActive = pathname.startsWith(item.href)
          return (
            <Link
              key={item.name}
              href={item.href}
              title={item.name}
              className={cn(
                'flex items-center py-3 rounded-xl text-sm font-medium transition-all duration-200',
                rowLayoutClasses,
                isActive
                  ? 'bg-white text-[#2B79F7] dark:bg-[#2B79F7] dark:text-white shadow-lg'
                  : 'text-white/80 hover:bg-white/10 hover:text-white',
              )}
            >
              <item.icon className="h-5 w-5 shrink-0" />
              <span className={labelClasses}>{item.name}</span>
            </Link>
          )
        })}
      </nav>

      {/* User Menu */}
      <div className="px-3 py-4 border-t border-white/10 shrink-0">
        <div className="relative">
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className={cn(
              'flex items-center py-3 w-full rounded-xl hover:bg-white/10 transition-all duration-200',
              rowLayoutClasses,
            )}
          >
            {userPicture ? (
              <Image
                src={userPicture}
                alt={userName}
                width={32}
                height={32}
                unoptimized
                className="h-8 w-8 rounded-full object-cover ring-2 ring-white/20 shrink-0"
              />
            ) : (
              <div className="h-8 w-8 rounded-full bg-white/20 flex items-center justify-center text-white text-sm font-semibold shrink-0">
                {userName.charAt(0).toUpperCase() || 'U'}
              </div>
            )}
            <div className={cn('flex-1 min-w-0 text-left', labelClasses)}>
              <p className="text-white text-sm font-medium truncate">{userName || 'User'}</p>
            </div>
            <ChevronDown
              className={cn(
                'h-4 w-4 text-white/50 transition-all duration-200 shrink-0',
                showUserMenu && 'rotate-180',
                labelHidden &&
                  'max-w-0 opacity-0 overflow-hidden group-hover/sidebar:max-w-4 group-hover/sidebar:opacity-100',
              )}
            />
          </button>

          {showUserMenu && (
            <div className="absolute bottom-full left-0 right-0 mb-2 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl shadow-xl overflow-hidden animate-in slide-in-from-bottom-2 fade-in duration-200">
              <button
                type="button"
                onClick={() => toggleTheme()}
                className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
              >
                <span className="flex items-center gap-3">
                  {theme === 'dark' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
                  Theme
                </span>
                <span className="text-xs text-[var(--text-tertiary)] capitalize">{theme}</span>
              </button>
              <Link
                href="/settings"
                className="flex items-center gap-3 px-4 py-2.5 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors border-t border-[var(--border-primary)]"
                onClick={() => setShowUserMenu(false)}
              >
                <Settings className="h-4 w-4" />
                Settings
              </Link>
              {userRole === 'admin' && (
                <Link
                  href="/admin"
                  className="flex items-center gap-3 px-4 py-2.5 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors border-t border-[var(--border-primary)]"
                  onClick={() => setShowUserMenu(false)}
                >
                  <ShieldCheck className="h-4 w-4" />
                  Admin
                </Link>
              )}
              <button
                onClick={handleLogout}
                className="flex items-center gap-3 px-4 py-2.5 w-full text-sm text-red-500 hover:bg-[var(--bg-tertiary)] transition-colors border-t border-[var(--border-primary)]"
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
