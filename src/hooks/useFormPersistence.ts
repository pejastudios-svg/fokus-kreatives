'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Persist form state to sessionStorage so accidental refreshes don't blow it away.
 * Cleared automatically when the tab closes (sessionStorage scope), or manually via clear().
 *
 * Returns [state, setState, clear, wasRestored].
 * `wasRestored` is true when state was hydrated from sessionStorage on mount -
 * use it to skip server-side prefill so a draft isn't overwritten.
 *
 *   const [form, setForm, clearForm, wasRestored] = useFormPersistence('intake:'+id, empty)
 *   useEffect(() => {
 *     if (wasRestored) return
 *     fetch(...).then(setForm)
 *   }, [wasRestored])
 *   // on successful submit: clearForm()
 */
export function useFormPersistence<T>(
  key: string,
  initial: T,
): [T, React.Dispatch<React.SetStateAction<T>>, () => void, boolean] {
  const restoredRef = useRef(false)
  // Only persist after the consumer has actually mutated state. Without this,
  // the very first render would write the empty initial state to sessionStorage,
  // making every subsequent visit "restore" an empty draft and short-circuit
  // server-side prefill - so the form would render blank for existing records.
  const userTouchedRef = useRef(false)

  const [state, setStateInner] = useState<T>(() => {
    if (typeof window === 'undefined') return initial
    try {
      const raw = window.sessionStorage.getItem(key)
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
    if (typeof window === 'undefined') return
    if (!userTouchedRef.current) return
    try {
      window.sessionStorage.setItem(key, JSON.stringify(state))
    } catch {
      // storage full or disabled - ignore
    }
  }, [key, state])

  const clear = useCallback(() => {
    setStateInner(initial)
    userTouchedRef.current = false
    if (typeof window !== 'undefined') {
      try {
        window.sessionStorage.removeItem(key)
      } catch {
        // ignore
      }
    }
    restoredRef.current = false
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return [state, setState, clear, restoredRef.current]
}
