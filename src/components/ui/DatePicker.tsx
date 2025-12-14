'use client'

import { useState, useRef, useEffect } from 'react'
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react'

interface DatePickerProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}

const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const days = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

export function DatePicker({ value, onChange, placeholder = 'Select date', className = '' }: DatePickerProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [viewDate, setViewDate] = useState(() => {
    if (value) return new Date(value)
    return new Date()
  })
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

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

  const handleSelectDate = (date: Date) => {
    onChange(date.toISOString().split('T')[0])
    setIsOpen(false)
  }

  const handleToday = () => {
    const today = new Date()
    onChange(today.toISOString().split('T')[0])
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

  const calendarDays = getDaysInMonth(viewDate)

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-3 px-4 py-2.5 bg-theme-input border border-theme-primary rounded-xl text-left focus:outline-none focus:ring-2 focus:ring-[#2B79F7] transition-all"
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

      {isOpen && (
        <div className="absolute z-50 mt-2 w-80 bg-theme-card border border-theme-primary rounded-2xl shadow-lg p-4 animate-in fade-in zoom-in duration-150">
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
            {calendarDays.map((day, index) => (
              <button
                key={index}
                type="button"
                onClick={() => handleSelectDate(day.date)}
                className={`
                  p-2 text-sm rounded-lg transition-all
                  ${!day.isCurrentMonth ? 'text-theme-tertiary' : 'text-theme-primary'}
                  ${isSelected(day.date) ? 'bg-[#2B79F7] text-white font-semibold' : 'hover:bg-theme-tertiary'}
                  ${isToday(day.date) && !isSelected(day.date) ? 'ring-1 ring-[#2B79F7] font-semibold' : ''}
                `}
              >
                {day.date.getDate()}
              </button>
            ))}
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
        </div>
      )}
    </div>
  )
}