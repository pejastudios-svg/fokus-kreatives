'use client'

import { useEffect, useRef, useState } from 'react'
import type { CommentRegion } from '@/lib/types/annotations'

/**
 * Renders a saved region (circle or freeform path) as an SVG overlay on top
 * of the asset element it's positioned over. Coordinates inside `region` are
 * 0-1 relative to the asset's rendered bounding box; we measure the box on
 * mount + on resize and project them into pixel space.
 *
 * If `flashing` is true, the stroke pulses for ~2.5s then `onFlashDone`
 * fires - the parent uses this to clear the flash state.
 */
interface RegionOverlayProps {
  region: CommentRegion
  /** The element the region was drawn relative to (image / video). */
  assetRef: HTMLElement | null
  flashing?: boolean
  onFlashDone?: () => void
  /** Visual style. `flash` pulses; `static` is a thin dashed outline. */
  variant?: 'flash' | 'static'
}

export function RegionOverlay({
  region,
  assetRef,
  flashing = false,
  onFlashDone,
  variant = 'flash',
}: RegionOverlayProps) {
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
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
    if (!flashing || !onFlashDone) return
    const t = setTimeout(onFlashDone, 2500)
    return () => clearTimeout(t)
  }, [flashing, onFlashDone])

  if (!box) return <div ref={containerRef} className="absolute inset-0 pointer-events-none" />

  // Build SVG content for circle vs freeform.
  const longest = Math.max(box.w, box.h)
  const stroke = flashing ? '#FF5757' : '#1E54B7'
  const strokeWidth = flashing ? 4 : 2
  const dash = variant === 'static' ? '6 4' : undefined

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
    <div
      ref={containerRef}
      className="absolute inset-0 pointer-events-none"
      aria-hidden
    >
      <svg
        className={flashing ? 'absolute animate-pulse' : 'absolute'}
        style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
        viewBox={`0 0 ${box.w} ${box.h}`}
      >
        {shape}
      </svg>
    </div>
  )
}
