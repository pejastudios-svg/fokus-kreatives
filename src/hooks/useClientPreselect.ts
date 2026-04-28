'use client'

import { useEffect } from 'react'

const STORAGE_KEY = 'selectedClientId'

/**
 * Read a previously stashed client id (set by "Create content" buttons across
 * the app) from sessionStorage. Use directly as the lazy initializer for
 * `useState`, e.g.
 *
 *   const [id, setId] = useState(readStashedClientId)
 *
 * The value is NOT cleared here - call `useApplyClientPreselect` once clients
 * are fetched so we can validate that the id still resolves to a real client
 * before treating it as authoritative, and only clear after that validation.
 */
export function readStashedClientId(): string {
  if (typeof window === 'undefined') return ''
  try {
    return window.sessionStorage.getItem(STORAGE_KEY) || ''
  } catch {
    return ''
  }
}

/**
 * Validate the preselected client against the fetched list, clear the stash,
 * and unset state if the id no longer corresponds to a real client.
 */
export function useApplyClientPreselect<T extends { id: string }>(
  selectedClientId: string,
  setSelectedClientId: (id: string) => void,
  clients: T[],
) {
  useEffect(() => {
    if (!selectedClientId) return
    if (clients.length === 0) return
    const exists = clients.some((c) => c.id === selectedClientId)
    if (!exists) setSelectedClientId('')
    try {
      window.sessionStorage.removeItem(STORAGE_KEY)
    } catch {
      // ignore
    }
  }, [selectedClientId, setSelectedClientId, clients])
}
