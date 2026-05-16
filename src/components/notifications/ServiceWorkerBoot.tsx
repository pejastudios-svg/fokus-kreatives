'use client'

// Mounted once at the root layout. Two jobs:
//   1. Register the service worker (idempotent) on first paint so
//      push delivery is wired up the moment the user opts in via
//      Settings. We DON'T request notification permission here -
//      that has to come from a user gesture per browser policy.
//   2. Listen for the "notification-click" postMessage from the SW
//      (sent when the user clicks a push toast that already has a
//      tab open). When it arrives, navigate the SPA to the toast's
//      target URL without a full page reload.

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export function ServiceWorkerBoot() {
  const router = useRouter()

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator)) return

    // Register SW (no-op if already registered).
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((err) => {
      console.warn('[sw-boot] register failed:', err)
    })

    // SW -> client messages. The SW sends one of these when the user
    // clicks a push notification while a tab is open.
    const onMessage = (event: MessageEvent) => {
      const data = event.data
      if (!data || typeof data !== 'object') return
      if ((data as { type?: string }).type !== 'notification-click') return
      const url = (data as { url?: string }).url
      if (typeof url === 'string' && url) router.push(url)
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => {
      navigator.serviceWorker.removeEventListener('message', onMessage)
    }
  }, [router])

  return null
}
