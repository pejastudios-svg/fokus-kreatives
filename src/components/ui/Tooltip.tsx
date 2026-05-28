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
const GAP = 8

export function Tooltip({
  children,
  content,
  position = 'top',
  delay = 200,
  maxWidth,
}: TooltipProps) {
  const [show, setShow] = useState(false)
  // `coords` is null until we've measured the rendered tooltip and
  // computed its final on-screen position. We keep the bubble at
  // opacity 0 until then so it never flashes at the wrong spot.
  const [coords, setCoords] = useState<{
    top: number
    left: number
    arrow: number
  } | null>(null)
  const [visible, setVisible] = useState(false)
  const triggerRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)

  const handleMouseEnter = () => {
    timeoutRef.current = setTimeout(() => setShow(true), delay)
  }

  const handleMouseLeave = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    setShow(false)
    setCoords(null)
    setVisible(false)
  }

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [])

  // Position the tooltip once it's mounted. We anchor it to the
  // requested side of the trigger, then clamp it inside the viewport.
  // Positioning is done purely with top/left (no CSS transform) so the
  // open animation can own the `transform` property without the two
  // fighting - that conflict was previously defeating the clamp and
  // leaving edge tooltips clipped off-screen.
  useEffect(() => {
    if (!show) return
    const trigger = triggerRef.current
    const tip = tooltipRef.current
    if (!trigger || !tip) return

    const t = trigger.getBoundingClientRect()
    const w = tip.offsetWidth
    const h = tip.offsetHeight
    const vw = window.innerWidth
    const vh = window.innerHeight
    const centerX = t.left + t.width / 2
    const centerY = t.top + t.height / 2

    let top = 0
    let left = 0
    switch (position) {
      case 'top':
        top = t.top - GAP - h
        left = centerX - w / 2
        break
      case 'bottom':
        top = t.bottom + GAP
        left = centerX - w / 2
        break
      case 'left':
        top = centerY - h / 2
        left = t.left - GAP - w
        break
      case 'right':
        top = centerY - h / 2
        left = t.right + GAP
        break
    }

    // Clamp into the viewport so nothing spills past an edge.
    left = Math.min(Math.max(left, VIEWPORT_PADDING), vw - VIEWPORT_PADDING - w)
    top = Math.min(Math.max(top, VIEWPORT_PADDING), vh - VIEWPORT_PADDING - h)

    // Keep the arrow pointing at the trigger's center even after the
    // bubble has been clamped sideways. The offset is measured along
    // the bubble's edge and kept a little inside its rounded corners.
    let arrow: number
    if (position === 'top' || position === 'bottom') {
      arrow = Math.min(Math.max(centerX - left, 12), w - 12)
    } else {
      arrow = Math.min(Math.max(centerY - top, 12), h - 12)
    }

    setCoords({ top, left, arrow })
  }, [show, position, content])

  // Fade in only after the position is settled.
  useEffect(() => {
    if (!coords) return
    const id = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(id)
  }, [coords])

  const arrowClasses = {
    top: 'top-full -translate-x-1/2 border-t-[var(--bg-tertiary)] border-x-transparent border-b-transparent',
    bottom: 'bottom-full -translate-x-1/2 border-b-[var(--bg-tertiary)] border-x-transparent border-t-transparent',
    left: 'left-full -translate-y-1/2 border-l-[var(--bg-tertiary)] border-y-transparent border-r-transparent',
    right: 'right-full -translate-y-1/2 border-r-[var(--bg-tertiary)] border-y-transparent border-l-transparent',
  }

  const arrowStyle =
    position === 'top' || position === 'bottom'
      ? { left: coords?.arrow ?? 0 }
      : { top: coords?.arrow ?? 0 }

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
          className={`fixed z-[9999] px-3 py-1.5 text-xs font-medium rounded-lg shadow-lg transition-opacity duration-150 ${
            maxWidth ? 'whitespace-normal leading-snug' : 'whitespace-nowrap'
          } bg-theme-tertiary text-theme-primary border border-theme-primary ${
            visible ? 'opacity-100' : 'opacity-0'
          }`}
          style={{
            top: coords?.top ?? 0,
            left: coords?.left ?? 0,
            maxWidth: maxWidth ? `${maxWidth}px` : undefined,
          }}
        >
          {content}
          <div
            className={`absolute w-0 h-0 border-4 ${arrowClasses[position]}`}
            style={arrowStyle}
          />
        </div>,
        document.body,
      )}
    </>
  )
}
