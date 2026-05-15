// Per-client concurrency cap for heavyweight AI operations.
//
// Distinct from per-slot locks (which prevent the same slot from being
// generated twice). This caps how many DIFFERENT slot generations can
// run in parallel FOR THE SAME CLIENT.
//
// Why this exists:
//   The bulk-campaign button fires N parallel /generate-script calls.
//   With 8 slots in a campaign and ~7 Gemini calls per slot, a single
//   click can launch 50+ concurrent Gemini requests in seconds. That
//   trips Gemini RPM limits AND burns prepay credits faster than the
//   user can react to a misclick.
//
// Tradeoff:
//   - The counter is in-memory and process-local. On a Vercel scale-out
//     each instance has its own counter. At single-region small-team
//     scale this is fine. If you scale horizontally and need true global
//     concurrency, swap this for a Redis-backed counter or a DB row.
//   - On process restart the counter resets - any "leaked" in-flight
//     entries are cleared. That's the correct behavior: a crashed call
//     isn't actually in flight anymore.
//
// Usage:
//   try {
//     await withClientConcurrency(clientId, async () => {
//       return generateScriptForSlot(slotId)
//     })
//   } catch (err) {
//     if (err instanceof ConcurrencyLimitError) { ...return 429... }
//   }

/** Max simultaneous AI operations per client. Bulk-campaign dispatch on
 *  the client throttles to this number so legitimate bulk work never
 *  hits the cap - the server-side check is a safety net for unexpected
 *  parallel use (multi-tab, multi-staff hammering the same client). */
export const MAX_CONCURRENT_PER_CLIENT = 4

const inFlight = new Map<string, number>()

export class ConcurrencyLimitError extends Error {
  readonly clientId: string
  readonly current: number
  readonly max: number
  constructor(clientId: string, current: number, max: number) {
    super(
      `Too many AI operations in flight for this client (${current}/${max}). Wait for one to finish before starting another.`,
    )
    this.name = 'ConcurrencyLimitError'
    this.clientId = clientId
    this.current = current
    this.max = max
  }
}

/** Wrap an async function with the per-client concurrency gate. Throws
 *  ConcurrencyLimitError synchronously if the cap is already hit (no
 *  queueing - the caller decides whether to retry or surface). */
export async function withClientConcurrency<T>(
  clientId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const current = inFlight.get(clientId) ?? 0
  if (current >= MAX_CONCURRENT_PER_CLIENT) {
    throw new ConcurrencyLimitError(clientId, current, MAX_CONCURRENT_PER_CLIENT)
  }
  inFlight.set(clientId, current + 1)
  try {
    return await fn()
  } finally {
    // Release. If the counter has somehow drifted to <= 0, clean up the
    // entry entirely so it doesn't leak with a 0 value.
    const after = (inFlight.get(clientId) ?? 1) - 1
    if (after <= 0) inFlight.delete(clientId)
    else inFlight.set(clientId, after)
  }
}

/** Current in-flight count for a client. Used by diagnostics / admin
 *  views. Returns 0 when the client has nothing in flight (the entry
 *  is deleted, not stored as 0, so iteration over the Map only shows
 *  active clients). */
export function getInFlightCount(clientId: string): number {
  return inFlight.get(clientId) ?? 0
}

/** Diagnostics: snapshot of every client with active in-flight work. */
export function getAllInFlight(): Array<{ clientId: string; count: number }> {
  return Array.from(inFlight.entries()).map(([clientId, count]) => ({ clientId, count }))
}
