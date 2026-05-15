'use client'

// Lightweight visit tracking for the public capture page.
//
// What it does:
//   - Generates / reuses an anonymous visitor id in localStorage so we
//     can count unique visitors without auth.
//   - Calls /api/capture/track on mount to start a session.
//   - Exposes trackFieldFocus(fieldId) for the form body to call on
//     each focus event - throttled internally so we don't spam the
//     server on every keypress.
//   - On page hide / unload, sends a beacon with the visit duration
//     so we can compute time-on-page.
//
// Returns { sessionId, trackFieldFocus } so callers can plumb the
// session id into their submit payload (so the submit endpoint can
// flip submitted=true on the matching row).

import { useEffect, useRef, useState } from 'react'

const VISITOR_KEY = 'fk_visitor_id'

function getOrCreateVisitorId(): string {
  if (typeof window === 'undefined') return ''
  try {
    const existing = window.localStorage.getItem(VISITOR_KEY)
    if (existing) return existing
    const id = crypto.randomUUID()
    window.localStorage.setItem(VISITOR_KEY, id)
    return id
  } catch {
    // Private browsing / storage disabled - fall back to in-memory
    // id. Not persisted, so the same visitor reloading counts as new.
    return crypto.randomUUID()
  }
}

export function useSessionTracking(slug: string | null | undefined) {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const startedAtRef = useRef<number>(0)
  // Last fieldId we reported, to throttle server hits.
  const lastReportedFieldRef = useRef<string | null>(null)

  // Session start - fires once per slug change.
  useEffect(() => {
    if (!slug) return
    startedAtRef.current = Date.now()
    const visitorId = getOrCreateVisitorId()
    const referrer = typeof document !== 'undefined' ? document.referrer || null : null
    const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent || null : null

    let cancelled = false
    fetch('/api/capture/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'start',
        slug,
        visitorId,
        referrer,
        userAgent,
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return
        if (data?.success && data.sessionId) {
          setSessionId(data.sessionId)
        }
      })
      .catch(() => {
        // Non-fatal: analytics best-effort.
      })
    return () => {
      cancelled = true
    }
  }, [slug])

  // Unload handler - re-binds whenever sessionId changes so the
  // closure always sees the latest id (avoids the ref-mutation
  // pattern that React 19 lints against).
  useEffect(() => {
    if (!sessionId) return
    const handleUnload = () => {
      const durationSeconds = Math.round((Date.now() - startedAtRef.current) / 1000)
      try {
        fetch('/api/capture/track', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event: 'unload',
            sessionId,
            durationSeconds,
          }),
          keepalive: true,
        }).catch(() => {})
      } catch {
        // ignore
      }
    }
    window.addEventListener('pagehide', handleUnload)
    return () => window.removeEventListener('pagehide', handleUnload)
  }, [sessionId])

  const trackFieldFocus = (fieldId: string) => {
    if (!sessionId) return
    if (lastReportedFieldRef.current === fieldId) return
    lastReportedFieldRef.current = fieldId
    fetch('/api/capture/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'field', sessionId, fieldId }),
      keepalive: true,
    }).catch(() => {})
  }

  return { sessionId, trackFieldFocus }
}
