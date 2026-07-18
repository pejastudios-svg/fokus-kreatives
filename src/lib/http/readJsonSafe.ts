// Parse a fetch Response as JSON, translating platform-level failures into
// a readable message instead of leaking a raw parse error to the UI.
//
// When a serverless function times out or crashes, the platform returns a
// plain-text/HTML error page ("An error occurred with your deployment...").
// Calling res.json() on that throws:
//   Unexpected token 'A', "An error o"... is not valid JSON
// and every `setError(e.message)` in the app printed that raw to users.
// Route ALL client-side response parsing through this helper.
//
// Client-safe: no server imports.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readJsonSafe(res: Response): Promise<any> {
  try {
    const parsed = res.json()
    return await parsed
  } catch {
    throw new Error(
      res.ok
        ? 'The server returned an unreadable response. Try again.'
        : `The server did not complete the request (status ${res.status}). It likely timed out or hit an upstream outage - try again in a minute.`,
    )
  }
}
