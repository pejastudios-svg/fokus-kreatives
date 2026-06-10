'use client'

// Email sending limits readout on the CRM settings page. Two rows:
//   - the client's connected Gmail (SMTP) - our own send count vs Gmail's
//     ~500/day cap, rolling 24h window
//   - the shared agency sender (Apps Script) - live remaining quota
// When a limit is hit, shows a friendly note with when sending resumes.

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Gauge, Loader2, AlertTriangle } from 'lucide-react'

interface QuotaData {
  smtp: {
    connected: boolean
    address?: string
    used?: number
    limit?: number
    remaining?: number
    resetsAt?: string | null
  }
  appsScript: { remaining: number; resetsAt: string | null } | null
}

function fmtReset(iso: string | null | undefined): string {
  if (!iso) return 'within 24 hours'
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function EmailQuotaCard({ clientId }: { clientId: string }) {
  const [data, setData] = useState<QuotaData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/crm/email-quota?clientId=${encodeURIComponent(clientId)}`, {
          cache: 'no-store',
        })
        const json = await res.json()
        if (!cancelled && json.success) setData(json as QuotaData)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [clientId])

  const smtp = data?.smtp
  const smtpExhausted = !!smtp?.connected && (smtp.remaining ?? 1) <= 0
  const scriptExhausted = data?.appsScript != null && data.appsScript.remaining <= 0
  const pct =
    smtp?.connected && smtp.limit
      ? Math.min(100, Math.round(((smtp.used ?? 0) / smtp.limit) * 100))
      : 0

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2">
        <Gauge className="h-4 w-4 text-[#2B79F7]" />
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">
          Email sending limits
        </h3>
      </CardHeader>
      <CardContent className="space-y-5">
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-[var(--text-tertiary)]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking limits…
          </div>
        ) : !data ? (
          <p className="text-xs text-[var(--text-tertiary)]">
            Could not load sending limits right now.
          </p>
        ) : (
          <>
            {/* Connected Gmail (SMTP) */}
            <div>
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-[var(--text-primary)]">
                  Your Gmail{smtp?.address ? ` (${smtp.address})` : ''}
                </span>
                {smtp?.connected ? (
                  <span className="text-xs text-[var(--text-secondary)] tabular-nums">
                    {smtp.remaining} of {smtp.limit} left today
                  </span>
                ) : (
                  <span className="text-xs text-[var(--text-tertiary)]">Not connected</span>
                )}
              </div>
              {smtp?.connected && (
                <>
                  <div className="mt-2 h-1.5 rounded-full bg-[var(--bg-tertiary)] overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        smtpExhausted ? 'bg-red-500' : pct > 80 ? 'bg-amber-500' : 'bg-[#2B79F7]'
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  {smtpExhausted && (
                    <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                      <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      Daily Gmail limit reached. Until it frees up ({fmtReset(smtp.resetsAt)}),
                      emails go out via the shared sender instead. Nothing is lost.
                    </p>
                  )}
                </>
              )}
            </div>

            {/* Shared sender (Apps Script) */}
            <div className="pt-4 border-t border-[var(--border-primary)]">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-[var(--text-primary)]">Shared sender</span>
                {data.appsScript ? (
                  <span className="text-xs text-[var(--text-secondary)] tabular-nums">
                    {data.appsScript.remaining} left today
                  </span>
                ) : (
                  <span className="text-xs text-[var(--text-tertiary)]">Quota unavailable</span>
                )}
              </div>
              {scriptExhausted && (
                <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  The shared sender hit its daily limit. Sending resumes around{' '}
                  {fmtReset(data.appsScript?.resetsAt)}.
                </p>
              )}
              <p className="mt-1.5 text-[11px] text-[var(--text-tertiary)] leading-snug">
                Used for notifications and as the fallback when your Gmail isn&rsquo;t
                connected or is over its limit.
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
