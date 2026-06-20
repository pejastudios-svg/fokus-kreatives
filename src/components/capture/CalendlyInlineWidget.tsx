'use client'

// Calendly inline-embed widget for the public capture page.
//
// Why this instead of a bare <iframe>:
//   - Calendly's embed iframe expects query params (parent origin,
//     embed_version, embed_type) that we'd otherwise have to construct
//     by hand. The widget script builds the URL correctly.
//   - It handshakes via postMessage so Calendly stops showing the
//     "Oops, something went wrong" fallback that fires on raw embeds.
//   - It emits a `calendly.event_scheduled` postMessage when the
//     visitor books. We forward that to /embed-callback so the
//     booking auto-logs into the meetings table - INCLUDING on free
//     tier where webhooks aren't allowed.

import { useEffect, useRef } from 'react'

interface Props {
  url: string
  /** Capture page slug - posted with each event_scheduled callback so
   *  the server can resolve which CRM/integration the booking belongs
   *  to without trusting the client to send a clientId. */
  slug: string
  /** Optional name/email prefill so visitors don't retype what they
   *  already entered in the form above the embed. */
  prefill?: { name?: string; email?: string }
  /** Fired when the visitor completes a booking. The capture form uses
   *  this to unlock its Submit button so a lead can't submit without
   *  actually scheduling the call. */
  onBooked?: () => void
}

export function CalendlyInlineWidget({ url, slug, prefill, onBooked }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  // Keep the latest onBooked in a ref so the message listener (subscribed
  // once per slug) always calls the current callback without re-subscribing.
  const onBookedRef = useRef(onBooked)
  useEffect(() => {
    onBookedRef.current = onBooked
  }, [onBooked])

  // Build the data-url with optional prefill query params. Calendly
  // supports name + email out of the box; other prefills (custom
  // questions) would need question-id mapping we don't have yet.
  const dataUrl = (() => {
    if (!prefill?.name && !prefill?.email) return url
    const u = new URL(url)
    if (prefill.name) u.searchParams.set('name', prefill.name)
    if (prefill.email) u.searchParams.set('email', prefill.email)
    return u.toString()
  })()

  useEffect(() => {
    // Idempotent script injection - if multiple capture pages mount
    // the widget in the same SPA session, only one script tag exists.
    if (!document.getElementById('calendly-widget-script')) {
      const s = document.createElement('script')
      s.id = 'calendly-widget-script'
      s.src = 'https://assets.calendly.com/assets/external/widget.js'
      s.async = true
      document.body.appendChild(s)
    }

    // Listen for the booking event. Calendly posts a message with
    // `event: 'calendly.event_scheduled'` and a payload containing
    // the canonical event + invitee URIs. We forward those URIs to
    // our server, which verifies them against Calendly's API using
    // the stored PAT before inserting into meetings.
    const onMessage = (e: MessageEvent) => {
      const data = e.data as
        | {
            event?: string
            payload?: {
              event?: { uri?: string }
              invitee?: { uri?: string }
            }
          }
        | null
      if (!data || typeof data !== 'object') return
      if (data.event !== 'calendly.event_scheduled') return
      const eventUri = data.payload?.event?.uri
      const inviteeUri = data.payload?.invitee?.uri
      if (!eventUri || !inviteeUri) return

      // Unlock the form's Submit button now that a real booking happened.
      onBookedRef.current?.()

      // Fire-and-forget. The server is idempotent on (provider,
      // external_id), so a retry on the visitor's next navigation
      // wouldn't double-insert anyway.
      fetch('/api/integrations/calendly/embed-callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, eventUri, inviteeUri }),
        keepalive: true,
      }).catch((err) => {
        console.error('[calendly-embed] auto-log failed:', err)
      })
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [slug])

  return (
    <div
      ref={ref}
      className="calendly-inline-widget rounded-lg overflow-hidden border border-[var(--border-primary)]"
      data-url={dataUrl}
      style={{ minWidth: 320, height: 700 }}
    />
  )
}
