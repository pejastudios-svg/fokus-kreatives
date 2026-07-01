'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Persist form state to web storage so a refresh / tab close doesn't blow it away.
 * Cleared manually via clear() (e.g. on successful submit).
 *
 * `storage` (default 'session'):
 *   - 'session' → sessionStorage: survives refresh, cleared when the tab closes.
 *   - 'local'   → localStorage: survives refresh AND tab close (draft is still
 *     there when the user comes back later). Use for forms where losing typed
 *     work is costly (long answer forms, builders).
 *
 * Returns [state, setState, clear, wasRestored].
 * `wasRestored` is true when state was hydrated from storage on mount -
 * use it to skip server-side prefill so a draft isn't overwritten.
 *
 *   const [form, setForm, clearForm, wasRestored] =
 *     useFormPersistence('intake:'+id, empty, { storage: 'local' })
 *   useEffect(() => {
 *     if (wasRestored) return
 *     fetch(...).then(setForm)
 *   }, [wasRestored])
 *   // on successful submit: clearForm()
 */
export function useFormPersistence<T>(
  key: string,
  initial: T,
  options?: { storage?: 'local' | 'session' },
): [T, React.Dispatch<React.SetStateAction<T>>, () => void, boolean] {
  const storageType = options?.storage ?? 'session'
  const getStore = (): Storage | null => {
    if (typeof window === 'undefined') return null
    try {
      return storageType === 'local' ? window.localStorage : window.sessionStorage
    } catch {
      return null
    }
  }
  const restoredRef = useRef(false)
  // Only persist after the consumer has actually mutated state. Without this,
  // the very first render would write the empty initial state to sessionStorage,
  // making every subsequent visit "restore" an empty draft and short-circuit
  // server-side prefill - so the form would render blank for existing records.
  const userTouchedRef = useRef(false)

  const [state, setStateInner] = useState<T>(() => {
    const store = getStore()
    if (!store) return initial
    try {
      const raw = store.getItem(key)
      if (raw !== null) {
        restoredRef.current = true
        return JSON.parse(raw) as T
      }
    } catch {
      // corrupt entry - ignore
    }
    return initial
  })

  const setState: React.Dispatch<React.SetStateAction<T>> = useCallback((updater) => {
    userTouchedRef.current = true
    setStateInner(updater)
  }, [])

  useEffect(() => {
    if (!userTouchedRef.current) return
    const store = getStore()
    if (!store) return
    try {
      store.setItem(key, JSON.stringify(state))
    } catch {
      // storage full or disabled - ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, state])

  const clear = useCallback(() => {
    setStateInner(initial)
    userTouchedRef.current = false
    const store = getStore()
    if (store) {
      try {
        store.removeItem(key)
      } catch {
        // ignore
      }
    }
    restoredRef.current = false
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return [state, setState, clear, restoredRef.current]
}
