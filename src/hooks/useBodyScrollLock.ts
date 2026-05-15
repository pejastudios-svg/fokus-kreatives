'use client'

// Locks document scroll while a modal/drawer is open. Preserves the
// previous `overflow` so chained modals (modal A opens modal B) don't
// stomp each other's state on unmount.
//
// Use it at the top of any modal that should prevent background
// scrolling. Pair it with `role="dialog"` so screen readers know.
//
//   useBodyScrollLock(isOpen)

import { useEffect } from 'react'

// Module-level counter: handles nested modals (e.g. confirm-inside-edit).
// We only restore the original overflow when the last lock is released.
let openLocks = 0
let originalOverflow: string | null = null

export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return
    if (openLocks === 0) {
      originalOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
    }
    openLocks += 1

    return () => {
      openLocks = Math.max(0, openLocks - 1)
      if (openLocks === 0) {
        document.body.style.overflow = originalOverflow ?? ''
        originalOverflow = null
      }
    }
  }, [active])
}
