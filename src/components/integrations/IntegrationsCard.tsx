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
import { humanizeIntegrationError } from '@/lib/integrations/errorMessages'
import { ConfirmModal } from '@/components/ui/ConfirmModal'

interface Integration {
  provider: 'calendly' | 'google_meet' | 'zoom' | 'gmail_smtp'
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
  key: 'calendly' | 'google_meet' | 'zoom' | 'gmail_smtp'
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
  {
    key: 'gmail_smtp',
    label: 'Email (Gmail)',
    blurb:
      'Send invoices and meeting emails from your own Gmail address - your name, your profile picture, replies to you. Uses a Google app password; stored encrypted.',
    available: true,
  },
]

export function IntegrationsCard({ clientId, canManage }: Props) {
  const [integrations, setIntegrations] = useState<Integration[]>([])
  const [loading, setLoading] = useState(true)
  const [calendlyModalOpen, setCalendlyModalOpen] = useState(false)
  const [gmailModalOpen, setGmailModalOpen] = useState(false)
  // Test-send state for the connected gmail_smtp row.
  const [testState, setTestState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')

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
  const providerPathSegment = (p: 'calendly' | 'google_meet' | 'zoom' | 'gmail_smtp') =>
    p === 'google_meet' ? 'google' : p === 'gmail_smtp' ? 'gmail-smtp' : p

  // Which provider the in-app "disconnect?" modal is confirming (null = closed).
  const [disconnectTarget, setDisconnectTarget] = useState<
    'calendly' | 'google_meet' | 'zoom' | 'gmail_smtp' | null
  >(null)

  // Runs after the user confirms in the modal. Throws on failure so the
  // modal surfaces the error; the modal shows a spinner + disables its
  // confirm button for the whole duration of this await.
  const performDisconnect = async () => {
    if (!disconnectTarget) return
    const res = await fetch(
      `/api/integrations/${providerPathSegment(disconnectTarget)}/disconnect`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId }),
      },
    )
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Disconnect failed')
    }
    setDisconnectTarget(null)
    await load()
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
          Integrations
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
                  {isConnected && p.key === 'gmail_smtp' && (
                    <button
                      type="button"
                      disabled={testState === 'sending'}
                      onClick={async () => {
                        setTestState('sending')
                        try {
                          const res = await fetch('/api/integrations/gmail-smtp/test', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ clientId }),
                          })
                          const data = await res.json().catch(() => ({}))
                          setTestState(data.success ? 'sent' : 'error')
                        } catch {
                          setTestState('error')
                        }
                        setTimeout(() => setTestState('idle'), 4000)
                      }}
                      className="mt-1 text-xs text-[#2B79F7] hover:underline disabled:opacity-50"
                    >
                      {testState === 'sending'
                        ? 'Sending test…'
                        : testState === 'sent'
                          ? 'Test sent - check the inbox ✓'
                          : testState === 'error'
                            ? 'Test failed - try reconnecting'
                            : 'Send test email'}
                    </button>
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
                    <p className="text-xs text-red-500 mt-1">
                      {humanizeIntegrationError(conn.last_error, p.key)}
                    </p>
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
                      onClick={() => setDisconnectTarget(p.key)}
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
                        } else if (p.key === 'gmail_smtp') {
                          // App-password flow - guided modal, no OAuth.
                          setGmailModalOpen(true)
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

      {gmailModalOpen && (
        <GmailSmtpConnectModal
          clientId={clientId}
          onClose={() => setGmailModalOpen(false)}
          onConnected={() => {
            setGmailModalOpen(false)
            void load()
          }}
        />
      )}

      <ConfirmModal
        open={disconnectTarget !== null}
        tone="danger"
        title={`Disconnect ${PROVIDERS.find((p) => p.key === disconnectTarget)?.label ?? ''}?`}
        message="This removes the connection for this client. Meetings already booked stay, but new ones can't be created through it until you reconnect."
        confirmLabel="Disconnect"
        cancelLabel="Cancel"
        onConfirm={performDisconnect}
        onClose={() => setDisconnectTarget(null)}
      />
    </Card>
  )
}

function GmailSmtpConnectModal({
  clientId,
  onClose,
  onConnected,
}: {
  clientId: string
  onClose: () => void
  onConnected: () => void
}) {
  const [address, setAddress] = useState('')
  const [appPassword, setAppPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!address.trim() || !appPassword.trim()) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/integrations/gmail-smtp/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, address: address.trim(), appPassword }),
      })
      const data = await res.json().catch(() => ({}))
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

  const step = (n: number, children: React.ReactNode) => (
    <li className="flex gap-2.5">
      <span className="shrink-0 inline-flex items-center justify-center h-5 w-5 rounded-full bg-[#2B79F7]/15 text-[#2B79F7] text-[11px] font-bold">
        {n}
      </span>
      <span className="flex-1 leading-relaxed">{children}</span>
    </li>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md max-h-[90vh] overflow-y-auto scrollbar-none rounded-2xl bg-[var(--bg-card)] border border-[var(--border-primary)] shadow-2xl"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-primary)]">
          <h3 className="text-base font-semibold text-[var(--text-primary)]">
            Connect your email
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
          <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
            Invoices and meeting emails will send from your own Gmail - your name, your
            profile picture, replies straight to you. Takes about 2 minutes:
          </p>

          <ol className="space-y-2.5 text-xs text-[var(--text-secondary)]">
            {step(
              1,
              <>
                Turn on 2-Step Verification for your Google account (skip if already on):{' '}
                <a
                  href="https://myaccount.google.com/signinoptions/two-step-verification"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[#2B79F7] hover:underline"
                >
                  open settings <ExternalLink className="h-3 w-3" />
                </a>
              </>,
            )}
            {step(
              2,
              <>
                Create an app password (name it anything, e.g. &ldquo;CRM&rdquo;):{' '}
                <a
                  href="https://myaccount.google.com/apppasswords"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[#2B79F7] hover:underline"
                >
                  myaccount.google.com/apppasswords <ExternalLink className="h-3 w-3" />
                </a>
              </>,
            )}
            {step(3, <>Paste your Gmail address and the 16-character password below.</>)}
          </ol>

          <Input
            label="Gmail address"
            type="email"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="you@gmail.com"
            disabled={busy}
            autoFocus
          />
          <Input
            label="App password"
            value={appPassword}
            onChange={(e) => setAppPassword(e.target.value)}
            placeholder="xxxx xxxx xxxx xxxx"
            disabled={busy}
          />

          <p className="text-[11px] text-[var(--text-tertiary)] leading-relaxed">
            We verify the password with a live Gmail login before saving, store it
            encrypted (AES-256), and only use it to send your CRM emails. Disconnecting
            deletes our copy; you can also revoke the app password in your Google account
            at any time.
          </p>

          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-[var(--border-primary)]">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !address.trim() || !appPassword.trim()} isLoading={busy}>
            Verify &amp; connect
          </Button>
        </div>
      </form>
    </div>
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
