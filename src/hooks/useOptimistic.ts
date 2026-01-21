'use client'

import { useState, useCallback } from 'react'

interface OptimisticState<T> {
  data: T
  pending: Set<string>
  errors: Map<string, string>
}

export function useOptimistic<T>(initialData: T) {
  const [state, setState] = useState<OptimisticState<T>>({
    data: initialData,
    pending: new Set(),
    errors: new Map(),
  })

  // Fixed: Removed unused generic <K extends keyof T>
  const optimisticUpdate = useCallback(async (
    key: string,
    updateFn: () => T | Partial<T>,
    asyncFn: () => Promise<void>,
    rollbackFn?: () => T | Partial<T>
  ) => {
    // Mark as pending
    setState(prev => ({
      ...prev,
      pending: new Set([...prev.pending, key]),
      errors: new Map([...prev.errors].filter(([k]) => k !== key)),
    }))

    // Apply optimistic update immediately
    const optimisticData = updateFn()
    setState(prev => ({
      ...prev,
      data: typeof optimisticData === 'object' ? { ...prev.data, ...optimisticData } : optimisticData as T,
    }))

    try {
      // Perform actual async operation
      await asyncFn()
      
      // Remove from pending on success
      setState(prev => ({
        ...prev,
        pending: new Set([...prev.pending].filter(k => k !== key)),
      }))
    } catch (error) {
      // Rollback on error
      if (rollbackFn) {
        const rollbackData = rollbackFn()
        setState(prev => ({
          ...prev,
          data: typeof rollbackData === 'object' ? { ...prev.data, ...rollbackData } : rollbackData as T,
        }))
      }

      // Mark error
      setState(prev => ({
        ...prev,
        pending: new Set([...prev.pending].filter(k => k !== key)),
        errors: new Map([...prev.errors, [key, error instanceof Error ? error.message : 'Failed']]),
      }))
    }
  }, [])

  const isPending = useCallback((key: string) => state.pending.has(key), [state.pending])
  const getError = useCallback((key: string) => state.errors.get(key), [state.errors])
  const clearError = useCallback((key: string) => {
    setState(prev => ({
      ...prev,
      errors: new Map([...prev.errors].filter(([k]) => k !== key)),
    }))
  }, [])

  return {
    data: state.data,
    setData: (data: T) => setState(prev => ({ ...prev, data })),
    optimisticUpdate,
    isPending,
    getError,
    clearError,
    hasPending: state.pending.size > 0,
  }
}