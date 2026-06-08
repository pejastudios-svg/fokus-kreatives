'use client'

// Locks document scroll while a modal/drawer is open.
//
// IMPORTANT: there are two callers that lock body scroll - this hook (used
// explicitly inside modals) and the global ModalScrollLock observer (which
// locks whenever a `.fixed.inset-0[bg-black]` overlay is present). A modal
// that uses BOTH (e.g. the planner SlotDetailDrawer calls this hook AND
// renders a bg-black backdrop) used to double-lock: the hook set overflow to
// 'hidden', then the observer captured that already-'hidden' value as its
// "original" and restored it on close, leaving the page permanently locked.
//
// To prevent that, both callers go through the SAME module-level ref counter
// below. Only the first acquirer captures the real original overflow, and it's
// only restored when the last lock releases - so any mix of hook + observer
// (in any order) unlocks cleanly.
//
//   useBodyScrollLock(isOpen)

import { useEffect } from 'react'

let openLocks = 0
let originalOverflow = ''

export function acquireScrollLock(): void {
  if (typeof document === 'undefined') return
  if (openLocks === 0) {
    originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
  openLocks += 1
}

export function releaseScrollLock(): void {
  if (typeof document === 'undefined') return
  openLocks = Math.max(0, openLocks - 1)
  if (openLocks === 0) {
    document.body.style.overflow = originalOverflow
    originalOverflow = ''
  }
}

export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return
    acquireScrollLock()
    return () => releaseScrollLock()
  }, [active])
}
