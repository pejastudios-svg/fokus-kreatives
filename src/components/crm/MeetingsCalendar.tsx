'use client'

import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react'

// Minimal shape the calendar needs. The page's Meeting type is a
// superset, so it satisfies this without an adapter.
export interface CalendarMeeting {
  id: string
  title: string
  date_time: string
  status: 'scheduled' | 'completed' | 'cancelled'
}

interface Props<T extends CalendarMeeting> {
  meetings: T[]
  onSelectMeeting: (m: T) => void
  /** Called with a day when the user clicks the "+" on a date cell, so
   *  the parent can open the Add Meeting modal pre-filled with that date. */
  onAddOnDate?: (date: Date) => void
  /** When set, the calendar jumps to that meeting's month and rings its
   *  pill - used by the list's "View in calendar" action. */
  focusMeetingId?: string | null
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Local Y-M-D key so meetings land on the day the user sees them in
// their own timezone (not UTC). Used for both grouping and "today".
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function pillClasses(status: CalendarMeeting['status']): string {
  if (status === 'completed') return 'bg-green-500/15 text-green-600 dark:text-green-400'
  if (status === 'cancelled') return 'bg-red-500/15 text-red-500 line-through'
  return 'bg-[#2B79F7]/15 text-[#2B79F7]'
}

export function MeetingsCalendar<T extends CalendarMeeting>({
  meetings,
  onSelectMeeting,
  onAddOnDate,
  focusMeetingId,
}: Props<T>) {
  // Anchor on the first day of the viewed month. The calendar is mounted
  // fresh when you switch into Calendar view, so when a focus meeting is
  // already set (the list's "View in calendar"), open straight on ITS
  // month - otherwise default to the current month.
  const monthOf = (m: T | undefined) => {
    if (!m) return null
    const d = new Date(m.date_time)
    return new Date(d.getFullYear(), d.getMonth(), 1)
  }
  const [cursor, setCursor] = useState(() => {
    const focused = focusMeetingId ? meetings.find((m) => m.id === focusMeetingId) : undefined
    return (
      monthOf(focused) ?? (() => {
        const now = new Date()
        return new Date(now.getFullYear(), now.getMonth(), 1)
      })()
    )
  })

  // If the focused meeting CHANGES while already mounted (e.g. clicking a
  // different row's "View in calendar"), jump to its month. Adjusting
  // state during render off a changed prop is the React-recommended
  // pattern here (avoids a cascading-render effect).
  const [prevFocus, setPrevFocus] = useState<string | null | undefined>(focusMeetingId)
  if (focusMeetingId && focusMeetingId !== prevFocus) {
    setPrevFocus(focusMeetingId)
    const target = monthOf(meetings.find((m) => m.id === focusMeetingId))
    if (target) setCursor(target)
  }

  // "All meetings on this day" popup, opened by clicking a day's empty space
  // or its "+N more". Selecting one inside it opens the usual detail modal.
  const [dayModal, setDayModal] = useState<{ date: Date; items: T[] } | null>(null)

  const now = new Date()
  const todayKey = dayKey(now)
  // Start-of-today, for greying out "add meeting" on past days.
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()

  // Group meetings by local day for O(1) cell lookups, each day sorted
  // chronologically so earlier meetings render first.
  const byDay = useMemo(() => {
    const map = new Map<string, T[]>()
    for (const m of meetings) {
      const key = dayKey(new Date(m.date_time))
      const arr = map.get(key)
      if (arr) arr.push(m)
      else map.set(key, [m])
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => new Date(a.date_time).getTime() - new Date(b.date_time).getTime())
    }
    return map
  }, [meetings])

  const year = cursor.getFullYear()
  const month = cursor.getMonth()
  const firstWeekday = new Date(year, month, 1).getDay() // 0 = Sunday
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  // Leading blanks align day 1 under its weekday; trailing blanks square
  // off the final row so the grid stays rectangular.
  const cells: Array<{ day: number; date: Date } | null> = []
  for (let i = 0; i < firstWeekday; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, date: new Date(year, month, d) })
  while (cells.length % 7 !== 0) cells.push(null)

  const monthLabel = cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

  const goPrev = () => setCursor(new Date(year, month - 1, 1))
  const goNext = () => setCursor(new Date(year, month + 1, 1))
  const goToday = () => {
    const now = new Date()
    setCursor(new Date(now.getFullYear(), now.getMonth(), 1))
  }

  return (
    <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border-primary)] overflow-hidden">
      {/* Month navigation */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-primary)]">
        <div className="flex items-center gap-1.5">
          <button
            onClick={goPrev}
            title="Previous month"
            className="p-1.5 rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <h3 className="text-sm font-semibold text-[var(--text-primary)] min-w-[140px] text-center">
            {monthLabel}
          </h3>
          <button
            onClick={goNext}
            title="Next month"
            className="p-1.5 rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] transition-colors"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <button
          onClick={goToday}
          className="px-2.5 py-1 text-xs rounded-full bg-[var(--bg-secondary)] border border-[var(--border-primary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] transition-colors"
        >
          Today
        </button>
      </div>

      {/* Weekday header */}
      <div className="grid grid-cols-7 border-b border-[var(--border-primary)]">
        {WEEKDAYS.map((w) => (
          <div
            key={w}
            className="px-2 py-2 text-center text-[10px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]"
          >
            {w}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7">
        {cells.map((cell, i) => {
          if (!cell) {
            return (
              <div
                key={`blank-${i}`}
                className="min-h-[88px] border-b border-r border-[var(--border-primary)] bg-[var(--bg-secondary)]/30"
              />
            )
          }
          const key = dayKey(cell.date)
          const dayMeetings = byDay.get(key) || []
          const isToday = key === todayKey
          const isPast = cell.date.getTime() < todayMidnight
          const openDay = () => {
            if (dayMeetings.length) setDayModal({ date: cell.date, items: dayMeetings })
          }
          return (
            <div
              key={key}
              onClick={openDay}
              className={`group relative min-h-[88px] border-b border-r border-[var(--border-primary)] p-1.5 align-top ${
                dayMeetings.length ? 'cursor-pointer' : ''
              }`}
            >
              <div className="flex items-center justify-between">
                {onAddOnDate && !isPast ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onAddOnDate(cell.date)
                    }}
                    title="Add meeting on this day"
                    className="inline-flex items-center justify-center h-5 w-5 rounded-full text-[var(--text-tertiary)] opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-[#2B79F7] hover:bg-[#2B79F7]/10 transition-opacity"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                ) : (
                  <span />
                )}
                <span
                  className={`inline-flex items-center justify-center text-[11px] h-5 w-5 rounded-full ${
                    isToday ? 'bg-[#2B79F7] text-white font-semibold' : 'text-[var(--text-tertiary)]'
                  }`}
                >
                  {cell.day}
                </span>
              </div>
              <div className="mt-0.5 space-y-0.5">
                {dayMeetings.slice(0, 3).map((m) => {
                  const t = new Date(m.date_time).toLocaleTimeString([], {
                    hour: 'numeric',
                    minute: '2-digit',
                  })
                  const isFocused = m.id === focusMeetingId
                  return (
                    <button
                      key={m.id}
                      onClick={(e) => {
                        e.stopPropagation()
                        onSelectMeeting(m)
                      }}
                      title={`${m.title} · ${t}`}
                      className={`w-full text-left truncate rounded px-1 py-0.5 text-[10px] leading-tight transition-opacity hover:opacity-80 ${pillClasses(
                        m.status,
                      )} ${isFocused ? 'ring-2 ring-[#2B79F7] ring-offset-1 ring-offset-[var(--bg-card)]' : ''}`}
                    >
                      <span className="tabular-nums">{t}</span> {m.title}
                    </button>
                  )
                })}
                {dayMeetings.length > 3 && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      openDay()
                    }}
                    className="w-full text-left px-1 text-[10px] text-[var(--text-tertiary)] hover:text-[#2B79F7]"
                  >
                    +{dayMeetings.length - 3} more
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* "All meetings on this day" popup. Clicking a row opens the normal
          detail modal (via onSelectMeeting) and closes this one. */}
      {dayModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setDayModal(null)}
        >
          <div
            className="w-full max-w-sm max-h-[80vh] flex flex-col rounded-2xl bg-[var(--bg-card)] border border-[var(--border-primary)] shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-primary)]">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                {dayModal.date.toLocaleDateString(undefined, {
                  weekday: 'long',
                  month: 'short',
                  day: 'numeric',
                })}
                <span className="ml-2 text-[var(--text-tertiary)] font-normal">
                  {dayModal.items.length} meeting{dayModal.items.length === 1 ? '' : 's'}
                </span>
              </h3>
              <button
                type="button"
                onClick={() => setDayModal(null)}
                className="p-1.5 rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {dayModal.items.map((m) => {
                const t = new Date(m.date_time).toLocaleTimeString([], {
                  hour: 'numeric',
                  minute: '2-digit',
                })
                return (
                  <button
                    key={m.id}
                    onClick={() => {
                      onSelectMeeting(m)
                      setDayModal(null)
                    }}
                    className="w-full text-left flex items-center gap-2.5 px-3 py-2.5 rounded-lg hover:bg-[var(--bg-card-hover)] transition-colors"
                  >
                    <span
                      className={`shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded ${pillClasses(
                        m.status,
                      )}`}
                    >
                      {t}
                    </span>
                    <span className="flex-1 min-w-0 truncate text-sm text-[var(--text-primary)]">
                      {m.title}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
