'use client'

import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { CommentRegion } from '@/lib/types/annotations'

/**
 * Renders a saved region (circle or freeform path) as an SVG overlay on top
 * of the asset element it's positioned over. Coordinates inside `region` are
 * 0-1 relative to the asset's rendered bounding box; we measure the box on
 * mount + on resize and project them into pixel space.
 *
 * The overlay stays visible until the parent unmounts it or the user taps the
 * close badge. `flashing` controls whether the stroke pulses (used for the
 * first second after a comment pill is clicked, to draw the eye).
 */
interface RegionOverlayProps {
  region: CommentRegion
  /** The element the region was drawn relative to (image / video). */
  assetRef: HTMLElement | null
  flashing?: boolean
  onClose?: () => void
}

export function RegionOverlay({
  region,
  assetRef,
  flashing = false,
  onClose,
}: RegionOverlayProps) {
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  // Pulse only for the first second after the overlay appears. After that,
  // the stroke stays solid so the user can study the highlight without a
  // distracting animation.
  const [pulse, setPulse] = useState(flashing)
  const containerRef = useRef<HTMLDivElement | null>(null)

  // Track the asset's bounding rect inside the nearest positioned ancestor.
  useEffect(() => {
    if (!assetRef) return
    const update = () => {
      if (!assetRef || !containerRef.current?.parentElement) return
      const a = assetRef.getBoundingClientRect()
      const p = containerRef.current.parentElement.getBoundingClientRect()
      setBox({ x: a.left - p.left, y: a.top - p.top, w: a.width, h: a.height })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(assetRef)
    window.addEventListener('resize', update)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [assetRef])

  useEffect(() => {
    // The state is already seeded with `flashing`, so we only need to schedule
    // the calm-down. setState inside an effect (without a synchronous prefix)
    // satisfies the strict React rule.
    if (!flashing) return
    const t = setTimeout(() => setPulse(false), 1000)
    return () => clearTimeout(t)
  }, [flashing])

  if (!box) return <div ref={containerRef} className="absolute inset-0 pointer-events-none" />

  // Build SVG content for circle vs freeform.
  const longest = Math.max(box.w, box.h)
  const stroke = '#FF5757'
  const strokeWidth = 4
  const dash: string | undefined = undefined

  let shape: React.ReactElement | null = null
  if (region.shape === 'circle') {
    shape = (
      <circle
        cx={region.x * box.w}
        cy={region.y * box.h}
        r={Math.max(2, region.radius * longest)}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeDasharray={dash}
      />
    )
  } else if (region.shape === 'freeform' && region.points.length >= 2) {
    const d = region.points
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x * box.w} ${p.y * box.h}`)
      .join(' ')
    shape = (
      <path
        d={d}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeDasharray={dash}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    )
  }

  return (
    <div ref={containerRef} className="absolute inset-0 pointer-events-none">
      <svg
        className={pulse ? 'absolute animate-pulse' : 'absolute'}
        style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
        viewBox={`0 0 ${box.w} ${box.h}`}
        aria-hidden
      >
        {shape}
      </svg>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Hide highlight"
          className="absolute pointer-events-auto inline-flex items-center justify-center h-7 w-7 rounded-full bg-black/70 text-white shadow-lg hover:bg-black"
          style={{
            left: box.x + box.w - 32,
            top: box.y + 4,
          }}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}
