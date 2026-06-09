// Zoom OAuth 2.0 + Create Meeting API.
//
// Same shape as the Google integration: redirect to consent, exchange
// code for tokens, store + refresh, then POST /users/me/meetings on
// submit to provision a Zoom meeting.
//
// Differences from Google to be aware of:
//   - Token endpoint requires HTTP Basic auth with client_id:secret
//     (not form-encoded credentials).
//   - access_token expires in 1h, refresh_token in 90 days. We
//     refresh both on expiry; Zoom returns a NEW refresh_token each
//     time you refresh (unlike Google), so the token store has to
//     persist both fields back.
//   - No built-in attendee email-the-invite from the API. The
//     visitor's invite is sent by our existing capture-submit
//     notification path (see api/capture/submit).

import { createHmac } from 'crypto'

const ZOOM_AUTH_URL = 'https://zoom.us/oauth/authorize'
const ZOOM_TOKEN_URL = 'https://zoom.us/oauth/token'
const ZOOM_USER_URL = 'https://api.zoom.us/v2/users/me'
const ZOOM_API_BASE = 'https://api.zoom.us/v2'

export interface ZoomTokens {
  access_token: string
  refresh_token: string
  expires_in: number
  token_type: 'bearer'
  scope: string
}

export interface ZoomUser {
  id: string
  email: string
  first_name?: string
  last_name?: string
  account_id?: string
  type?: number
}

// ---------------------------------------------------------------------
// State signing - same primitives as the Google integration. Single
// shared secret so we don't have to re-derive per provider.
// ---------------------------------------------------------------------

function stateSecret(): string {
  return (
    process.env.NEXTAUTH_SECRET ||
    process.env.NEXT_AUTH_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    ''
  )
}

export function signZoomState(payload: { clientId: string; nonce: string }): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = createHmac('sha256', stateSecret()).update(body).digest('base64url')
  return `${body}.${sig}`
}

export function verifyZoomState(
  state: string,
): { clientId: string; nonce: string } | null {
  const [body, sig] = state.split('.')
  if (!body || !sig) return null
  const expected = createHmac('sha256', stateSecret()).update(body).digest('base64url')
  if (expected !== sig) return null
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8'))
    if (typeof parsed?.clientId !== 'string' || typeof parsed?.nonce !== 'string') {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------

export function buildZoomAuthUrl({
  clientId,
  redirectUri,
  state,
}: {
  clientId: string
  redirectUri: string
  state: string
}): string {
  const u = new URL(ZOOM_AUTH_URL)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('client_id', clientId)
  u.searchParams.set('redirect_uri', redirectUri)
  u.searchParams.set('state', state)
  return u.toString()
}

function basicAuthHeader(): string {
  const id = process.env.ZOOM_CLIENT_ID || ''
  const secret = process.env.ZOOM_CLIENT_SECRET || ''
  return 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64')
}

export async function exchangeZoomCode({
  code,
  redirectUri,
}: {
  code: string
  redirectUri: string
}): Promise<ZoomTokens> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  })
  const res = await fetch(ZOOM_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
    cache: 'no-store',
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Zoom token exchange failed (${res.status}): ${text || 'unknown'}`)
  }
  return (await res.json()) as ZoomTokens
}

export async function refreshZoomAccessToken(
  refreshToken: string,
): Promise<ZoomTokens> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  })
  const res = await fetch(ZOOM_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
    cache: 'no-store',
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Zoom token refresh failed (${res.status}): ${text || 'unknown'}`)
  }
  // Zoom rotates the refresh_token on every refresh - the response
  // includes a NEW refresh_token that supersedes the old one. The
  // token store handles persisting both back.
  return (await res.json()) as ZoomTokens
}

export async function fetchZoomUser(accessToken: string): Promise<ZoomUser> {
  const res = await fetch(ZOOM_USER_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  })
  if (!res.ok) {
    throw new Error(`Zoom userinfo failed (${res.status})`)
  }
  return (await res.json()) as ZoomUser
}

// ---------------------------------------------------------------------
// Create meeting
// ---------------------------------------------------------------------

export interface CreateZoomMeetingInput {
  accessToken: string
  topic: string
  agenda?: string
  startIso: string
  durationMinutes: number
  timeZone?: string
  /** Optional invitee emails (manual CRM creation). Added to the Zoom
   *  meeting's invitee list. Note Zoom only emails them automatically
   *  when the host's account has registration enabled. */
  attendees?: string[]
}

export interface CreatedZoomMeeting {
  id: number
  /** Public URL the invitee uses to join. */
  joinUrl: string
  /** Host-only URL (do not share with invitee). */
  startUrl: string
  password?: string
}

/** Create a scheduled Zoom meeting on the host's account. We only
 *  need joinUrl in our meetings table - the visitor gets it via our
 *  capture-submit notification email. start_url stays with the host
 *  (it's a host-only join link). */
export async function createZoomMeeting(
  input: CreateZoomMeetingInput,
): Promise<CreatedZoomMeeting> {
  const body = {
    topic: input.topic,
    type: 2, // scheduled meeting
    start_time: input.startIso,
    duration: input.durationMinutes,
    timezone: input.timeZone || 'UTC',
    agenda: input.agenda,
    settings: {
      // Lets the invitee join before the host clicks Start. Better
      // visitor UX than the default ("waiting for host").
      join_before_host: true,
      waiting_room: false,
      // Auto-record off; hosts can flip it on per meeting.
      auto_recording: 'none',
      ...(input.attendees?.length
        ? { meeting_invitees: input.attendees.map((email) => ({ email })) }
        : {}),
    },
  }
  const res = await fetch(`${ZOOM_API_BASE}/users/me/meetings`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Zoom meeting create failed (${res.status}): ${text || 'unknown'}`)
  }
  const json = (await res.json()) as {
    id: number
    join_url: string
    start_url: string
    password?: string
  }
  return {
    id: json.id,
    joinUrl: json.join_url,
    startUrl: json.start_url,
    password: json.password,
  }
}

/** Delete (cancel) a scheduled Zoom meeting on the host's account.
 *  `schedule_for_reminder=true` tells Zoom to email registrants that
 *  the meeting was cancelled. A 404 means the meeting is already gone,
 *  which we treat as success. `meetingId` is the numeric Zoom meeting
 *  id we stored as external_id (passed as a string). */
export async function cancelZoomMeeting(
  accessToken: string,
  meetingId: string,
): Promise<void> {
  const url = new URL(`${ZOOM_API_BASE}/meetings/${encodeURIComponent(meetingId)}`)
  url.searchParams.set('schedule_for_reminder', 'true')
  const res = await fetch(url.toString(), {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  })
  if (!res.ok && res.status !== 404) {
    const text = await res.text().catch(() => '')
    throw new Error(`Zoom meeting delete failed (${res.status}): ${text || 'unknown'}`)
  }
}

/** Reschedule a scheduled Zoom meeting: PATCH its start_time + duration.
 *  The join link/id stay the same. Zoom notifies registrants per the
 *  meeting's own settings; our app also emails the attendee separately.
 *  204 = success; 404 = meeting already gone (soft no-op). */
export async function updateZoomMeeting(
  accessToken: string,
  meetingId: string,
  startIso: string,
  durationMinutes: number,
  timeZone = 'UTC',
): Promise<void> {
  const url = new URL(`${ZOOM_API_BASE}/meetings/${encodeURIComponent(meetingId)}`)
  const res = await fetch(url.toString(), {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ start_time: startIso, duration: durationMinutes, timezone: timeZone }),
    cache: 'no-store',
  })
  if (res.status === 404) {
    console.warn(`[zoom] meeting ${meetingId} not found - not rescheduled`)
    return
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Zoom meeting update failed (${res.status}): ${text || 'unknown'}`)
  }
}
