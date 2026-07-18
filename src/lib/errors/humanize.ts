// Map raw upstream failures (Gemini JSON blobs, network errors, parse
// failures) to messages a user can act on. API routes that feed UI error
// banners run their catch-all through this so raw payloads like
// '{"error":{"code":503,"message":"This model is currently..."}}' never
// render in the interface. App-authored messages (short, human) pass
// through untouched.

export function humanizeUpstreamError(raw: unknown): string {
  const msg = raw instanceof Error ? raw.message : String(raw ?? '')

  if (/503|UNAVAILABLE|high demand|overloaded/i.test(msg)) {
    return 'The AI provider is overloaded right now. Wait a few minutes and try again.'
  }
  if (/RESOURCE_EXHAUSTED|quota/i.test(msg)) {
    return 'The AI provider hit its usage limit. Wait a while and try again.'
  }
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|fetch failed/i.test(msg)) {
    return 'Could not reach the AI provider. Check the connection and try again.'
  }
  if (/API key|PERMISSION_DENIED|401|403/i.test(msg)) {
    return 'The AI provider rejected the request. Check the API key configuration.'
  }
  if (/not valid JSON|Unexpected token|no script field|returned empty|unparseable/i.test(msg)) {
    return 'The AI returned an unusable draft. Try again - one retry usually fixes it.'
  }
  // Anything blob-like or oversized is not a message we wrote for users.
  if (msg.trim().startsWith('{') || msg.trim().startsWith('<') || msg.length > 220) {
    return 'Something went wrong upstream. Try again in a minute.'
  }
  return msg || 'Something went wrong. Try again.'
}
