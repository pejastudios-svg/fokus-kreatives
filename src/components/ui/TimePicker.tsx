'use client'

// TimePicker - sibling of DatePicker. Same string-based API
// (value/onChange = "HH:MM" in 24-hour, identical to <input type="time">)
// so it drops in anywhere we'd otherwise use the native time input.
//
// UI: a button showing the formatted 12-hour time + AM/PM. Click
// opens a popover with hour column + minute column (15-min granularity
// by default) + AM/PM toggle. Picking an hour or minute updates the
// value immediately; clicking anywhere outside closes the popover.
//
// The component uses CSS-variable theme tokens (bg-theme-*, etc) so
// the capture page's overridden palette flows through automatically.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Clock } from 'lucide-react'

interface TimePickerProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  /** Minute granularity. Default 5. Set to 1 for every minute. */
  step?: number
}

function formatLabel(value: string): string {
  if (!value) return ''
  const [hRaw, mRaw] = value.split(':')
  const h24 = Number(hRaw)
  const m = Number(mRaw)
  if (Number.isNaN(h24) || Number.isNaN(m)) return ''
  const period = h24 >= 12 ? 'PM' : 'AM'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${m.toString().padStart(2, '0')} ${period}`
}

function compose(h24: number, minute: number): string {
  return `${h24.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`
}

export function TimePicker({
  value,
  onChange,
  placeholder = 'Select time',
  className = '',
  step = 5,
}: TimePickerProps) {
  const [isOpen, setIsOpen] = useState(false)
  // `dropDirection` flips the popover above the button when there
  // isn't enough room below (e.g. the picker sits near the bottom
  // of the viewport on mobile). Measured after open.
  const [dropDirection, setDropDirection] = useState<'down' | 'up'>('down')
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  // Parse current value or seed with a sensible default (9:00 AM).
  const parsed = (() => {
    const [hRaw, mRaw] = (value || '').split(':')
    const h24 = Number(hRaw)
    const m = Number(mRaw)
    if (Number.isNaN(h24) || Number.isNaN(m)) {
      return { h24: 9, minute: 0 }
    }
    return { h24, minute: m }
  })()

  const period: 'AM' | 'PM' = parsed.h24 >= 12 ? 'PM' : 'AM'
  const hour12 = parsed.h24 % 12 === 0 ? 12 : parsed.h24 % 12

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  // On open, decide whether the popover should drop down or flip up
  // based on how much room is below the trigger button. Approx popover
  // height = 280px (3 columns + footer). If there isn't that much
  // below but there is above, flip up.
  useLayoutEffect(() => {
    if (!isOpen || !buttonRef.current) return
    const rect = buttonRef.current.getBoundingClientRect()
    const POPOVER_HEIGHT = 300
    const spaceBelow = window.innerHeight - rect.bottom
    const spaceAbove = rect.top
    const next: 'up' | 'down' =
      spaceBelow < POPOVER_HEIGHT && spaceAbove > spaceBelow ? 'up' : 'down'
    // eslint-disable-next-line react-hooks/set-state-in-effect -- viewport-conditional flip on open
    setDropDirection(next)
  }, [isOpen])

  const setHour = (newHour12: number) => {
    const newH24 =
      period === 'PM'
        ? (newHour12 % 12) + 12
        : newHour12 % 12
    onChange(compose(newH24, parsed.minute))
  }

  const setMinute = (newMin: number) => {
    onChange(compose(parsed.h24, newMin))
  }

  const setPeriod = (newPeriod: 'AM' | 'PM') => {
    if (newPeriod === period) return
    const newH24 =
      newPeriod === 'PM'
        ? (hour12 % 12) + 12
        : hour12 % 12
    onChange(compose(newH24, parsed.minute))
  }

  const hours = Array.from({ length: 12 }, (_, i) => i + 1) // 1..12
  const minutes: number[] = []
  for (let m = 0; m < 60; m += step) minutes.push(m)

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-2.5 bg-theme-input border border-theme-primary rounded-xl text-left focus:outline-none focus:ring-2 focus:ring-[#2B79F7] transition-all"
      >
        <Clock className="h-4 w-4 text-theme-tertiary" />
        <span className={value ? 'text-theme-primary' : 'text-theme-tertiary'}>
          {value ? formatLabel(value) : placeholder}
        </span>
      </button>

      {isOpen && (
        <div
          className={`absolute z-50 w-64 max-w-[calc(100vw-1rem)] bg-theme-card border border-theme-primary rounded-2xl shadow-lg p-3 animate-in fade-in zoom-in duration-150 ${
            dropDirection === 'up' ? 'bottom-full mb-2' : 'top-full mt-2'
          }`}
        >
          <div className="flex gap-2">
            {/* Hours column */}
            <div className="flex-1">
              <div className="text-[10px] uppercase tracking-wider text-theme-tertiary mb-1 px-1">Hour</div>
              <div className="max-h-48 overflow-y-auto pr-1 scrollbar-none">
                {hours.map((h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => setHour(h)}
                    className={`w-full py-1.5 text-sm rounded-md transition-colors ${
                      h === hour12
                        ? 'bg-[#2B79F7] text-white font-semibold'
                        : 'text-theme-primary hover:bg-theme-tertiary'
                    }`}
                  >
                    {h}
                  </button>
                ))}
              </div>
            </div>

            {/* Minutes column */}
            <div className="flex-1">
              <div className="text-[10px] uppercase tracking-wider text-theme-tertiary mb-1 px-1">Min</div>
              <div className="max-h-48 overflow-y-auto pr-1 scrollbar-none">
                {minutes.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMinute(m)}
                    className={`w-full py-1.5 text-sm rounded-md transition-colors ${
                      m === parsed.minute
                        ? 'bg-[#2B79F7] text-white font-semibold'
                        : 'text-theme-primary hover:bg-theme-tertiary'
                    }`}
                  >
                    {m.toString().padStart(2, '0')}
                  </button>
                ))}
              </div>
            </div>

            {/* AM/PM toggle */}
            <div className="flex flex-col gap-1.5">
              <div className="text-[10px] uppercase tracking-wider text-theme-tertiary mb-1 px-1">&nbsp;</div>
              {(['AM', 'PM'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPeriod(p)}
                  className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                    p === period
                      ? 'bg-[#2B79F7] text-white font-semibold'
                      : 'text-theme-primary hover:bg-theme-tertiary border border-theme-primary'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-3 pt-3 border-t border-theme-primary flex justify-between items-center">
            <button
              type="button"
              onClick={() => {
                const now = new Date()
                const roundedMin = Math.round(now.getMinutes() / step) * step
                onChange(compose(now.getHours(), Math.min(roundedMin, 59)))
                setIsOpen(false)
              }}
              className="text-xs text-[#2B79F7] hover:underline font-medium"
            >
              Now
            </button>
            <button
              type="button"
              onClick={() => {
                onChange('')
                setIsOpen(false)
              }}
              className="text-xs text-theme-tertiary hover:text-theme-primary"
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
