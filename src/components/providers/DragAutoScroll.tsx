'use client'

// Mounts the document-wide drag-edge-auto-scroll listener exactly once.
// No DOM output, no children - just sits inside the app layout and
// keeps the listener alive.

import { useDragAutoScroll } from '@/hooks/useDragAutoScroll'

export function DragAutoScroll() {
  useDragAutoScroll()
  return null
}
