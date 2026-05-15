// Default SWR fetcher. All `useSWR('/api/...')` calls in the app go
// through this unless they explicitly pass their own fetcher.
//
// Behaviour:
//   - JSON-decodes every response.
//   - Throws on non-2xx so SWR's `error` state catches it (uniform
//     handling everywhere).
//   - Treats `cache: 'no-store'` as default since pages already
//     opt-in to SWR's own cache layer; the browser HTTP cache would
//     just add an extra round of conditional GETs.

export class FetchError extends Error {
  status: number
  info: unknown
  constructor(message: string, status: number, info: unknown) {
    super(message)
    this.name = 'FetchError'
    this.status = status
    this.info = info
  }
}

export async function fetcher<T = unknown>(input: string | URL | Request, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    cache: 'no-store',
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    // Non-JSON response - body stays null. Most of the app's API
    // routes return JSON; if one doesn't, SWR users can pass their
    // own fetcher.
  }
  if (!res.ok) {
    const message =
      (body && typeof body === 'object' && 'error' in body && typeof (body as { error: unknown }).error === 'string'
        ? (body as { error: string }).error
        : null)
      ?? `Request failed (${res.status})`
    throw new FetchError(message, res.status, body)
  }
  return body as T
}
