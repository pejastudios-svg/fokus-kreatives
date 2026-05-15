'use client'

import { useState, useRef, useEffect, ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface TooltipProps {
  children: ReactNode
  content: string
  position?: 'top' | 'bottom' | 'left' | 'right'
  delay?: number
  /** Max width in px. When set, the tooltip wraps content across
   *  multiple lines instead of forcing a single line. Useful for
   *  long explanatory text. Default unset = single-line behavior. */
  maxWidth?: number
}

const VIEWPORT_PADDING = 8

export function Tooltip({
  children,
  content,
  position = 'top',
  delay = 200,
  maxWidth,
}: TooltipProps) {
  const [show, setShow] = useState(false)
  const [coords, setCoords] = useState({ top: 0, left: 0 })
  const triggerRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)

  const handleMouseEnter = () => {
    timeoutRef.current = setTimeout(() => {
      if (!triggerRef.current) return
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
    }, delay)
  }

  const handleMouseLeave = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    setShow(false)
  }

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [])

  // After the tooltip mounts, measure its rendered bounding box and
  // shift it back into the viewport if it overflows. We mutate the
  // DOM `transform` directly (no state) so the clamp doesn't cause a
  // re-render - that re-render is what was making the tooltip flicker
  // / disappear in the previous version.
  useEffect(() => {
    if (!show) return
    const tip = tooltipRef.current
    if (!tip) return
    // Read the baseline transform (set by Tailwind's translate
    // classes) so our shift is additive, not overwriting.
    const baseTransform = window.getComputedStyle(tip).transform
    const baseChain = baseTransform === 'none' ? '' : baseTransform

    const rect = tip.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight

    let dx = 0
    let dy = 0
    if (rect.left < VIEWPORT_PADDING) dx = VIEWPORT_PADDING - rect.left
    if (rect.right > vw - VIEWPORT_PADDING) dx = vw - VIEWPORT_PADDING - rect.right
    if (rect.top < VIEWPORT_PADDING) dy = VIEWPORT_PADDING - rect.top
    if (rect.bottom > vh - VIEWPORT_PADDING) dy = vh - VIEWPORT_PADDING - rect.bottom

    if (dx !== 0 || dy !== 0) {
      tip.style.transform = `${baseChain} translate(${dx}px, ${dy}px)`
    }
  }, [show, coords])

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
          ref={tooltipRef}
          className={`fixed z-[9999] px-3 py-1.5 text-xs font-medium rounded-lg shadow-lg ${
            maxWidth ? 'whitespace-normal leading-snug' : 'whitespace-nowrap'
          } animate-in fade-in zoom-in duration-150 bg-theme-tertiary text-theme-primary border border-theme-primary ${positionClasses[position]}`}
          style={{
            top: coords.top,
            left: coords.left,
            maxWidth: maxWidth ? `${maxWidth}px` : undefined,
          }}
        >
          {content}
          <div className={`absolute w-0 h-0 border-4 ${arrowClasses[position]}`} />
        </div>,
        document.body,
      )}
    </>
  )
}
