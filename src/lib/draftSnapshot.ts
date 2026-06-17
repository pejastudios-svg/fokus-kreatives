/**
 * Crash/refresh/offline insurance for in-progress editors. The editor
 * writes its working state here on every change (cheap localStorage set);
 * on mount it restores and reopens. Server-side autosave is the durable
 * layer - this covers the gap between "typed" and "synced".
 */

export function saveDraftSnapshot(key: string, data: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify({ t: Date.now(), data }))
  } catch {
    /* storage full / private mode - autosave to the server still runs */
  }
}

export function loadDraftSnapshot<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { t?: number; data?: T }
    return (parsed?.data as T) ?? null
  } catch {
    return null
  }
}

export function clearDraftSnapshot(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}
