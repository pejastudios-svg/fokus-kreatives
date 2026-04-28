/**
 * SessionStorage cache for approval detail pages.
 *
 * Lets the user navigate in and out of an approval without re-loading from
 * scratch every time. On mount we read what's cached; if it's still fresh we
 * render the page instantly with that data and silently re-fetch in the
 * background. On every successful state update we write the latest snapshot
 * back so the next visit hydrates from current data.
 *
 * SessionStorage = scoped to the tab. Closing the tab clears the cache, so
 * stale data can't haunt a fresh session. TTL guards against using snapshots
 * that are older than the freshness window (e.g. realtime missed an event).
 */

const CACHE_VERSION = 1
const TTL_MS = 5 * 60 * 1000

interface Cached<T> {
  v: number
  at: number
  data: T
}

function key(approvalId: string) {
  return `approval-cache:v${CACHE_VERSION}:${approvalId}`
}

export function readApprovalCache<T>(approvalId: string): T | null {
  if (!approvalId || typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(key(approvalId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Cached<T>
    if (parsed.v !== CACHE_VERSION) return null
    if (Date.now() - parsed.at > TTL_MS) return null
    return parsed.data
  } catch {
    return null
  }
}

export function writeApprovalCache<T>(approvalId: string, data: T) {
  if (!approvalId || typeof window === 'undefined') return
  try {
    const payload: Cached<T> = { v: CACHE_VERSION, at: Date.now(), data }
    window.sessionStorage.setItem(key(approvalId), JSON.stringify(payload))
  } catch {
    // storage full or disabled - safe to ignore
  }
}

export function clearApprovalCache(approvalId: string) {
  if (!approvalId || typeof window === 'undefined') return
  try {
    window.sessionStorage.removeItem(key(approvalId))
  } catch {
    // ignore
  }
}
