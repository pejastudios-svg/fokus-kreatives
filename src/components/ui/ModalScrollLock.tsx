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
import { acquireScrollLock, releaseScrollLock } from '@/hooks/useBodyScrollLock'

const OVERLAY_SELECTOR = '.fixed.inset-0[class*="bg-black"]'

// An overlay only counts as an OPEN modal if it's actually visible. Hidden
// backdrops that live permanently in the DOM - the mobile-nav scrim
// (`md:hidden …` = display:none on desktop) or a closed drawer
// (`opacity-0 pointer-events-none`) - must NOT lock scroll.
function isVisible(el: Element): boolean {
  const cs = getComputedStyle(el)
  if (cs.display === 'none' || cs.visibility === 'hidden') return false
  if (parseFloat(cs.opacity || '1') < 0.05) return false
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0
}

export function ModalScrollLock() {
  useEffect(() => {
    let raf = 0
    let locked = false

    const apply = () => {
      raf = 0
      const hasModal = Array.from(document.querySelectorAll(OVERLAY_SELECTOR)).some(isVisible)
      // Go through the shared ref counter (not body.style directly) so this
      // observer and useBodyScrollLock never stomp each other's saved state.
      if (hasModal && !locked) {
        acquireScrollLock()
        locked = true
      } else if (!hasModal && locked) {
        releaseScrollLock()
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
      // Safety: release our lock if this unmounts while still held.
      if (locked) {
        releaseScrollLock()
        locked = false
      }
    }
  }, [])

  return null
}
