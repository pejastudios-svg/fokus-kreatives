'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Circle as CircleIcon, Pen, Undo2, X } from 'lucide-react'
import type { CommentRegion } from '@/lib/types/annotations'

type DrawShape = 'circle' | 'freeform'

interface DrawCanvasProps {
  /** The asset element to draw over (image / video). We size + position the
   *  canvas to match its bounding box. */
  assetRef: HTMLElement | null
  /** Initial shape to start with; user can switch via the toolbar. */
  initialShape?: DrawShape
  onComplete: (region: CommentRegion) => void
  onCancel: () => void
}

/**
 * Interactive overlay that lets the user draw a circle or freeform path on an
 * asset. Coordinates are captured as 0-1 percentages of the asset's rendered
 * box, so the saved region renders correctly at any device size.
 */
export function DrawCanvas({
  assetRef,
  initialShape = 'circle',
  onComplete,
  onCancel,
}: DrawCanvasProps) {
  const [shape, setShape] = useState<DrawShape>(initialShape)
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [draft, setDraft] = useState<CommentRegion | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const drawingRef = useRef<{
    kind: 'circle'
    cx: number
    cy: number
  } | {
    kind: 'freeform'
    points: { x: number; y: number }[]
  } | null>(null)

  // Mirror the asset's rect inside the nearest positioned ancestor.
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

  const eventToPct = useCallback(
    (e: { clientX: number; clientY: number }) => {
      if (!box) return null
      const target = containerRef.current?.querySelector<HTMLDivElement>('[data-drawcanvas-surface]')
      if (!target) return null
      const r = target.getBoundingClientRect()
      const x = (e.clientX - r.left) / r.width
      const y = (e.clientY - r.top) / r.height
      return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) }
    },
    [box],
  )

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const pt = eventToPct(e)
    if (!pt) return
    e.currentTarget.setPointerCapture(e.pointerId)
    if (shape === 'circle') {
      drawingRef.current = { kind: 'circle', cx: pt.x, cy: pt.y }
      setDraft({ shape: 'circle', x: pt.x, y: pt.y, radius: 0.001 })
    } else {
      drawingRef.current = { kind: 'freeform', points: [pt] }
      setDraft({ shape: 'freeform', points: [pt, pt] })
    }
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drawingRef.current) return
    const pt = eventToPct(e)
    if (!pt) return
    if (drawingRef.current.kind === 'circle') {
      const dx = pt.x - drawingRef.current.cx
      const dy = pt.y - drawingRef.current.cy
      // Radius is normalised against the longest edge so the circle is the
      // same physical size on phones + monitors.
      const aspectScale =
        box && box.w >= box.h
          ? { dx, dy: dy * (box.h / box.w) }
          : box
            ? { dx: dx * (box.w / box.h), dy }
            : { dx, dy }
      const r = Math.sqrt(aspectScale.dx ** 2 + aspectScale.dy ** 2)
      setDraft({
        shape: 'circle',
        x: drawingRef.current.cx,
        y: drawingRef.current.cy,
        radius: Math.max(0.005, r),
      })
    } else {
      drawingRef.current.points.push(pt)
      setDraft({ shape: 'freeform', points: [...drawingRef.current.points] })
    }
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    drawingRef.current = null
  }

  const handleConfirm = () => {
    if (!draft) return
    onComplete(draft)
  }

  const handleClear = () => {
    drawingRef.current = null
    setDraft(null)
  }

  // Render a fallback toolbar even if the asset measurement hasn't settled
  // yet. Without this, an asset that hasn't loaded its dimensions would leave
  // the user staring at a UI that "did nothing" when they clicked Annotate.
  if (!box) {
    return (
      <div
        ref={containerRef}
        className="absolute inset-0 z-30 pointer-events-none flex items-start justify-start"
      >
        <div className="m-2 pointer-events-auto inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--bg-card)] shadow-lg border border-[var(--border-primary)] text-xs text-[var(--text-secondary)]">
          <span className="inline-block h-2 w-2 rounded-full bg-[#2B79F7] animate-pulse" />
          <span>Annotate mode (waiting on asset)…</span>
          <button
            type="button"
            onClick={onCancel}
            className="ml-1 px-1.5 py-0.5 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  // Render the current draft as SVG so the user sees what they're drawing.
  let preview: React.ReactElement | null = null
  if (draft && draft.shape === 'circle') {
    const longest = Math.max(box.w, box.h)
    preview = (
      <circle
        cx={draft.x * box.w}
        cy={draft.y * box.h}
        r={Math.max(2, draft.radius * longest)}
        fill="rgba(43,121,247,0.15)"
        stroke="#2B79F7"
        strokeWidth={3}
      />
    )
  } else if (draft && draft.shape === 'freeform' && draft.points.length >= 2) {
    const d = draft.points
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x * box.w} ${p.y * box.h}`)
      .join(' ')
    preview = (
      <path
        d={d}
        fill="none"
        stroke="#2B79F7"
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    )
  }

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 pointer-events-none z-30"
      aria-label="Draw region"
    >
      {/* Dimming + capture surface, sized to the asset only (so the toolbar
          buttons elsewhere stay clickable). */}
      <div
        data-drawcanvas-surface
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className="absolute bg-black/30 cursor-crosshair pointer-events-auto touch-none"
        style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
      >
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          viewBox={`0 0 ${box.w} ${box.h}`}
          preserveAspectRatio="none"
        >
          {preview}
        </svg>
      </div>

      {/* Floating toolbar - sits above the asset */}
      <div
        className="absolute pointer-events-auto flex items-center gap-1.5 p-1.5 rounded-lg bg-[var(--bg-card)] shadow-lg border border-[var(--border-primary)]"
        style={{ left: box.x + 8, top: box.y + 8 }}
      >
        <button
          type="button"
          onClick={() => {
            handleClear()
            setShape('circle')
          }}
          title="Circle"
          aria-label="Switch to circle"
          className={`p-1.5 rounded ${shape === 'circle' ? 'bg-[#E8F1FF] text-[#1E54B7]' : 'text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)]'}`}
        >
          <CircleIcon className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => {
            handleClear()
            setShape('freeform')
          }}
          title="Freeform"
          aria-label="Switch to freeform"
          className={`p-1.5 rounded ${shape === 'freeform' ? 'bg-[#E8F1FF] text-[#1E54B7]' : 'text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)]'}`}
        >
          <Pen className="h-4 w-4" />
        </button>
        <span className="w-px h-4 bg-[var(--bg-card-hover)] mx-0.5" />
        <button
          type="button"
          onClick={handleClear}
          disabled={!draft}
          title="Clear"
          aria-label="Clear drawing"
          className="p-1.5 rounded text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Undo2 className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onCancel}
          title="Cancel"
          aria-label="Cancel"
          className="p-1.5 rounded text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)]"
        >
          <X className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={!draft}
          title="Use this region"
          aria-label="Confirm region"
          className="ml-1 px-2.5 py-1 rounded bg-[#2B79F7] text-white text-xs font-medium hover:bg-[#1E54B7] disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1"
        >
          <Check className="h-3 w-3" /> Use
        </button>
      </div>
    </div>
  )
}
