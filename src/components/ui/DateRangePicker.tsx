'use client'

// Two-field range picker with a single shared popover. Modeled on the
// ClickUp/Notion pattern: click either field, see a popover with quick
// options on the left and a calendar grid on the right. Pick a from-date,
// focus jumps to the to-field. Pick a to-date, popover closes.
//
// Defaults: from = today, to = end of current month.
// Constraint: from cannot be earlier than minDate (today by default), and
// to cannot be earlier than from.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Calendar as CalendarIcon, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'

interface DateRangePickerProps {
  from: string // YYYY-MM-DD
  to: string   // YYYY-MM-DD
  onChange: (from: string, to: string) => void
  /** Earliest selectable from-date. Defaults to today (no past). */
  minDate?: string
  className?: string
}

function ymd(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map((x) => parseInt(x, 10))
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1))
}
function todayYmd(): string {
  return ymd(new Date())
}
function addDaysYmd(s: string, days: number): string {
  const d = parseYmd(s)
  d.setUTCDate(d.getUTCDate() + days)
  return ymd(d)
}
function endOfMonthOf(s: string): string {
  const d = parseYmd(s)
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))
  return ymd(last)
}

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

interface QuickOption {
  label: string
  trailing: string
  resolve: () => string
}

function buildQuickOptions(): QuickOption[] {
  const today = todayYmd()
  const dow = parseYmd(today).getUTCDay()
  // Days until Saturday for "this weekend"
  const daysToSat = (6 - dow + 7) % 7 || 7
  const daysToMonNext = (1 - dow + 7) % 7 || 7
  const nextWeekend = addDaysYmd(today, daysToSat + 7) // Saturday after next Mon

  const fmtTrail = (s: string) => {
    const d = parseYmd(s)
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    })
  }
  const dayName = (s: string) =>
    parseYmd(s).toLocaleString(undefined, { weekday: 'short', timeZone: 'UTC' })

  return [
    { label: 'Today', trailing: dayName(today), resolve: () => today },
    { label: 'Tomorrow', trailing: dayName(addDaysYmd(today, 1)), resolve: () => addDaysYmd(today, 1) },
    { label: 'This weekend', trailing: dayName(addDaysYmd(today, daysToSat)), resolve: () => addDaysYmd(today, daysToSat) },
    { label: 'Next week', trailing: dayName(addDaysYmd(today, daysToMonNext)), resolve: () => addDaysYmd(today, daysToMonNext) },
    { label: 'Next weekend', trailing: fmtTrail(nextWeekend), resolve: () => nextWeekend },
    { label: '2 weeks', trailing: fmtTrail(addDaysYmd(today, 14)), resolve: () => addDaysYmd(today, 14) },
    { label: '4 weeks', trailing: fmtTrail(addDaysYmd(today, 28)), resolve: () => addDaysYmd(today, 28) },
    { label: 'End of month', trailing: fmtTrail(endOfMonthOf(today)), resolve: () => endOfMonthOf(today) },
  ]
}

export function DateRangePicker({ from, to, onChange, minDate, className }: DateRangePickerProps) {
  const [open, setOpen] = useState(false)
  const [focused, setFocused] = useState<'from' | 'to'>('from')
  const [viewMonth, setViewMonth] = useState(() => parseYmd(from))
  const [hoverDate, setHoverDate] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // minDate optional - when omitted, past dates are selectable for from. The
  // planner page deliberately allows past from-dates so a user generating a
  // plan late in the month can still anchor it to the 1st; the generate flow
  // auto-extends the to-date forward to compensate for the lost days.
  const min = minDate ?? null
  const quickOptions = useMemo(() => buildQuickOptions(), [])

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setHoverDate(null)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  useEffect(() => {
    if (open) {
      // Re-anchor view month to the focused field's current value when opening
      const anchor = focused === 'from' ? from : to
      if (anchor) setViewMonth(parseYmd(anchor))
    }
  }, [open, focused, from, to])

  const openWithFocus = (which: 'from' | 'to') => {
    setFocused(which)
    setOpen(true)
  }

  const commit = (value: string) => {
    if (focused === 'from') {
      // If the new from is after current to, slide to forward to match
      const newTo = value > to ? value : to
      onChange(value, newTo)
      setFocused('to')
      // Advance the view month to the new from's month so the to-pick lands here
      setViewMonth(parseYmd(value))
    } else {
      // Pick to. Force to >= from. If user picked something earlier, swap.
      let newFrom = from
      let newTo = value
      if (value < from) {
        newFrom = value
        newTo = from
      }
      onChange(newFrom, newTo)
      setOpen(false)
      setHoverDate(null)
    }
  }

  // Calendar grid for the month being viewed.
  const grid = useMemo(() => {
    const y = viewMonth.getUTCFullYear()
    const m = viewMonth.getUTCMonth()
    const firstDow = new Date(Date.UTC(y, m, 1)).getUTCDay()
    const start = new Date(Date.UTC(y, m, 1))
    start.setUTCDate(start.getUTCDate() - firstDow)
    const cells: Array<{ date: string; inMonth: boolean }> = []
    for (let i = 0; i < 42; i++) {
      const d = new Date(start)
      d.setUTCDate(start.getUTCDate() + i)
      cells.push({ date: ymd(d), inMonth: d.getUTCMonth() === m })
    }
    return cells
  }, [viewMonth])

  const monthLabel = `${MONTHS_LONG[viewMonth.getUTCMonth()]} ${viewMonth.getUTCFullYear()}`

  const stepMonth = (delta: number) => {
    setViewMonth((d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + delta, 1)))
  }
  const jumpToToday = () => setViewMonth(parseYmd(todayYmd()))

  // Hover-preview range: only when focused on "to" and hovering a date >= from
  const previewRange = focused === 'to' && hoverDate && hoverDate >= from
    ? { start: from, end: hoverDate }
    : null

  const isInSelectedRange = (date: string) => date >= from && date <= to
  const isInPreviewRange = (date: string) =>
    !!previewRange && date > previewRange.start && date < previewRange.end
  const isDisabled = (date: string) => {
    if (focused === 'from') return min ? date < min : false
    return date < from
  }

  return (
    <div ref={containerRef} className={`relative inline-flex items-center ${className ?? ''}`}>
      {/* From + To trigger pills, joined visually */}
      <button
        type="button"
        onClick={() => openWithFocus('from')}
        className={[
          'inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-l-lg border border-r-0',
          'bg-[var(--bg-card)] text-[var(--text-primary)]',
          open && focused === 'from'
            ? 'border-[#2B79F7] ring-2 ring-[#2B79F7]/20'
            : 'border-[var(--border-primary)]',
        ].join(' ')}
        aria-label="From date"
      >
        <CalendarIcon className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
        <span className="text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]">From</span>
        <span className="tabular-nums">{from || 'Pick'}</span>
        <ChevronDown className="h-3 w-3 text-[var(--text-tertiary)]" />
      </button>
      <button
        type="button"
        onClick={() => openWithFocus('to')}
        className={[
          'inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-r-lg border',
          'bg-[var(--bg-card)] text-[var(--text-primary)]',
          open && focused === 'to'
            ? 'border-[#2B79F7] ring-2 ring-[#2B79F7]/20'
            : 'border-[var(--border-primary)]',
        ].join(' ')}
        aria-label="To date"
      >
        <span className="text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]">To</span>
        <span className="tabular-nums">{to || 'Pick'}</span>
        <ChevronDown className="h-3 w-3 text-[var(--text-tertiary)]" />
      </button>

      {open && (
        <div
          className="absolute z-50 mt-2 top-full left-0 w-[560px] max-w-[calc(100vw-2rem)] rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] shadow-premium-lg overflow-hidden"
          role="dialog"
        >
          <div className="grid grid-cols-[180px_1fr]">
            {/* Quick options column */}
            <div className="border-r border-[var(--border-primary)] py-1.5">
              {quickOptions.map((opt) => (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => {
                    const v = opt.resolve()
                    if (isDisabled(v)) return
                    commit(v)
                  }}
                  disabled={isDisabled(opt.resolve())}
                  className="w-full px-3 py-1.5 flex items-center justify-between text-sm hover:bg-[var(--bg-tertiary)] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <span className="text-[var(--text-primary)]">{opt.label}</span>
                  <span className="text-[11px] text-[var(--text-tertiary)] tabular-nums">{opt.trailing}</span>
                </button>
              ))}
            </div>

            {/* Calendar column */}
            <div className="p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-semibold text-[var(--text-primary)]">{monthLabel}</div>
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={jumpToToday}
                    className="px-2 py-0.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] rounded"
                  >
                    Today
                  </button>
                  <button
                    type="button"
                    onClick={() => stepMonth(-1)}
                    className="p-1 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)]"
                    aria-label="Previous month"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => stepMonth(1)}
                    className="p-1 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)]"
                    aria-label="Next month"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-7 gap-y-1 text-[10px] uppercase tracking-wide text-[var(--text-tertiary)] mb-1">
                {WEEKDAYS.map((d) => (
                  <div key={d} className="text-center py-0.5">{d}</div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-y-1">
                {grid.map((cell) => {
                  const isToday = cell.date === todayYmd()
                  const isFrom = cell.date === from
                  const isTo = cell.date === to
                  const inSelected = isInSelectedRange(cell.date)
                  const inPreview = isInPreviewRange(cell.date)
                  const disabled = isDisabled(cell.date)
                  const endpoint = isFrom || isTo
                  return (
                    <button
                      key={cell.date}
                      type="button"
                      disabled={disabled}
                      onMouseEnter={() => setHoverDate(cell.date)}
                      onMouseLeave={() => setHoverDate(null)}
                      onClick={() => commit(cell.date)}
                      className={[
                        'relative h-8 w-8 mx-auto text-xs tabular-nums rounded',
                        'transition-colors',
                        !cell.inMonth && 'opacity-40',
                        disabled && 'opacity-30 cursor-not-allowed',
                        !disabled && !endpoint && !inSelected && !inPreview && 'hover:bg-[var(--bg-tertiary)]',
                        endpoint && 'bg-[#2B79F7] text-white font-semibold',
                        !endpoint && inSelected && 'bg-[#2B79F7]/15 text-[var(--text-primary)]',
                        !endpoint && inPreview && 'bg-[#2B79F7]/10 text-[var(--text-primary)]',
                        !endpoint && !inSelected && !inPreview && isToday && 'ring-1 ring-[#2B79F7] text-[#2B79F7]',
                      ].filter(Boolean).join(' ')}
                    >
                      {parseInt(cell.date.slice(8), 10)}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
