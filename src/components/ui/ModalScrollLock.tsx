'use client'

// Global background-scroll lock for modals. Mount once at the app root.
//
// Rather than wiring a hook into every modal (and risking missing one),
// this watches the DOM for the app's standard modal-overlay pattern - a
// full-screen `fixed inset-0` element with a `bg-black/…` backdrop - and
// locks <body> scroll whenever at least one is present, unlocking when the
// last closes. It coexists safely with the existing useBodyScrollLock hook:
// both only toggle `body.style.overflow`, and this observer re-asserts the
// correct state after every DOM change, so nested modals never leave the
// page scrollable or stuck locked.

import { useEffect } from 'react'

const OVERLAY_SELECTOR = '.fixed.inset-0[class*="bg-black"]'

export function ModalScrollLock() {
  useEffect(() => {
    let raf = 0
    let locked = false
    let savedOverflow = ''

    const apply = () => {
      raf = 0
      const hasModal = document.querySelector(OVERLAY_SELECTOR) !== null
      if (hasModal && !locked) {
        savedOverflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        locked = true
      } else if (!hasModal && locked) {
        document.body.style.overflow = savedOverflow
        locked = false
      }
    }

    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(apply)
    }

    const observer = new MutationObserver(schedule)
    observer.observe(document.body, { childList: true, subtree: true })
    apply() // initial state (e.g. a modal already open on mount)

    return () => {
      observer.disconnect()
      if (raf) cancelAnimationFrame(raf)
      // Safety: never leave the page locked if this unmounts.
      if (locked) document.body.style.overflow = savedOverflow
    }
  }, [])

  return null
}
