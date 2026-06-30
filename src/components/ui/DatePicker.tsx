'use client'

import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react'

const POPOVER_WIDTH = 320
const POPOVER_HEIGHT = 420

interface DatePickerProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  /** Grey out + disable any day before today (e.g. meeting dates). */
  disablePast?: boolean
}

const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const days = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

export function DatePicker({ value, onChange, placeholder = 'Select date', className = '', disablePast = false }: DatePickerProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [viewDate, setViewDate] = useState(() => {
    if (value) return new Date(value)
    return new Date()
  })
  // The calendar is rendered in a portal with FIXED positioning so it's
  // never clipped by a modal's overflow. We compute its coords from the
  // trigger rect on open and keep them in sync on scroll/resize.
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const t = e.target as Node
      if (containerRef.current?.contains(t)) return
      if (popoverRef.current?.contains(t)) return
      setIsOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Position the popover: below the trigger by default, flipped above when
  // there isn't room, and shifted left so it never runs off the right edge.
  useLayoutEffect(() => {
    if (!isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on close
      setCoords(null)
      return
    }
    const place = () => {
      const btn = buttonRef.current
      if (!btn) return
      const rect = btn.getBoundingClientRect()
      const spaceBelow = window.innerHeight - rect.bottom
      const spaceAbove = rect.top
      const openUp = spaceBelow < POPOVER_HEIGHT && spaceAbove > spaceBelow
      let top = openUp ? rect.top - POPOVER_HEIGHT - 8 : rect.bottom + 8
      top = Math.max(8, Math.min(top, window.innerHeight - POPOVER_HEIGHT - 8))
      let left = rect.left
      if (left + POPOVER_WIDTH > window.innerWidth - 8) left = window.innerWidth - POPOVER_WIDTH - 8
      left = Math.max(8, left)
      setCoords({ top, left })
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [isOpen])

  const selectedDate = value ? new Date(value) : null

  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear()
    const month = date.getMonth()
    const firstDay = new Date(year, month, 1).getDay()
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const daysInPrevMonth = new Date(year, month, 0).getDate()
    
    const days: { date: Date; isCurrentMonth: boolean }[] = []
    
    // Previous month days
    for (let i = firstDay - 1; i >= 0; i--) {
      days.push({
        date: new Date(year, month - 1, daysInPrevMonth - i),
        isCurrentMonth: false,
      })
    }
    
    // Current month days
    for (let i = 1; i <= daysInMonth; i++) {
      days.push({
        date: new Date(year, month, i),
        isCurrentMonth: true,
      })
    }
    
    // Next month days
    const remaining = 42 - days.length
    for (let i = 1; i <= remaining; i++) {
      days.push({
        date: new Date(year, month + 1, i),
        isCurrentMonth: false,
      })
    }
    
    return days
  }

  const handlePrevMonth = () => {
    setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1))
  }

  const handleNextMonth = () => {
    setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1))
  }

  // Format the picked Date as YYYY-MM-DD using LOCAL components,
  // not UTC. toISOString() converts to UTC first - so in a timezone
  // east of UTC, picking May 15 (midnight local = previous-day-23:00
  // UTC) would emit "2026-05-14" and the user would see the wrong
  // day selected. Reading year/month/date in local fixes the
  // off-by-one across all eastern zones.
  const toLocalYmd = (d: Date) => {
    const yyyy = d.getFullYear()
    const mm = (d.getMonth() + 1).toString().padStart(2, '0')
    const dd = d.getDate().toString().padStart(2, '0')
    return `${yyyy}-${mm}-${dd}`
  }

  const handleSelectDate = (date: Date) => {
    onChange(toLocalYmd(date))
    setIsOpen(false)
  }

  const handleToday = () => {
    const today = new Date()
    onChange(toLocalYmd(today))
    setViewDate(today)
    setIsOpen(false)
  }

  const isToday = (date: Date) => {
    const today = new Date()
    return date.toDateString() === today.toDateString()
  }

  const isSelected = (date: Date) => {
    return selectedDate && date.toDateString() === selectedDate.toDateString()
  }

  const isPast = (date: Date) => {
    const d = new Date(date)
    d.setHours(0, 0, 0, 0)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return d.getTime() < today.getTime()
  }

  const calendarDays = getDaysInMonth(viewDate)

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-3 px-4 py-2.5 glass-field text-left transition-all"
      >
        <Calendar className="h-4 w-4 text-theme-tertiary" />
        <span className={selectedDate ? 'text-theme-primary' : 'text-theme-tertiary'}>
          {selectedDate ? selectedDate.toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric', 
            year: 'numeric' 
          }) : placeholder}
        </span>
      </button>

      {isOpen && coords && typeof document !== 'undefined' && createPortal(
        <div
          ref={popoverRef}
          style={{ position: 'fixed', top: coords.top, left: coords.left, width: POPOVER_WIDTH, zIndex: 1000 }}
          className="glass-pop rounded-2xl p-4 animate-in fade-in zoom-in duration-150"
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <button
              type="button"
              onClick={handlePrevMonth}
              className="p-2 hover:bg-theme-tertiary rounded-lg transition-colors"
            >
              <ChevronLeft className="h-4 w-4 text-theme-secondary" />
            </button>
            <span className="font-semibold text-theme-primary">
              {months[viewDate.getMonth()]} {viewDate.getFullYear()}
            </span>
            <button
              type="button"
              onClick={handleNextMonth}
              className="p-2 hover:bg-theme-tertiary rounded-lg transition-colors"
            >
              <ChevronRight className="h-4 w-4 text-theme-secondary" />
            </button>
          </div>

          {/* Days header */}
          <div className="grid grid-cols-7 gap-1 mb-2">
            {days.map(day => (
              <div key={day} className="text-center text-xs font-medium text-theme-tertiary py-2">
                {day}
              </div>
            ))}
          </div>

          {/* Calendar grid */}
          <div className="grid grid-cols-7 gap-1">
            {calendarDays.map((day, index) => {
              const selected = isSelected(day.date)
              const past = disablePast && isPast(day.date)
              // Single source of text colour so the selected day's white
              // text isn't overridden by text-theme-primary.
              const cls = past
                ? 'text-theme-tertiary opacity-30 cursor-not-allowed'
                : selected
                ? 'bg-[#2B79F7] text-white font-semibold'
                : !day.isCurrentMonth
                ? 'text-theme-tertiary hover:bg-theme-tertiary'
                : 'text-theme-primary hover:bg-theme-tertiary'
              const ring =
                !past && isToday(day.date) && !selected ? 'ring-1 ring-[#2B79F7] font-semibold' : ''
              return (
                <button
                  key={index}
                  type="button"
                  disabled={past}
                  onClick={() => !past && handleSelectDate(day.date)}
                  className={`p-2 text-sm rounded-lg transition-all ${cls} ${ring}`}
                >
                  {day.date.getDate()}
                </button>
              )
            })}
          </div>

          {/* Footer */}
          <div className="mt-4 pt-4 border-t border-theme-primary flex justify-between">
            <button
              type="button"
              onClick={handleToday}
              className="text-sm text-[#2B79F7] hover:underline font-medium"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => { onChange(''); setIsOpen(false) }}
              className="text-sm text-theme-tertiary hover:text-theme-primary"
            >
              Clear
            </button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}