// Maps raw AI failure signals to humanized reasons shown in the admin
// activity feed. The point is to keep the surface label clean - the
// admin reads "AI output failed validation after retries" instead of a
// 400-character stack trace. The full raw error stays in meta so ops
// can open the event drawer and see the original message.
//
// Match order matters: more specific keywords win over generic ones.
// We check error_code first (set by the call site - structured), then
// fall back to a substring scan over the raw error message.

export interface HumanizedFailure {
  reason: string
  category:
    | 'validation'
    | 'rate_limit'
    | 'concurrency'
    | 'lock'
    | 'banned_output'
    | 'timeout'
    | 'unknown'
}

const ERROR_CODE_MAP: Record<string, HumanizedFailure> = {
  ContentRetryError: {
    reason: 'AI output failed validation after retries',
    category: 'validation',
  },
  GenerationLockedError: {
    reason: 'Slot was already being generated',
    category: 'lock',
  },
  ConcurrencyLimitError: {
    reason: 'Too many AI calls in flight for this client',
    category: 'concurrency',
  },
  // Below are codes the call site emits via the error_code column.
  rate_limit: {
    reason: 'Hit AI provider rate limit - retry shortly',
    category: 'rate_limit',
  },
  quota_exceeded: {
    reason: 'AI provider daily quota exhausted',
    category: 'rate_limit',
  },
  hard_ban: {
    reason: 'Output contained banned phrasing',
    category: 'banned_output',
  },
  validation_failed: {
    reason: 'Script structure check failed (length / CTA / sections)',
    category: 'validation',
  },
  fabrication_detected: {
    reason: 'Output contained content not in the brief',
    category: 'validation',
  },
  timeout: {
    reason: 'Network timeout reaching AI provider',
    category: 'timeout',
  },
}

const MESSAGE_KEYWORDS: Array<{ match: RegExp; result: HumanizedFailure }> = [
  // Most specific first.
  { match: /already being generated/i, result: { reason: 'Slot was already being generated', category: 'lock' } },
  { match: /in flight for this client/i, result: { reason: 'Too many AI calls in flight for this client', category: 'concurrency' } },
  { match: /banned phrasing|hard.?ban/i, result: { reason: 'Output contained banned phrasing', category: 'banned_output' } },
  { match: /fabricat/i, result: { reason: 'Output contained content not in the brief', category: 'validation' } },
  { match: /quota|exceeded|resource_exhausted/i, result: { reason: 'AI provider daily quota exhausted', category: 'rate_limit' } },
  { match: /rate.?limit|429|tokens per minute|tpm\b/i, result: { reason: 'Hit AI provider rate limit - retry shortly', category: 'rate_limit' } },
  { match: /timeout|ETIMEDOUT|ECONNRESET|ENOTFOUND/i, result: { reason: 'Network timeout reaching AI provider', category: 'timeout' } },
  { match: /validation|invalid script|missing section|word.?count/i, result: { reason: 'Script structure check failed (length / CTA / sections)', category: 'validation' } },
  { match: /failed after \d+ attempts|content.?retry/i, result: { reason: 'AI output failed validation after retries', category: 'validation' } },
]

/** Resolve a humanized reason from either an error_code string, a raw
 *  error message, or both. Returns 'unknown' if neither matches. */
export function humanizeFailure(input: {
  errorCode?: string | null
  message?: string | null
}): HumanizedFailure {
  const code = (input.errorCode ?? '').trim()
  if (code && ERROR_CODE_MAP[code]) return ERROR_CODE_MAP[code]

  const msg = (input.message ?? '').trim()
  if (msg) {
    for (const { match, result } of MESSAGE_KEYWORDS) {
      if (match.test(msg)) return result
    }
  }

  return {
    reason: 'Unexpected error - see raw log',
    category: 'unknown',
  }
}
