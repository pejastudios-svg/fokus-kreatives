import { cookies } from 'next/headers'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import crypto from 'crypto'

export const reviewAdmin = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// 30 days — long enough that a returning client doesn't need to re-enter
// their email on every visit. Cookie is HttpOnly so it can't be exfiltrated
// from JS, and the row in `review_sessions` is the source of truth (we can
// expire it server-side at any time).
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Cookie name for a verified review session. Scoped per-approval so a user
 * can hold sessions for multiple approvals at once without collisions.
 */
export function reviewCookieName(approvalId: string): string {
  return `fk_review_${approvalId}`
}

export function generateOtp(): string {
  // 6-digit numeric. Pad with leading zeros to keep length consistent.
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
}

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('base64url')
}

/**
 * Find the approval by share_token. Returns the approval row + its client name.
 */
export async function loadApprovalByShareToken(token: string) {
  if (!token) return null
  const { data, error } = await reviewAdmin
    .from('approvals')
    .select('id, client_id, title, description, status, share_token, clients(name, business_name, profile_picture_url)')
    .eq('share_token', token)
    .maybeSingle()
  if (error) {
    console.error('loadApprovalByShareToken error:', error)
    return null
  }
  return data
}

/**
 * Anyone added to the approval's client (via clients.email or as a client-role
 * user with users.client_id) is allowed to start a review session for that
 * approval. We check both because the client identity can come from either
 * place depending on how the client was set up.
 */
export async function isEmailAllowedForApproval(
  approvalId: string,
  email: string,
): Promise<boolean> {
  const normalised = email.trim().toLowerCase()
  if (!normalised) return false

  // Read approval → client.
  const { data: approval } = await reviewAdmin
    .from('approvals')
    .select('client_id')
    .eq('id', approvalId)
    .maybeSingle()
  if (!approval) return false

  // Direct match on `clients.email`.
  const { data: client } = await reviewAdmin
    .from('clients')
    .select('email')
    .eq('id', approval.client_id)
    .maybeSingle()
  if (client?.email && client.email.trim().toLowerCase() === normalised) return true

  // Match on `users` rows that are client-role users for this client.
  const { data: clientUsers } = await reviewAdmin
    .from('users')
    .select('email')
    .eq('client_id', approval.client_id)
    .eq('role', 'client')
  for (const u of clientUsers || []) {
    if ((u.email || '').trim().toLowerCase() === normalised) return true
  }
  return false
}

/**
 * Validate the cookie sent with the request. Returns the matched session
 * row (with email + approval_id) or null.
 */
export async function readReviewSessionFromRequest(
  approvalId: string,
): Promise<null | { id: string; email: string; approval_id: string }> {
  try {
    const jar = await cookies()
    const cookie = jar.get(reviewCookieName(approvalId))
    if (!cookie?.value) return null
    const { data, error } = await reviewAdmin
      .from('review_sessions')
      .select('id, email, approval_id, session_expires_at, verified_at')
      .eq('session_token', cookie.value)
      .eq('approval_id', approvalId)
      .maybeSingle()
    if (error || !data) return null
    if (!data.verified_at) return null
    if (data.session_expires_at && new Date(data.session_expires_at) < new Date()) return null
    return { id: data.id as string, email: data.email as string, approval_id: data.approval_id as string }
  } catch (err) {
    console.error('readReviewSessionFromRequest error:', err)
    return null
  }
}
