'use client'

// Availability settings card on the CRM settings page. Per-CRM
// scheduling preferences used by the capture-page slot picker:
// timezone + per-day enabled toggle + per-day working hours.
//
// Saves to /api/crm/availability-settings.

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Toggle } from '@/components/ui/Toggle'
import { TimezonePicker } from '@/components/ui/TimezonePicker'
import { CalendarClock, Loader2, CheckCircle2 } from 'lucide-react'

type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'

interface DayConfig {
  enabled: boolean
  startHour: number
  endHour: number
}

interface Settings {
  timezone: string
  days: Record<DayKey, DayConfig>
}

const DAY_ORDER: Array<{ key: DayKey; label: string }> = [
  { key: 'mon', label: 'Monday' },
  { key: 'tue', label: 'Tuesday' },
  { key: 'wed', label: 'Wednesday' },
  { key: 'thu', label: 'Thursday' },
  { key: 'fri', label: 'Friday' },
  { key: 'sat', label: 'Saturday' },
  { key: 'sun', label: 'Sunday' },
]

function hourLabel(h: number): string {
  if (h === 0) return '12 AM'
  if (h < 12) return `${h} AM`
  if (h === 12) return '12 PM'
  if (h === 24) return '12 AM (next day)'
  return `${h - 12} PM`
}

interface Props {
  clientId: string
  canManage: boolean
}

export function AvailabilityCard({ clientId, canManage }: Props) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/crm/availability-settings?clientId=${encodeURIComponent(clientId)}`, {
      cache: 'no-store',
    })
      .then((r) => r.json())
      .then((data) => {
        if (data?.success) {
          // First-time setup: if the stored timezone is still the
          // default "UTC", auto-pick the host's browser timezone so
          // the slot picker shows the right working-hours window
          // without making them click around in Settings first.
          let next: Settings = data.settings
          if (next.timezone === 'UTC') {
            try {
              const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone
              if (browserTz && browserTz !== 'UTC') {
                next = { ...next, timezone: browserTz }
              }
            } catch {
              // ignore - keep UTC
            }
          }
          setSettings(next)
        }
      })
      .finally(() => setLoading(false))
  }, [clientId])

  const save = async () => {
    if (!settings) return
    setSaving(true)
    try {
      const res = await fetch(
        `/api/crm/availability-settings?clientId=${encodeURIComponent(clientId)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ settings }),
        },
      )
      const data = await res.json()
      if (data.success) {
        setSettings(data.settings)
        setSavedAt(Date.now())
        setTimeout(() => setSavedAt(null), 2500)
      } else {
        alert(data.error || 'Save failed')
      }
    } finally {
      setSaving(false)
    }
  }

  const updateDay = (key: DayKey, patch: Partial<DayConfig>) => {
    if (!settings) return
    setSettings({
      ...settings,
      days: { ...settings.days, [key]: { ...settings.days[key], ...patch } },
    })
  }

  if (loading || !settings) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center gap-2">
          <CalendarClock className="h-4 w-4 text-[#2B79F7]" />
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Availability</h3>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-xs text-[var(--text-tertiary)]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2">
        <CalendarClock className="h-4 w-4 text-[#2B79F7]" />
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Availability</h3>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-[var(--text-tertiary)] leading-snug">
          Used by capture pages with Google Meet or Zoom integrations.
          Visitors only see slots inside your working hours - any that
          overlap an existing meeting are hidden automatically.
        </p>

        {/* Timezone */}
        <div>
          <label className="block text-xs font-medium text-[var(--text-tertiary)] mb-1">
            Your timezone
          </label>
          <TimezonePicker
            value={settings.timezone}
            onChange={(tz) => setSettings({ ...settings, timezone: tz })}
            disabled={!canManage}
          />
        </div>

        {/* Per-day working hours. Toggle gets its own slot separate
            from the day label so the label can't get clipped by the
            hour selects on narrow viewports. */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-[var(--text-tertiary)]">
            Working hours
          </p>
          {DAY_ORDER.map(({ key, label }) => {
            const cfg = settings.days[key]
            return (
              <div
                key={key}
                className="grid grid-cols-[auto_5.5rem_1fr_auto_1fr] items-center gap-2 sm:gap-3 py-2 border-b border-[var(--border-primary)] last:border-b-0"
              >
                <Toggle
                  checked={cfg.enabled}
                  onChange={(v) => updateDay(key, { enabled: v })}
                />
                <span
                  className={`text-xs sm:text-sm font-medium truncate ${
                    cfg.enabled ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]'
                  }`}
                >
                  {label}
                </span>
                <select
                  value={cfg.startHour}
                  onChange={(e) =>
                    updateDay(key, { startHour: parseInt(e.target.value, 10) })
                  }
                  disabled={!cfg.enabled || !canManage}
                  className="min-w-0 px-2 py-1.5 text-xs rounded-md border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-primary)] disabled:opacity-50 truncate"
                >
                  {Array.from({ length: 24 }, (_, i) => i).map((h) => (
                    <option key={h} value={h}>
                      {hourLabel(h)}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-[var(--text-tertiary)] text-center">to</span>
                <select
                  value={cfg.endHour}
                  onChange={(e) =>
                    updateDay(key, { endHour: parseInt(e.target.value, 10) })
                  }
                  disabled={!cfg.enabled || !canManage}
                  className="min-w-0 px-2 py-1.5 text-xs rounded-md border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-primary)] disabled:opacity-50 truncate"
                >
                  {Array.from({ length: 24 }, (_, i) => i + 1).map((h) => (
                    <option key={h} value={h}>
                      {hourLabel(h)}
                    </option>
                  ))}
                </select>
              </div>
            )
          })}
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          {savedAt && (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-500">
              <CheckCircle2 className="h-3.5 w-3.5" /> Saved
            </span>
          )}
          <Button size="sm" onClick={save} isLoading={saving} disabled={!canManage}>
            Save availability
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
