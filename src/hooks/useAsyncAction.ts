'use client'

import { useCallback, useRef, useState } from 'react'

/**
 * Wrap an async handler so it can't run concurrently. While the previous call
 * is still in flight, subsequent invocations are dropped - no double-submits,
 * no double-charges, no popping the same modal twice.
 *
 *   const { run: handleCreate, isRunning: isCreating } = useAsyncAction(
 *     async () => {
 *       await fetch(...)
 *     }
 *   )
 *
 * Bind `run` to the button's onClick and `isRunning` to its `disabled` /
 * `isLoading` props. Always passes `event.preventDefault()` and `stopPropagation()`
 * through if the runner is invoked with a DOM event.
 *
 * The runner forwards its return value, so callers can `await` it.
 */
export function useAsyncAction<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
): {
  run: (...args: TArgs) => Promise<TResult | undefined>
  isRunning: boolean
} {
  const [isRunning, setIsRunning] = useState(false)
  // Ref + state. The ref is the source of truth used by the guard below - state
  // updates are async and would let two near-simultaneous calls slip through.
  const inFlightRef = useRef(false)

  const run = useCallback(
    async (...args: TArgs): Promise<TResult | undefined> => {
      if (inFlightRef.current) return undefined
      inFlightRef.current = true
      setIsRunning(true)
      try {
        return await fn(...args)
      } finally {
        inFlightRef.current = false
        setIsRunning(false)
      }
    },
    [fn],
  )

  return { run, isRunning }
}
