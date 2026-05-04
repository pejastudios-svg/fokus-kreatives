'use client'

import { useCallback, useEffect, useState } from 'react'

// Per-CRM default currency, persisted to localStorage. This is the
// currency that "All" totals get summed into - so `6 NGN + $5,000`
// renders as one coherent dollar figure (after FX), not "5006".
//
// Persistence is per-clientId so each workspace can run on its own
// reporting currency.

const FALLBACK = 'USD'

function storageKey(clientId: string) {
  return `crm-${clientId}-default-currency`
}

export function useDefaultCurrency(
  clientId: string | undefined,
): {
  defaultCurrency: string
  setDefaultCurrency: (next: string) => void
  ready: boolean
} {
  const [value, setValue] = useState<string>(FALLBACK)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!clientId || typeof window === 'undefined') {
      setReady(true)
      return
    }
    try {
      const stored = window.localStorage.getItem(storageKey(clientId))
      if (stored && /^[A-Z]{3}$/.test(stored)) setValue(stored)
    } catch {
      // localStorage might be disabled (private mode etc.) - fall back
      // silently to the default.
    }
    setReady(true)
  }, [clientId])

  const setDefaultCurrency = useCallback(
    (next: string) => {
      const upper = (next || '').toUpperCase()
      if (!/^[A-Z]{3}$/.test(upper)) return
      setValue(upper)
      if (clientId && typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(storageKey(clientId), upper)
        } catch {
          // Same as above - silent fall-through.
        }
      }
    },
    [clientId],
  )

  return { defaultCurrency: value, setDefaultCurrency, ready }
}
