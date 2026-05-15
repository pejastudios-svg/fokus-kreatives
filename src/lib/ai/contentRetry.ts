// Content-level retry wrapper.
//
// Provider-level retries (network 503s, transient 429s, ECONNRESET, etc.)
// already happen inside src/lib/ai/provider.ts - 5 attempts with backoff,
// daily-quota fallback, Groq → Gemini fallback. Those failures are NOT
// what this wrapper is for.
//
// CONTENT failures are different: the API call returns 200 OK but the
// content is unusable. Examples:
//   - JSON parse fails (truncated mid-string, schema-violating)
//   - JSON parses but a required field is missing
//   - Output is shorter / longer than expected
//   - Output contains a hard-banned phrase the prompt told it to avoid
//
// In those cases the AI just had a bad token roll. A single immediate retry
// (no backoff - it's not a network issue) usually produces a clean output.
//
// Usage:
//   const { script, checklist } = await withContentRetry(
//     'planner.script',
//     async () => {
//       const raw = await generateScript({...})
//       return parseAndValidate(raw.content)  // throws ContentRetryError
//     },
//     { maxAttempts: 2 },
//   )

export class ContentRetryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ContentRetryError'
  }
}

export interface ContentRetryOptions {
  /** Max attempts including the first one. Default 2 (one retry). */
  maxAttempts?: number
}

/**
 * Run an async generation+validation block with content-level retry. The
 * block must throw a `ContentRetryError` (or any error) to trigger a retry.
 * If every attempt fails, the LAST error is rethrown so the caller can
 * decide whether to fall back, surface, or skip.
 *
 * Logs each attempt with a route tag so we can spot patterns in production
 * (e.g. "story_brief routinely needs 2 attempts" → tighten the prompt).
 */
export async function withContentRetry<T>(
  route: string,
  fn: (attempt: number) => Promise<T>,
  options: ContentRetryOptions = {},
): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 2)
  let lastErr: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await fn(attempt)
      if (attempt > 1) {
        console.log(`[content-retry] ${route} succeeded on attempt ${attempt}/${maxAttempts}`)
      }
      return result
    } catch (err) {
      lastErr = err
      const msg = err instanceof Error ? err.message : String(err)
      const willRetry = attempt < maxAttempts
      console.warn(
        `[content-retry] ${route} attempt ${attempt}/${maxAttempts} failed: ${msg}${willRetry ? ' - retrying' : ' - giving up'}`,
      )
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new ContentRetryError(`Content generation failed after ${maxAttempts} attempts`)
}
