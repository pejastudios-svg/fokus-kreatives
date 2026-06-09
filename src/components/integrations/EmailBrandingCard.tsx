'use client'

// Email branding card on the CRM settings page (white-label option 1).
// Outward-facing emails for this client - invoices, meeting confirmations,
// reschedules - still send through the agency mail account, but display the
// name set here as the sender and route replies to the reply-to address.

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Mail, Loader2, CheckCircle2 } from 'lucide-react'

interface Props {
  clientId: string
  canManage: boolean
}

export function EmailBrandingCard({ clientId, canManage }: Props) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fromName, setFromName] = useState('')
  const [replyTo, setReplyTo] = useState('')
  const [defaultName, setDefaultName] = useState('')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(
          `/api/crm/email-branding?clientId=${encodeURIComponent(clientId)}`,
          { cache: 'no-store' },
        )
        const data = await res.json()
        if (cancelled) return
        if (data.success) {
          setFromName(data.fromName || '')
          setReplyTo(data.replyTo || '')
          setDefaultName(data.defaultName || '')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [clientId])

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const res = await fetch('/api/crm/email-branding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, fromName, replyTo }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.success) {
        setError(data.error || 'Could not save')
        return
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2">
        <Mail className="h-4 w-4 text-[#2B79F7]" />
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Email branding</h3>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-[var(--text-tertiary)] leading-snug">
          Emails to your leads and customers (invoices, meeting confirmations) show this
          name as the sender, and replies go to the reply-to address.
        </p>

        {loading ? (
          <div className="flex items-center gap-2 text-xs text-[var(--text-tertiary)]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading…
          </div>
        ) : (
          <>
            <Input
              label="Sender name"
              value={fromName}
              onChange={(e) => setFromName(e.target.value)}
              placeholder={defaultName || 'Your business name'}
              disabled={!canManage}
            />
            <Input
              label="Reply-to email"
              type="email"
              value={replyTo}
              onChange={(e) => setReplyTo(e.target.value)}
              placeholder="you@yourbusiness.com"
              disabled={!canManage}
            />
            {error && <p className="text-xs text-red-500">{error}</p>}
            <div className="flex items-center gap-3">
              <Button size="sm" onClick={handleSave} disabled={!canManage} isLoading={saving}>
                Save
              </Button>
              {saved && (
                <span className="inline-flex items-center gap-1 text-xs text-emerald-500">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Saved
                </span>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
