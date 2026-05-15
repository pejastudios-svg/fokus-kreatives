'use client'

// Calendly-style availability slot picker. Server returns the actual
// list of bookable slots (as ISO timestamps) - already filtered for
// host working hours, day-of-week, conflicting meetings on our side,
// AND any busy windows from the host's Google Calendar when the
// Google Meet integration is connected. Client just displays them in
// the visitor's local timezone.
//
// Returns the picked slot's start time formatted as HH:MM in the
// visitor's LOCAL timezone, matching the same shape <input type="time">
// would emit - so the existing submit pipeline + meeting-creator
// don't change.

import { useEffect, useState } from 'react'
import { Skeleton } from '@/components/ui/Loading'

interface Slot {
  startIso: string
  endIso: string
}

interface AvailabilityResponse {
  success: boolean
  timezone?: string
  durationMinutes?: number
  slots?: Slot[]
  reason?: 'day_off'
  error?: string
}

interface Props {
  /** Capture page slug - server resolves to the host's availability. */
  slug: string
  /** Visitor-picked date as YYYY-MM-DD (DatePicker emit format). */
  date: string
  /** Currently selected slot's local HH:MM. */
  value: string
  onChange: (time: string) => void
}

function pad(n: number): string {
  return n.toString().padStart(2, '0')
}

function formatLocalLabel(iso: string): string {
  const d = new Date(iso)
  const h = d.getHours()
  const m = d.getMinutes()
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${pad(m)} ${period}`
}

function localHHMM(iso: string): string {
  const d = new Date(iso)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function AvailabilitySlotPicker({ slug, date, value, onChange }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<AvailabilityResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!date) {
      setData(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(
      `/api/capture/availability?slug=${encodeURIComponent(slug)}&date=${encodeURIComponent(date)}`,
      { cache: 'no-store' },
    )
      .then((r) => r.json())
      .then((d: AvailabilityResponse) => {
        if (cancelled) return
        if (!d.success) {
          setError(d.error || 'Could not load availability')
          setData(null)
        } else {
          setData(d)
        }
      })
      .catch((err) => {
        if (cancelled) return
        console.error('[availability] fetch error:', err)
        setError(err instanceof Error ? err.message : 'Could not load availability')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [slug, date])

  if (!date) {
    return (
      <p className="text-xs text-[var(--text-tertiary)] py-3">
        Pick a date first to see available times.
      </p>
    )
  }

  if (loading) {
    return (
      <div className="grid grid-cols-3 gap-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-9 rounded-lg bg-theme-tertiary" />
        ))}
      </div>
    )
  }

  if (error) {
    return <p className="text-xs text-red-500 py-3">{error}</p>
  }

  if (data?.reason === 'day_off') {
    return (
      <p className="text-xs text-[var(--text-tertiary)] py-3">
        The host isn&apos;t available on this day. Try another date.
      </p>
    )
  }

  const slots = data?.slots ?? []
  if (slots.length === 0) {
    return (
      <p className="text-xs text-[var(--text-tertiary)] py-3">
        No open slots on this day. Try another date.
      </p>
    )
  }

  // Visitor's local-tz label for the help text.
  const visitorTz = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone
    } catch {
      return null
    }
  })()

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-64 overflow-y-auto scrollbar-none">
        {slots.map((s) => {
          const localTime = localHHMM(s.startIso)
          const selected = value === localTime
          return (
            <button
              key={s.startIso}
              type="button"
              onClick={() => onChange(localTime)}
              className={`px-2 py-2 text-sm rounded-lg border transition-colors text-center ${
                selected
                  ? 'bg-[#2B79F7] text-white border-[#2B79F7] font-semibold'
                  : 'border-theme-primary text-theme-primary hover:bg-theme-tertiary'
              }`}
            >
              {formatLocalLabel(s.startIso)}
            </button>
          )
        })}
      </div>
      {visitorTz && (
        <p className="text-[11px] text-[var(--text-tertiary)]">
          Times shown in your timezone ({visitorTz}).
        </p>
      )}
    </div>
  )
}
