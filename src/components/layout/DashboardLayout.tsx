'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import Image from 'next/image'
import { Sidebar } from './Sidebar'
import { NotificationPopupListener } from '@/components/notifications/NotificationPopupListener'
import { PageTransition } from '@/components/ui/PageTransition'
import { AuthGuard } from '@/components/auth/AuthGuard'
import { cn } from '@/lib/utils'

interface DashboardLayoutProps {
  children: React.ReactNode
}

const STORAGE_KEY = 'fk:sidebar:collapsed'

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  // While true, hover-expand on the desktop sidebar is suppressed. Used right
  // after the user clicks "collapse" so the cursor-still-over-sidebar doesn't
  // immediately re-expand it. Cleared on the next mouseleave.
  const [suppressHover, setSuppressHover] = useState(false)
  const pathname = usePathname()

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY)
      if (stored === 'true') setCollapsed(true)
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  useEffect(() => {
    if (!mobileOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mobileOpen])

  useEffect(() => {
    if (mobileOpen) {
      const prev = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      return () => {
        document.body.style.overflow = prev
      }
    }
  }, [mobileOpen])

  const toggleCollapse = () => {
    setCollapsed((prev) => {
      const next = !prev
      try {
        window.localStorage.setItem(STORAGE_KEY, String(next))
      } catch {
        // ignore
      }
      // After collapsing, the cursor is still on the sidebar - without this,
      // the `hover:w-64` would immediately re-expand it and the user would
      // see only the page shift, not the sidebar shrink. Re-allow hover-expand
      // once the cursor leaves the sidebar.
      if (next) setSuppressHover(true)
      return next
    })
  }

  return (
    <AuthGuard>
      <div className="agency-scope min-h-screen bg-[var(--bg-secondary)] dark:bg-black">
        {/* Desktop sidebar - fixed-positioned, only this controls actual width.
            `group/sidebar` lets labels inside fade on hover via group-hover. */}
        <aside
          onMouseLeave={() => setSuppressHover(false)}
          className={cn(
            'group/sidebar hidden md:block fixed inset-y-0 left-0 z-30',
            'transition-[width] duration-300 ease-out will-change-[width]',
            collapsed
              ? suppressHover
                ? 'w-16'
                : 'w-16 hover:w-64'
              : 'w-64',
          )}
        >
          <Sidebar collapsed={collapsed} onToggleCollapse={toggleCollapse} />
        </aside>

        {/* Mobile backdrop - z-[45] so it sits above the sticky header (z-40)
            and blurs the page logo, but below the drawer (z-50). */}
        <div
          aria-hidden="true"
          onClick={() => setMobileOpen(false)}
          className={cn(
            'md:hidden fixed inset-0 z-[45] bg-black/50 backdrop-blur-sm',
            'transition-opacity duration-300 ease-out',
            mobileOpen ? 'opacity-100' : 'opacity-0 pointer-events-none',
          )}
        />

        {/* Mobile drawer */}
        <aside
          className={cn(
            'md:hidden fixed inset-y-0 left-0 z-50 w-64 shadow-2xl',
            'transition-transform duration-300 ease-out will-change-transform',
            mobileOpen ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          <Sidebar mobile />
        </aside>

        {/* Main column - left padding matches the desktop sidebar's fixed width. */}
        <div
          className={cn(
            'min-h-screen flex flex-col',
            'transition-[padding] duration-300 ease-out',
            collapsed ? 'md:pl-16' : 'md:pl-64',
          )}
        >
          <header className="md:hidden sticky top-0 z-40 flex items-center justify-between px-4 h-14 bg-[var(--bg-primary)] border-b border-[var(--border-primary)]">
            <BurgerButton open={mobileOpen} onClick={() => setMobileOpen((o) => !o)} />
            <Image
              src="https://silly-blue-r3z2xucguf.edgeone.app/FOKUS%20CREATIVES%20logo.png"
              alt="Fokus Kreatives"
              width={100}
              height={30}
              className="object-contain w-auto h-7"
            />
            <span className="w-10" />
          </header>

          <main className="flex-1 overflow-auto bg-[var(--bg-secondary)] dark:bg-black">
            <PageTransition>{children}</PageTransition>
          </main>
        </div>

        <NotificationPopupListener />
      </div>
    </AuthGuard>
  )
}

/**
 * Two-line burger that morphs into an X when `open` is true.
 * Both bars converge to the vertical center and rotate ±45° over 300ms.
 */
function BurgerButton({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={open ? 'Close menu' : 'Open menu'}
      className="relative h-10 w-10 inline-flex items-center justify-center rounded-lg text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
    >
      <span className="relative block h-3 w-5">
        <span
          className={cn(
            'absolute left-0 right-0 top-0 h-0.5 rounded bg-current',
            'transition-all duration-300 ease-out',
            open && 'top-1/2 -translate-y-1/2 rotate-45',
          )}
        />
        <span
          className={cn(
            'absolute left-0 right-0 bottom-0 h-0.5 rounded bg-current',
            'transition-all duration-300 ease-out',
            open && 'bottom-1/2 translate-y-1/2 -rotate-45',
          )}
        />
      </span>
    </button>
  )
}
