'use client'

// Integrations card on the CRM settings page. Lists each provider
// (Calendly, Google Meet, Zoom) with a connect/disconnect affordance.
// The actual connect flow varies per provider - Calendly is a PAT
// modal, Google + Zoom are OAuth redirects (added in later milestones).
//
// Once a provider is connected for a CRM, any capture page in that
// CRM can pick it as its meeting integration. Bookings the visitor
// makes flow back into the meetings table automatically.

import { useEffect, useState } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { CalendarClock, CheckCircle2, Loader2, X, AlertTriangle, ExternalLink } from 'lucide-react'

interface Integration {
  provider: 'calendly' | 'google_meet' | 'zoom'
  status: 'connected' | 'error' | 'disconnected'
  last_error: string | null
  /** True when the provider's webhook was successfully registered.
   *  False for free-tier Calendly accounts where webhook registration
   *  was rejected - the embed still works but bookings won't auto-log. */
  webhook_registered?: boolean
  display: {
    email: string | null
    name: string | null
    scheduling_url: string | null
  }
}

interface Props {
  clientId: string
  canManage: boolean
}

const PROVIDERS: Array<{
  key: 'calendly' | 'google_meet' | 'zoom'
  label: string
  blurb: string
  available: boolean
}> = [
  {
    key: 'calendly',
    label: 'Calendly',
    blurb:
      'Embed your Calendly booking page on capture forms. Bookings auto-log into the meetings table.',
    available: true,
  },
  {
    key: 'google_meet',
    label: 'Google Meet',
    blurb:
      'Visitors pick a date/time on your capture page; we create a Google Calendar event with a Meet link and email the invite.',
    available: true,
  },
  {
    key: 'zoom',
    label: 'Zoom',
    blurb:
      'Same as Google Meet but the auto-generated link is a Zoom meeting.',
    available: true,
  },
]

export function IntegrationsCard({ clientId, canManage }: Props) {
  const [integrations, setIntegrations] = useState<Integration[]>([])
  const [loading, setLoading] = useState(true)
  const [calendlyModalOpen, setCalendlyModalOpen] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/integrations/list?clientId=${encodeURIComponent(clientId)}`, {
        cache: 'no-store',
      })
      const data = await res.json()
      if (data.success) {
        setIntegrations(data.integrations || [])
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId])

  const connectionFor = (provider: string) =>
    integrations.find((i) => i.provider === provider) ?? null

  // Provider-specific disconnect endpoints. URL segment for
  // 'google_meet' is 'google' (we kept the existing folder name).
  const providerPathSegment = (p: 'calendly' | 'google_meet' | 'zoom') =>
    p === 'google_meet' ? 'google' : p

  const handleDisconnect = async (provider: 'calendly' | 'google_meet' | 'zoom') => {
    if (!confirm(`Disconnect ${provider}?`)) return
    const res = await fetch(
      `/api/integrations/${providerPathSegment(provider)}/disconnect`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId }),
      },
    )
    const data = await res.json()
    if (data.success) {
      await load()
    } else {
      alert(data.error || 'Disconnect failed')
    }
  }

  // Picking up the result of the Google OAuth round-trip. The
  // callback redirects back to settings with ?google=connected|error
  // - we read it, refresh the integrations list, then strip the
  // params so reloading doesn't re-trigger the notice.
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const [oauthNotice, setOauthNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  useEffect(() => {
    // Both Google and Zoom OAuth callbacks land on the settings page
    // with a ?<provider>=connected|error query. Pick whichever
    // matched, surface a toast, refresh the integrations list, then
    // strip the params so a page refresh doesn't re-show the toast.
    const google = searchParams?.get('google')
    const zoom = searchParams?.get('zoom')
    const provider: 'Google Meet' | 'Zoom' | null = google
      ? 'Google Meet'
      : zoom
      ? 'Zoom'
      : null
    const status = google || zoom
    if (!provider || !status) return

    if (status === 'connected') {
      setOauthNotice({ kind: 'ok', text: `${provider} connected.` })
      void load()
    } else if (status === 'error') {
      const err = searchParams?.get('error') || 'Connection failed'
      setOauthNotice({ kind: 'err', text: `${provider}: ${err}` })
    }
    const url = new URL(window.location.href)
    url.searchParams.delete('google')
    url.searchParams.delete('zoom')
    url.searchParams.delete('error')
    router.replace(`${pathname}${url.search ? url.search : ''}`)
    const t = setTimeout(() => setOauthNotice(null), 4000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2">
        <CalendarClock className="h-4 w-4 text-[#2B79F7]" />
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">
          Meeting integrations
        </h3>
      </CardHeader>
      <CardContent className="space-y-3">
        {oauthNotice && (
          <div
            className={`text-xs rounded-md px-3 py-2 ${
              oauthNotice.kind === 'ok'
                ? 'bg-emerald-500/10 text-emerald-500'
                : 'bg-red-500/10 text-red-500'
            }`}
          >
            {oauthNotice.text}
          </div>
        )}
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-[var(--text-tertiary)]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading…
          </div>
        ) : (
          PROVIDERS.map((p) => {
            const conn = connectionFor(p.key)
            const isConnected = conn?.status === 'connected'
            return (
              <div
                key={p.key}
                className="flex items-start justify-between gap-4 py-3 border-t border-[var(--border-primary)] first:border-t-0 first:pt-0"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-[var(--text-primary)]">
                      {p.label}
                    </span>
                    {isConnected && (
                      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-emerald-500">
                        <CheckCircle2 className="h-3 w-3" /> connected
                      </span>
                    )}
                    {!p.available && (
                      <span className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
                        coming soon
                      </span>
                    )}
                    {conn?.status === 'error' && (
                      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-red-500">
                        <AlertTriangle className="h-3 w-3" /> error
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[var(--text-tertiary)] mt-1 leading-snug">
                    {p.blurb}
                  </p>
                  {isConnected && conn?.display.email && (
                    <p className="text-xs text-[var(--text-secondary)] mt-1">
                      {conn.display.email}
                      {conn.display.scheduling_url && (
                        <>
                          {' · '}
                          <a
                            href={conn.display.scheduling_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-0.5 text-[#2B79F7] hover:underline"
                          >
                            view link
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </>
                      )}
                    </p>
                  )}
                  {/* Free-tier Calendly: server-pushed webhooks aren't
                      allowed, but the inline-embed widget posts a
                      booking event on the visitor's browser that we
                      verify + log server-side - so auto-logging still
                      works. Show a quiet note for transparency, not
                      a warning. */}
                  {isConnected && conn?.webhook_registered === false && (
                    <p className="text-xs text-[var(--text-tertiary)] mt-1 leading-snug">
                      Free-tier Calendly: bookings auto-log via the embed widget
                      (no server webhook). Upgrade to Standard if you want
                      server-pushed delivery as a backup.
                    </p>
                  )}
                  {conn?.last_error && conn?.webhook_registered !== false && (
                    <p className="text-xs text-red-500 mt-1">{conn.last_error}</p>
                  )}
                </div>
                <div className="shrink-0">
                  {!p.available ? (
                    <Button size="sm" variant="outline" disabled>
                      Soon
                    </Button>
                  ) : isConnected ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!canManage}
                      onClick={() => void handleDisconnect(p.key)}
                    >
                      Disconnect
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      disabled={!canManage}
                      onClick={() => {
                        if (p.key === 'calendly') {
                          setCalendlyModalOpen(true)
                        } else if (p.key === 'google_meet') {
                          // Google uses OAuth - leave the SPA, go
                          // through Google's consent page, then bounce
                          // back to /settings?google=connected.
                          window.location.href = `/api/integrations/google/connect?clientId=${encodeURIComponent(clientId)}`
                        } else if (p.key === 'zoom') {
                          // Zoom uses OAuth - same pattern.
                          window.location.href = `/api/integrations/zoom/connect?clientId=${encodeURIComponent(clientId)}`
                        }
                      }}
                    >
                      Connect
                    </Button>
                  )}
                </div>
              </div>
            )
          })
        )}
      </CardContent>

      {calendlyModalOpen && (
        <CalendlyConnectModal
          clientId={clientId}
          onClose={() => setCalendlyModalOpen(false)}
          onConnected={() => {
            setCalendlyModalOpen(false)
            void load()
          }}
        />
      )}
    </Card>
  )
}

function CalendlyConnectModal({
  clientId,
  onClose,
  onConnected,
}: {
  clientId: string
  onClose: () => void
  onConnected: () => void
}) {
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!token.trim()) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/integrations/calendly/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, token: token.trim() }),
      })
      const data = await res.json()
      if (!data.success) {
        setError(data.error || 'Connection failed')
        return
      }
      onConnected()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md max-h-[90vh] overflow-y-auto scrollbar-none rounded-2xl bg-[var(--bg-card)] border border-[var(--border-primary)] shadow-2xl"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-primary)]">
          <h3 className="text-base font-semibold text-[var(--text-primary)]">
            Connect Calendly
          </h3>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="p-1.5 rounded-md text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="text-xs text-[var(--text-secondary)] leading-relaxed space-y-2">
            <p>
              Paste your Calendly Personal Access Token. Get one at:
            </p>
            <a
              href="https://calendly.com/integrations/api_webhooks"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[#2B79F7] hover:underline"
            >
              calendly.com/integrations/api_webhooks
              <ExternalLink className="h-3 w-3" />
            </a>
            <p>
              We use it to verify your account and register a webhook so
              bookings auto-log into your meetings table. The token is
              stored encrypted and only used server-side.
            </p>
          </div>

          <Input
            label="Personal Access Token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="eyJraWQiOiIx..."
            disabled={busy}
            autoFocus
          />

          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-[var(--border-primary)]">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !token.trim()} isLoading={busy}>
            Connect
          </Button>
        </div>
      </form>
    </div>
  )
}
