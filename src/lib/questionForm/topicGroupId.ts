// Browser-safe twin of the server's topicGroupIdFor (see
// src/app/api/question-form/submit/route.ts). A topic's answers are stored in
// the `topics` table under a topic_group_id that is a deterministic UUID
// derived from SHA-256(`${formId}:${topicId}`). To scope answers back to one
// question form on the client (e.g. the Prompts page lead-magnet source), we
// recompute those ids here with Web Crypto.
//
// IMPORTANT: this MUST stay byte-for-byte identical to the server version, or
// scoping silently returns nothing. The formula is frozen (changing it would
// also break answer revisits), so it should never need to.
export async function topicGroupIdFor(formId: string, topicId: string): Promise<string> {
  const data = new TextEncoder().encode(`${formId}:${topicId}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  const h = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}
