'use client'

// Single global toggle for browser/desktop push notifications. Lives
// on the Settings page (workspace + CRM). When on, the browser sends
// push notifications even when the tab is closed (or the browser is
// closed entirely on desktop). When off, only the in-app toasts /
// header bell / Inbox tab show activity.
//
// Permission is per-device + per-origin. The toggle reflects the
// current SW + permission state on this specific browser.

import { useEffect, useState } from 'react'
import { Bell, BellOff, AlertCircle } from 'lucide-react'
import {
  isPushSupported,
  getNotificationPermission,
  hasActiveSubscription,
  subscribeToPush,
  unsubscribeFromPush,
} from '@/lib/pushNotifications'

export function BrowserNotificationsToggle() {
  const [supported, setSupported] = useState(true)
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default')
  const [active, setActive] = useState(false)
  const [busy, setBusy] = useState(false)
  // Last test push result - rendered inline so the user can read it
  // on the device without opening DevTools. Helps distinguish "no
  // subscription registered" from "subscription exists but OS
  // suppressed the toast".
  const [testResult, setTestResult] = useState<string | null>(null)

  // Hydrate on mount: figure out the current state on THIS browser
  // (permission + whether the SW has a live subscription).
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const ok = isPushSupported()
      if (!ok) {
        if (!cancelled) {
          setSupported(false)
          setPermission('unsupported')
        }
        return
      }
      if (!cancelled) setPermission(getNotificationPermission())
      const has = await hasActiveSubscription()
      if (!cancelled) setActive(has)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const handleToggle = async () => {
    setBusy(true)
    try {
      if (active) {
        const ok = await unsubscribeFromPush()
        if (ok) setActive(false)
      } else {
        const ok = await subscribeToPush()
        setPermission(getNotificationPermission())
        if (ok) setActive(true)
      }
    } finally {
      setBusy(false)
    }
  }

  if (!supported) {
    return (
      <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4 flex items-start gap-3">
        <AlertCircle className="h-4 w-4 text-[var(--text-tertiary)] shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--text-primary)]">
            Browser notifications aren&apos;t supported on this device
          </p>
          <p className="text-xs text-[var(--text-tertiary)] mt-1 leading-snug">
            On iOS, add Fokus Kreatives to your Home Screen first (Share &rarr;
            Add to Home Screen). Then come back here to enable.
          </p>
        </div>
      </div>
    )
  }

  if (permission === 'denied') {
    return (
      <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4 flex items-start gap-3">
        <BellOff className="h-4 w-4 text-[var(--text-tertiary)] shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--text-primary)]">
            Browser notifications are blocked
          </p>
          <p className="text-xs text-[var(--text-tertiary)] mt-1 leading-snug">
            You denied permission earlier. To turn them on, click the
            lock / site-settings icon in your browser&apos;s address bar and
            allow notifications for this site, then refresh.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-[#2B79F7]" />
            <p className="text-sm font-medium text-[var(--text-primary)]">
              Browser notifications
            </p>
          </div>
          <p className="text-xs text-[var(--text-tertiary)] mt-1 leading-snug">
            Get a desktop / mobile push when a new lead, submission, or
            meeting comes in - even when this tab is closed. Toggle
            this on per device.
          </p>
        </div>
        <button
          type="button"
          onClick={handleToggle}
          disabled={busy}
          className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            active ? 'bg-[#2B79F7]' : 'bg-[var(--border-secondary)]'
          } ${busy ? 'opacity-60 cursor-wait' : ''}`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
              active ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>
      {active && (
        <>
          <p className="text-[11px] text-emerald-500 mt-3">
            Active on this device. Add Fokus Kreatives to your Home Screen
            (iOS) or Install button (desktop) for the best experience.
          </p>
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={async () => {
                setTestResult(null)
                try {
                  const res = await fetch('/api/push/test', { method: 'POST' })
                  const data = await res.json()
                  if (!res.ok || !data?.success) {
                    setTestResult(`Failed: ${data?.error || res.statusText}`)
                    return
                  }
                  const n: number = data.subscriptionCount ?? 0
                  const list = (data.subscriptions || []) as Array<{
                    pushService: string
                    userAgent: string
                  }>
                  if (n === 0) {
                    setTestResult(
                      'No subscriptions registered for your account on any device yet. Tap "Re-link this device" below.',
                    )
                  } else {
                    // Map endpoints to friendly platform names so the
                    // output is readable instead of a wall of UA strings.
                    // Example: "fcm.googleapis.com" => "Android / Chrome".
                    const labelFor = (host: string, ua: string) => {
                      const lc = ua.toLowerCase()
                      if (host.includes('apple.com')) return 'Apple (iOS / macOS)'
                      if (host.includes('mozilla')) return 'Firefox'
                      if (host.includes('fcm.googleapis')) {
                        if (lc.includes('android')) return 'Android Chrome'
                        if (lc.includes('mac')) return 'Mac Chrome'
                        if (lc.includes('windows')) return 'Windows Chrome'
                        return 'Chromium browser'
                      }
                      return host
                    }
                    const grouped = new Map<string, number>()
                    for (const s of list) {
                      const k = labelFor(s.pushService, s.userAgent || '')
                      grouped.set(k, (grouped.get(k) || 0) + 1)
                    }
                    const summary = Array.from(grouped.entries())
                      .map(([k, c]) => (c > 1 ? `${c}× ${k}` : k))
                      .join(', ')
                    setTestResult(
                      `Sent to ${n} device${n === 1 ? '' : 's'}: ${summary}.${
                        n > 5
                          ? ' Quite a few stale subscriptions - tap "Forget other devices" to clean up.'
                          : ''
                      } If you don't see the toast in a few seconds, OS-level DND / battery saver / blocked permission is suppressing it.`,
                    )
                  }
                } catch (err) {
                  console.error('[push] test send error:', err)
                  setTestResult('Could not reach the server.')
                }
              }}
              className="text-xs px-3 py-1.5 rounded-md bg-[var(--bg-card)] border border-[var(--border-primary)] text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]"
            >
              Send test notification
            </button>
            <button
              type="button"
              onClick={async () => {
                // Re-subscribe in place: useful after the server-side
                // subscription row gets cleaned up (e.g. a transient
                // 410 from the push service deleted it but the
                // browser still has its local subscription cached).
                // Tap this to sync the DB row back without having to
                // flip the toggle off + on.
                setBusy(true)
                setTestResult(null)
                try {
                  await unsubscribeFromPush()
                  const ok = await subscribeToPush()
                  if (ok) {
                    setActive(true)
                    setTestResult('Re-linked. Now tap "Send test notification".')
                  } else {
                    setActive(false)
                    setTestResult('Re-link failed - permission may have been revoked.')
                  }
                } finally {
                  setBusy(false)
                }
              }}
              className="text-xs px-3 py-1.5 rounded-md bg-[var(--bg-card)] border border-[var(--border-primary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]"
            >
              Re-link this device
            </button>
            <button
              type="button"
              onClick={async () => {
                if (
                  !confirm(
                    'Remove every push subscription EXCEPT this device? Other devices will need to re-link to receive push.',
                  )
                )
                  return
                setBusy(true)
                setTestResult(null)
                try {
                  // Send the current device's endpoint so the server
                  // can preserve this row and nuke the rest.
                  let endpoint: string | null = null
                  if ('serviceWorker' in navigator) {
                    const reg = await navigator.serviceWorker.getRegistration('/sw.js')
                    const sub = await reg?.pushManager.getSubscription()
                    endpoint = sub?.endpoint ?? null
                  }
                  const res = await fetch('/api/push/forget-others', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ endpoint }),
                  })
                  const data = await res.json()
                  if (data?.success) {
                    setTestResult(`Removed ${data.removed ?? 0} other subscription(s).`)
                  } else {
                    setTestResult(`Cleanup failed: ${data?.error || res.statusText}`)
                  }
                } finally {
                  setBusy(false)
                }
              }}
              className="text-xs px-3 py-1.5 rounded-md bg-[var(--bg-card)] border border-[var(--border-primary)] text-[var(--text-tertiary)] hover:text-red-500 hover:bg-red-500/10"
            >
              Forget other devices
            </button>
          </div>
          {testResult && (
            <p className="text-[11px] text-[var(--text-tertiary)] mt-2 leading-snug break-words">
              {testResult}
            </p>
          )}
        </>
      )}
    </div>
  )
}
