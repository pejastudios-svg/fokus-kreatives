'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const IDLE_MS = 15 * 60 * 1000
const ACTIVITY_EVENTS: (keyof WindowEventMap)[] = [
  'mousemove',
  'mousedown',
  'keydown',
  'touchstart',
  'scroll',
  'wheel',
]
const STORAGE_KEY = 'fk:lastActivity'

export function useIdleTimeout(enabled: boolean = true) {
  const router = useRouter()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const signedOutRef = useRef(false)

  useEffect(() => {
    if (!enabled) return
    const supabase = createClient()

    const signOut = async () => {
      if (signedOutRef.current) return
      signedOutRef.current = true
      try {
        localStorage.removeItem(STORAGE_KEY)
      } catch {}
      try {
        await supabase.auth.signOut()
      } finally {
        router.replace('/login?reason=idle')
      }
    }

    const scheduleFromTimestamp = (lastActive: number) => {
      if (timerRef.current) clearTimeout(timerRef.current)
      const elapsed = Date.now() - lastActive
      const remaining = Math.max(0, IDLE_MS - elapsed)
      if (remaining === 0) {
        void signOut()
        return
      }
      timerRef.current = setTimeout(() => {
        const stored = Number(localStorage.getItem(STORAGE_KEY) || '0')
        if (Date.now() - stored >= IDLE_MS) {
          void signOut()
        } else {
          scheduleFromTimestamp(stored)
        }
      }, remaining)
    }

    const recordActivity = () => {
      if (signedOutRef.current) return
      const now = Date.now()
      try {
        localStorage.setItem(STORAGE_KEY, String(now))
      } catch {}
      scheduleFromTimestamp(now)
    }

    // Always reset on activation. A stale timestamp from a previous session
    // would otherwise sign the user out immediately after login.
    recordActivity()

    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        scheduleFromTimestamp(Number(e.newValue))
      }
    }

    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return
      const last = Number(localStorage.getItem(STORAGE_KEY) || '0')
      if (last && Date.now() - last >= IDLE_MS) {
        void signOut()
      } else {
        scheduleFromTimestamp(last || Date.now())
      }
    }

    ACTIVITY_EVENTS.forEach((evt) =>
      window.addEventListener(evt, recordActivity, { passive: true })
    )
    window.addEventListener('storage', onStorage)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, recordActivity))
      window.removeEventListener('storage', onStorage)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [enabled, router])
}
