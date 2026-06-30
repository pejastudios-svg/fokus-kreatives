'use client'

// Single-date picker popover. Shares the look-and-feel of DateRangePicker
// (quick options column + calendar grid) but for a single date instead of
// a from/to range.
//
// Renders a trigger button (caller supplies the visible label) that opens
// the popover. Click any date or quick option to commit and close. When
// allowClear=true, an extra "Clear" button at the bottom of the quick
// options column removes the value (calls onChange(null)).

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'

interface DatePopoverProps {
  value: string | null // YYYY-MM-DD or null when unset
  onChange: (next: string | null) => void
  /** What the trigger button looks like. Caller controls the entire visible state. */
  children: ReactNode
  /** Earliest selectable date. Defaults to today. */
  minDate?: string
  /** When true, a "Clear" button appears in the quick options (passes null to onChange). */
  allowClear?: boolean
  /** Optional class on the trigger wrapper. */
  className?: string
  align?: 'left' | 'right'
  /** When true, the trigger button is non-interactive. Used to prevent
   *  rapid double-clicks from firing the same onChange handler twice
   *  while an in-flight pin/unpin is mid-flight. */
  disabled?: boolean
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
  const daysToSat = (6 - dow + 7) % 7 || 7
  const daysToMonNext = (1 - dow + 7) % 7 || 7

  const fmtTrail = (s: string) =>
    parseYmd(s).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    })
  const dayName = (s: string) =>
    parseYmd(s).toLocaleString(undefined, { weekday: 'short', timeZone: 'UTC' })

  return [
    { label: 'Today', trailing: dayName(today), resolve: () => today },
    { label: 'Tomorrow', trailing: dayName(addDaysYmd(today, 1)), resolve: () => addDaysYmd(today, 1) },
    { label: 'This weekend', trailing: dayName(addDaysYmd(today, daysToSat)), resolve: () => addDaysYmd(today, daysToSat) },
    { label: 'Next week', trailing: dayName(addDaysYmd(today, daysToMonNext)), resolve: () => addDaysYmd(today, daysToMonNext) },
    { label: '2 weeks', trailing: fmtTrail(addDaysYmd(today, 14)), resolve: () => addDaysYmd(today, 14) },
    { label: '4 weeks', trailing: fmtTrail(addDaysYmd(today, 28)), resolve: () => addDaysYmd(today, 28) },
    { label: 'End of month', trailing: fmtTrail(endOfMonthOf(today)), resolve: () => endOfMonthOf(today) },
  ]
}

export function DatePopover({
  value,
  onChange,
  children,
  minDate,
  allowClear = false,
  className,
  align = 'left',
  disabled = false,
}: DatePopoverProps) {
  const [open, setOpen] = useState(false)
  const [viewMonth, setViewMonth] = useState(() => parseYmd(value ?? todayYmd()))
  const containerRef = useRef<HTMLDivElement>(null)

  const min = minDate ?? todayYmd()
  const quickOptions = useMemo(() => buildQuickOptions(), [])

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  useEffect(() => {
    if (open && value) setViewMonth(parseYmd(value))
  }, [open, value])

  const commit = (next: string | null) => {
    onChange(next)
    setOpen(false)
  }

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

  const isDisabled = (date: string) => date < min

  return (
    <div ref={containerRef} className={`relative inline-block ${className ?? ''}`}>
      <button
        type="button"
        onClick={() => {
          if (disabled) return
          setOpen((o) => !o)
        }}
        disabled={disabled}
        className="inline-flex disabled:cursor-not-allowed"
      >
        {children}
      </button>

      {open && (
        <div
          className={`absolute z-50 mt-2 top-full ${align === 'right' ? 'right-0' : 'left-0'} w-[480px] max-w-[calc(100vw-2rem)] glass-pop rounded-xl overflow-hidden`}
          role="dialog"
        >
          <div className="grid grid-cols-[160px_1fr]">
            <div className="border-r border-[var(--glass-border)] py-1.5 flex flex-col">
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
                  className="w-full px-3 py-1.5 flex items-center justify-between text-sm hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <span className="text-[var(--text-primary)]">{opt.label}</span>
                  <span className="text-[11px] text-[var(--text-tertiary)] tabular-nums">{opt.trailing}</span>
                </button>
              ))}
              {allowClear && value && (
                <button
                  type="button"
                  onClick={() => commit(null)}
                  className="mt-auto w-full px-3 py-2 flex items-center gap-2 text-sm text-red-500 hover:bg-red-500/10 border-t border-[var(--border-primary)]"
                >
                  <X className="h-3.5 w-3.5" />
                  Clear date
                </button>
              )}
            </div>

            <div className="p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-semibold text-[var(--text-primary)]">{monthLabel}</div>
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={jumpToToday}
                    className="px-2 py-0.5 text-[11px] text-[var(--text-secondary)] hover:bg-white/5 rounded"
                  >
                    Today
                  </button>
                  <button
                    type="button"
                    onClick={() => stepMonth(-1)}
                    className="p-1 rounded hover:bg-white/5 text-[var(--text-secondary)]"
                    aria-label="Previous month"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => stepMonth(1)}
                    className="p-1 rounded hover:bg-white/5 text-[var(--text-secondary)]"
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
                  const isSelected = cell.date === value
                  const disabled = isDisabled(cell.date)
                  return (
                    <button
                      key={cell.date}
                      type="button"
                      disabled={disabled}
                      onClick={() => commit(cell.date)}
                      className={[
                        'h-8 w-8 mx-auto text-xs tabular-nums rounded transition-colors',
                        !cell.inMonth && 'opacity-40',
                        disabled && 'opacity-30 cursor-not-allowed',
                        !disabled && !isSelected && 'hover:bg-white/5',
                        isSelected && 'bg-[#2B79F7] text-white font-semibold',
                        !isSelected && isToday && 'ring-1 ring-[#2B79F7] text-[#2B79F7]',
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
