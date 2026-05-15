'use client'

// Global drag-near-edge auto-scroll. Mount this hook once at the app
// root and any HTML5 drag (drag-to-reorder lists, drag-to-status board,
// drag-to-move) inside a scrollable container gets edge auto-scroll
// for free.
//
// How it works:
//   - Listen to document-wide `dragover` events.
//   - Walk up from the cursor target to find the nearest scrollable
//     ancestor (overflow-y: auto|scroll, scrollHeight > clientHeight).
//   - Measure distance from cursor to that container's top/bottom edge.
//   - Within EDGE_THRESHOLD px of an edge, set a scroll velocity
//     proportional to how close to the edge ("the closer, the faster").
//   - A requestAnimationFrame loop applies the velocity each frame.
//   - When the drag ends/drops, the loop stops.
//
// Why global: drag events bubble. One listener works for every
// draggable surface in the app - per-list code stays unchanged.

import { useEffect } from 'react'

const EDGE_THRESHOLD = 80   // px from edge where auto-scroll kicks in
const MAX_SPEED = 14         // px per frame at the very edge

function isScrollableY(el: Element): boolean {
  const style = window.getComputedStyle(el)
  const overflowY = style.overflowY
  if (overflowY !== 'auto' && overflowY !== 'scroll' && overflowY !== 'overlay') {
    return false
  }
  return el.scrollHeight > el.clientHeight
}

function findScrollableAncestor(start: Element | null): Element | null {
  let el: Element | null = start
  while (el && el !== document.body) {
    if (isScrollableY(el)) return el
    el = el.parentElement
  }
  // Fallback: the viewport. Returns documentElement so window scroll works.
  if (document.documentElement.scrollHeight > document.documentElement.clientHeight) {
    return document.documentElement
  }
  return null
}

export function useDragAutoScroll(): void {
  useEffect(() => {
    let scrollTarget: Element | null = null
    let velocity = 0
    let rafId: number | null = null

    const loop = () => {
      if (scrollTarget && velocity !== 0) {
        scrollTarget.scrollTop += velocity
        rafId = requestAnimationFrame(loop)
      } else {
        rafId = null
      }
    }

    const onDragOver = (e: DragEvent) => {
      const target = e.target as Element | null
      const scrollable = findScrollableAncestor(target)
      if (!scrollable) {
        velocity = 0
        scrollTarget = null
        return
      }

      // Use the viewport edges for documentElement, the element's rect otherwise.
      let topEdge: number
      let bottomEdge: number
      if (scrollable === document.documentElement) {
        topEdge = 0
        bottomEdge = window.innerHeight
      } else {
        const rect = scrollable.getBoundingClientRect()
        topEdge = rect.top
        bottomEdge = rect.bottom
      }

      const distFromTop = e.clientY - topEdge
      const distFromBottom = bottomEdge - e.clientY

      if (distFromTop < EDGE_THRESHOLD && distFromTop > -EDGE_THRESHOLD) {
        velocity = -Math.ceil(MAX_SPEED * Math.max(0, 1 - distFromTop / EDGE_THRESHOLD))
        scrollTarget = scrollable
      } else if (distFromBottom < EDGE_THRESHOLD && distFromBottom > -EDGE_THRESHOLD) {
        velocity = Math.ceil(MAX_SPEED * Math.max(0, 1 - distFromBottom / EDGE_THRESHOLD))
        scrollTarget = scrollable
      } else {
        velocity = 0
        scrollTarget = null
        return
      }

      if (rafId === null && velocity !== 0) {
        rafId = requestAnimationFrame(loop)
      }
    }

    const stop = () => {
      velocity = 0
      scrollTarget = null
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
        rafId = null
      }
    }

    document.addEventListener('dragover', onDragOver, { passive: true })
    document.addEventListener('dragend', stop)
    document.addEventListener('drop', stop)
    // dragleave on the window edge can leave the loop running otherwise.
    window.addEventListener('blur', stop)

    return () => {
      document.removeEventListener('dragover', onDragOver)
      document.removeEventListener('dragend', stop)
      document.removeEventListener('drop', stop)
      window.removeEventListener('blur', stop)
      if (rafId !== null) cancelAnimationFrame(rafId)
    }
  }, [])
}
