'use client'

import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface Props {
  /** Selected date as 'YYYY-MM-DD' (local), or '' when unset. */
  date: string
  /** Selected time as 'HH:MM' 24h (local), or '' when unset. */
  time: string
  onChange: (next: { date: string; time: string }) => void
}

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Inline date + time picker (no external dependency). A month grid picks
 *  the day; hour/minute selects + an AM/PM toggle pick the time. Emits a
 *  normalized { date: 'YYYY-MM-DD', time: 'HH:MM' } on every change. */
export function DateTimePicker({ date, time, onChange }: Props) {
  const selected = date ? new Date(`${date}T00:00:00`) : null
  const [cursor, setCursor] = useState(() => {
    const base = selected ?? new Date()
    return new Date(base.getFullYear(), base.getMonth(), 1)
  })

  const year = cursor.getFullYear()
  const month = cursor.getMonth()
  const firstWeekday = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const todayStr = toDateStr(new Date())

  const cells: Array<number | null> = []
  for (let i = 0; i < firstWeekday; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)

  // Parse current time into 12h parts; default to 9:00 AM when unset.
  const [h24, mm] = time ? time.split(':').map(Number) : [9, 0]
  const hour12 = h24 % 12 === 0 ? 12 : h24 % 12
  const period: 'AM' | 'PM' = h24 >= 12 ? 'PM' : 'AM'
  const minute = mm

  const monthLabel = cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

  function pickDay(d: number) {
    onChange({ date: toDateStr(new Date(year, month, d)), time: time || '09:00' })
  }

  function setTimeParts(nh12: number, nmin: number, nperiod: 'AM' | 'PM') {
    let h = nh12 % 12
    if (nperiod === 'PM') h += 12
    onChange({ date: date || todayStr, time: `${pad(h)}:${pad(nmin)}` })
  }

  const selectCls =
    'px-2 py-1.5 bg-[var(--bg-card)] border border-[var(--border-primary)] rounded-lg text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7]'

  return (
    <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-3">
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          onClick={() => setCursor(new Date(year, month - 1, 1))}
          className="p-1 rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-medium text-[var(--text-primary)]">{monthLabel}</span>
        <button
          type="button"
          onClick={() => setCursor(new Date(year, month + 1, 1))}
          className="p-1 rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 mb-1">
        {WEEKDAYS.map((w, i) => (
          <div key={i} className="text-center text-[10px] text-[var(--text-tertiary)]">
            {w}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((d, i) => {
          if (d == null) return <div key={i} />
          const ds = toDateStr(new Date(year, month, d))
          const isSel = ds === date
          const isToday = ds === todayStr
          const isPast = ds < todayStr
          return (
            <button
              key={i}
              type="button"
              disabled={isPast}
              onClick={() => pickDay(d)}
              className={`h-7 text-xs rounded-md transition-colors ${
                isPast
                  ? 'text-[var(--text-tertiary)] opacity-40 cursor-not-allowed'
                  : isSel
                  ? 'bg-[#2B79F7] text-white font-semibold'
                  : isToday
                  ? 'text-[#2B79F7] hover:bg-[var(--bg-card-hover)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)]'
              }`}
            >
              {d}
            </button>
          )
        })}
      </div>

      {/* Time */}
      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-[var(--border-primary)]">
        <span className="text-xs text-[var(--text-tertiary)] mr-auto">Time</span>
        <select
          value={hour12}
          onChange={(e) => setTimeParts(Number(e.target.value), minute, period)}
          className={selectCls}
          aria-label="Hour"
        >
          {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
        <span className="text-[var(--text-tertiary)]">:</span>
        <select
          value={minute}
          onChange={(e) => setTimeParts(hour12, Number(e.target.value), period)}
          className={selectCls}
          aria-label="Minute"
        >
          {Array.from({ length: 12 }, (_, i) => i * 5).map((m) => (
            <option key={m} value={m}>
              {pad(m)}
            </option>
          ))}
        </select>
        <div className="inline-flex rounded-lg border border-[var(--border-primary)] overflow-hidden">
          {(['AM', 'PM'] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setTimeParts(hour12, minute, p)}
              className={`px-2.5 py-1.5 text-xs transition-colors ${
                period === p
                  ? 'bg-[#2B79F7] text-white'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)]'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
