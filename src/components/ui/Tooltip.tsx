'use client'

import { useState, useRef, useEffect, ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface TooltipProps {
  children: ReactNode
  content: string
  position?: 'top' | 'bottom' | 'left' | 'right'
  delay?: number
}

export function Tooltip({ children, content, position = 'top', delay = 200 }: TooltipProps) {
  const [show, setShow] = useState(false)
  const [coords, setCoords] = useState({ top: 0, left: 0 })
  const triggerRef = useRef<HTMLDivElement>(null)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)

  const handleMouseEnter = () => {
    timeoutRef.current = setTimeout(() => {
      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect()
        let top = 0
        let left = 0

        switch (position) {
          case 'top':
            top = rect.top - 8
            left = rect.left + rect.width / 2
            break
          case 'bottom':
            top = rect.bottom + 8
            left = rect.left + rect.width / 2
            break
          case 'left':
            top = rect.top + rect.height / 2
            left = rect.left - 8
            break
          case 'right':
            top = rect.top + rect.height / 2
            left = rect.right + 8
            break
        }

        setCoords({ top, left })
        setShow(true)
      }
    }, delay)
  }

  const handleMouseLeave = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }
    setShow(false)
  }

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  const positionClasses = {
    top: '-translate-x-1/2 -translate-y-full',
    bottom: '-translate-x-1/2',
    left: '-translate-x-full -translate-y-1/2',
    right: '-translate-y-1/2',
  }

  const arrowClasses = {
    top: 'top-full left-1/2 -translate-x-1/2 border-t-[var(--bg-tertiary)] border-x-transparent border-b-transparent',
    bottom: 'bottom-full left-1/2 -translate-x-1/2 border-b-[var(--bg-tertiary)] border-x-transparent border-t-transparent',
    left: 'left-full top-1/2 -translate-y-1/2 border-l-[var(--bg-tertiary)] border-y-transparent border-r-transparent',
    right: 'right-full top-1/2 -translate-y-1/2 border-r-[var(--bg-tertiary)] border-y-transparent border-l-transparent',
  }

  return (
    <>
      <div 
        ref={triggerRef}
        className="inline-flex"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {children}
      </div>
      {show && typeof window !== 'undefined' && createPortal(
        <div 
          className={`fixed z-[9999] px-3 py-1.5 text-xs font-medium rounded-lg shadow-lg whitespace-nowrap animate-in fade-in zoom-in duration-150 bg-theme-tertiary text-theme-primary border border-theme-primary ${positionClasses[position]}`}
          style={{ top: coords.top, left: coords.left }}
        >
          {content}
          <div className={`absolute w-0 h-0 border-4 ${arrowClasses[position]}`} />
        </div>,
        document.body
      )}
    </>
  )
}