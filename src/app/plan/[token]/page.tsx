'use client'

// View-only share page. Public, no auth - the token in the URL is the gate.
// Strips internal scoring math, "why this format" rationale, cooldown state,
// and any edit affordances. Renders the calendar in read-only mode.

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'

interface PublicSlot {
  id: string
  stream: 'long_form' | 'short_form' | 'engagement_reel' | 'carousel'
  scheduled_date: string
  status: 'planned' | 'drafted' | 'approved'
  hook_preview: string | null
  format_name: string | null
}

interface PublicData {
  client: { id: string; name: string }
  slots: PublicSlot[]
  horizon: { start: string; end: string }
  /** Distinct months that actually contain slots. Drives the calendar grid
   *  so we don't render empty months. */
  months: string[]
}

const STREAM_COLORS: Record<PublicSlot['stream'], { bg: string; text: string; label: string }> = {
  long_form:       { bg: 'bg-blue-600/15',  text: 'text-blue-700',  label: 'Long-form' },
  short_form:      { bg: 'bg-sky-500/15',   text: 'text-sky-700',   label: 'Short-form' },
  engagement_reel: { bg: 'bg-purple-500/15',text: 'text-purple-700',label: 'Engagement' },
  carousel:        { bg: 'bg-amber-500/15', text: 'text-amber-700', label: 'Carousel' },
}

function monthsInHorizon(start: string, end: string): string[] {
  // First-of-month dates for every month overlapping [start, end). Walks
  // forward until the month-start lands on or past end. Same-month ranges
  // (e.g. start=2026-05-05, end=2026-05-25) correctly return [2026-05-01].
  const out: string[] = []
  let y = parseInt(start.slice(0, 4), 10)
  let m = parseInt(start.slice(5, 7), 10)
  while (true) {
    const monthStart = `${y}-${String(m).padStart(2, '0')}-01`
    if (monthStart >= end) break
    out.push(monthStart)
    m += 1
    if (m > 12) { m = 1; y += 1 }
  }
  return out
}

interface DayCell {
  date: string
  inMonth: boolean
  monthLabel: string | null
}

function buildMonthGrid(start: string): DayCell[] {
  const [y, m] = start.split('-').map((s) => parseInt(s, 10))
  const first = new Date(Date.UTC(y, m - 1, 1))
  const startWeekday = first.getUTCDay()
  const gridStart = new Date(first)
  gridStart.setUTCDate(gridStart.getUTCDate() - startWeekday)
  const out: DayCell[] = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart)
    d.setUTCDate(gridStart.getUTCDate() + i)
    const ymd = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
    const inMonth = d.getUTCMonth() === m - 1
    out.push({
      date: ymd,
      inMonth,
      monthLabel: inMonth && d.getUTCDate() === 1 ? d.toLocaleString(undefined, { month: 'long', year: 'numeric' }) : null,
    })
  }
  return out
}

export default function PublicPlanPage() {
  const params = useParams()
  const token = params.token as string

  const [data, setData] = useState<PublicData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    ;(async () => {
      try {
        const res = await fetch(`/api/planner/public-data?token=${encodeURIComponent(token)}`, { cache: 'no-store' })
        const j = await res.json()
        if (!j.success) throw new Error(j.error || 'Could not load plan')
        setData(j as PublicData)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not load plan')
      } finally {
        setLoading(false)
      }
    })()
  }, [token])

  // Server returns the exact list of populated months. Fall back to deriving
  // from horizon for backwards compatibility, but for share links generated
  // after this change we always have an explicit months list and render only
  // months that have slots - no more "1 month generated, 3 months shown."
  const months = useMemo(() => {
    if (!data) return []
    if (Array.isArray(data.months) && data.months.length) return data.months
    return monthsInHorizon(data.horizon.start, data.horizon.end)
  }, [data])
  const slotsByDate = useMemo(() => {
    const map = new Map<string, PublicSlot[]>()
    if (!data) return map
    for (const s of data.slots) {
      const arr = map.get(s.scheduled_date) ?? []
      arr.push(s)
      map.set(s.scheduled_date, arr)
    }
    return map
  }, [data])

  if (loading) {
    return (
      <div className="form-canvas min-h-screen flex items-center justify-center text-[var(--text-tertiary)]">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading plan...
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="form-canvas min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-semibold text-[var(--text-primary)] mb-2">Plan unavailable</h1>
          <p className="text-sm text-[var(--text-secondary)]">{error || 'This link is no longer valid.'}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="form-canvas min-h-screen">
      <header className="glass-card rounded-none border-x-0 border-t-0 px-6 py-4">
        <div className="max-w-6xl mx-auto">
          <p className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">Content plan</p>
          <h1 className="text-xl font-semibold text-[var(--text-primary)] mt-0.5">{data.client.name}</h1>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 md:px-6 py-6 space-y-6">
        {data.slots.length === 0 && (
          <div className="glass-card rounded-xl p-8 text-center text-[var(--text-tertiary)]">
            No content scheduled yet.
          </div>
        )}

        {months.map((monthStart) => {
          const grid = buildMonthGrid(monthStart)
          const monthLabel = grid.find((c) => c.monthLabel)?.monthLabel
          return (
            <div key={monthStart} className="glass-card rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--glass-border)]">
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">{monthLabel}</h3>
              </div>
              <div className="grid grid-cols-7 text-[10px] uppercase tracking-wide text-[var(--text-tertiary)] bg-white/[0.03]">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                  <div key={d} className="px-2 py-1.5 text-center">{d}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 border-t border-[var(--glass-border)]">
                {grid.map((cell, idx) => {
                  const cellSlots = slotsByDate.get(cell.date) ?? []
                  return (
                    <div
                      key={`${cell.date}-${idx}`}
                      className={[
                        'min-h-[110px] border-b border-r border-[var(--glass-border)] p-1.5 flex flex-col gap-1',
                        cell.inMonth ? '' : 'opacity-40',
                      ].join(' ')}
                    >
                      <span className="text-[11px] tabular-nums text-[var(--text-tertiary)]">
                        {parseInt(cell.date.slice(8), 10)}
                      </span>
                      {cellSlots.map((s) => {
                        const palette = STREAM_COLORS[s.stream]
                        return (
                          <div key={s.id} className={`rounded-md px-2 py-1.5 text-[11px] leading-tight ${palette.bg} ${palette.text}`}>
                            <div className="font-semibold truncate">{s.format_name ?? palette.label}</div>
                            {s.hook_preview && (
                              <p className="truncate opacity-80 mt-0.5">{s.hook_preview}</p>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}

        <div className="flex flex-wrap gap-3 text-xs text-[var(--text-secondary)] py-2">
          {(['long_form','short_form','engagement_reel','carousel'] as PublicSlot['stream'][]).map((s) => (
            <span key={s} className="inline-flex items-center gap-1.5">
              <span className={`inline-block h-2 w-2 rounded-full ${STREAM_COLORS[s].bg.replace('/15','')}`} />
              {STREAM_COLORS[s].label}
            </span>
          ))}
        </div>
      </main>
    </div>
  )
}
