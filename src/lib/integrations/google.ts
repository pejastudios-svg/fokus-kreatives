// Google OAuth 2.0 + Calendar API helpers.
//
// Flow:
//   1. CONNECT: redirect user to Google's consent page with our
//      client_id, calendar.events scope, and a signed state token
//      that encodes the clientId. Google redirects back to our
//      /callback with an authorization code.
//   2. CALLBACK: exchange the code for access_token + refresh_token,
//      fetch the user's email + name, store everything in
//      user_integrations.
//   3. CREATE EVENT: when a visitor submits a capture-page form that's
//      wired to Google Meet, we create a Calendar event with
//      conferenceData.createRequest. Google generates the Meet link
//      automatically and emails the attendee.
//
// Token refresh: Google access tokens expire in ~1h. We store the
// expiry; getValidAccessToken() refreshes on demand using the
// refresh_token.

import { createHmac } from 'crypto'

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo'
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3'

// We ask for calendar.events (create/modify events) plus openid+email
// so we can show the connected account in the UI. profile is optional
// but lets us display the user's name without an extra People API
// round-trip.
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'openid',
  'email',
  'profile',
].join(' ')

export interface GoogleTokens {
  access_token: string
  refresh_token?: string
  expires_in: number
  token_type: 'Bearer'
  scope: string
  id_token?: string
}

export interface GoogleUserInfo {
  sub: string
  email: string
  name?: string
  picture?: string
}

// ---------------------------------------------------------------------
// State token: encodes clientId for the OAuth round-trip so we know
// which CRM to attach the integration to on callback. Signed with
// HMAC-SHA256 using NEXT_AUTH_SECRET (or SUPABASE_SERVICE_ROLE_KEY as
// fallback) to prevent CSRF / state tampering.
// ---------------------------------------------------------------------

function stateSecret(): string {
  return (
    process.env.NEXTAUTH_SECRET ||
    process.env.NEXT_AUTH_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    ''
  )
}

export function signState(payload: { clientId: string; nonce: string }): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = createHmac('sha256', stateSecret()).update(body).digest('base64url')
  return `${body}.${sig}`
}

export function verifyState(
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

export function buildGoogleAuthUrl({
  clientId,
  redirectUri,
  state,
}: {
  clientId: string
  redirectUri: string
  state: string
}): string {
  const u = new URL(GOOGLE_AUTH_URL)
  u.searchParams.set('client_id', clientId)
  u.searchParams.set('redirect_uri', redirectUri)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('scope', GOOGLE_SCOPES)
  // access_type=offline + prompt=consent are both required to get a
  // refresh_token back. Without them Google only returns an
  // access_token that dies in 1h and we'd lose the ability to keep
  // creating events long-term.
  u.searchParams.set('access_type', 'offline')
  u.searchParams.set('prompt', 'consent')
  u.searchParams.set('include_granted_scopes', 'true')
  u.searchParams.set('state', state)
  return u.toString()
}

export async function exchangeGoogleCode({
  code,
  redirectUri,
}: {
  code: string
  redirectUri: string
}): Promise<GoogleTokens> {
  const body = new URLSearchParams({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID || '',
    client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  })
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    cache: 'no-store',
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Google token exchange failed (${res.status}): ${text || 'unknown'}`)
  }
  return (await res.json()) as GoogleTokens
}

export async function refreshGoogleAccessToken(
  refreshToken: string,
): Promise<GoogleTokens> {
  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || '',
    client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  })
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    cache: 'no-store',
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Google token refresh failed (${res.status}): ${text || 'unknown'}`)
  }
  // Note: refresh responses don't include refresh_token. The original
  // refresh_token stays valid until the user revokes access in their
  // Google account settings.
  return (await res.json()) as GoogleTokens
}

export async function fetchGoogleUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const res = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  })
  if (!res.ok) {
    throw new Error(`Google userinfo failed (${res.status})`)
  }
  return (await res.json()) as GoogleUserInfo
}

export async function revokeGoogleToken(token: string): Promise<void> {
  // Best-effort. Even if Google rejects (already revoked, network
  // hiccup) the local disconnect still proceeds so the integration
  // row gets removed.
  try {
    await fetch(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      cache: 'no-store',
    })
  } catch (err) {
    console.error('[google] revoke swallowed:', err)
  }
}

// ---------------------------------------------------------------------
// Calendar event creation
// ---------------------------------------------------------------------

export interface CreateCalendarEventInput {
  /** Access token belonging to the HOST (the user who connected the
   *  integration). The event lands on their primary calendar. */
  accessToken: string
  /** Event title shown in calendar + invite email. */
  summary: string
  /** Optional longer description. */
  description?: string
  /** ISO8601 start time. */
  startIso: string
  /** ISO8601 end time. */
  endIso: string
  /** IANA timezone, e.g. 'Africa/Lagos'. Falls back to host's primary
   *  calendar's timezone when omitted. */
  timeZone?: string
  /** Visitor's email + display name; goes into the invite list so
   *  Google emails them the calendar invite + the Meet link. */
  attendee: { email: string; displayName?: string }
}

export interface CreatedCalendarEvent {
  id: string
  htmlLink?: string
  /** The auto-generated Google Meet link from conferenceData. */
  meetUrl: string | null
  start: string
  end: string
}

/** Fetch the host's busy windows from their primary Google Calendar
 *  for a given UTC range. Used by the capture-page availability picker
 *  so slots that overlap meetings the host has on Google (but didn't
 *  book through us) are still hidden.
 *
 *  Returns an array of { startIso, endIso } busy intervals. Empty
 *  array on auth/network failure - we treat the host as fully free
 *  rather than blocking the visitor, since false-positives on busy
 *  are worse than false-negatives. */
export async function fetchGoogleFreeBusy(
  accessToken: string,
  fromIso: string,
  toIso: string,
): Promise<Array<{ startIso: string; endIso: string }>> {
  try {
    const res = await fetch(`${GOOGLE_CALENDAR_API}/freeBusy`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        timeMin: fromIso,
        timeMax: toIso,
        items: [{ id: 'primary' }],
      }),
      cache: 'no-store',
    })
    if (!res.ok) {
      console.warn('[google-freebusy] non-200:', res.status)
      return []
    }
    const json = (await res.json()) as {
      calendars?: {
        primary?: {
          busy?: Array<{ start: string; end: string }>
        }
      }
    }
    const busy = json.calendars?.primary?.busy ?? []
    return busy.map((b) => ({ startIso: b.start, endIso: b.end }))
  } catch (err) {
    console.warn('[google-freebusy] error:', err)
    return []
  }
}

/** Create a Google Calendar event on the host's primary calendar with
 *  an auto-generated Google Meet link, then return the event metadata.
 *
 *  `sendUpdates=all` tells Google to email the attendee the invite
 *  + the Meet link automatically - no separate notification step. */
export async function createGoogleCalendarEvent(
  input: CreateCalendarEventInput,
): Promise<CreatedCalendarEvent> {
  const url = new URL(`${GOOGLE_CALENDAR_API}/calendars/primary/events`)
  url.searchParams.set('conferenceDataVersion', '1') // required to create Meet links
  url.searchParams.set('sendUpdates', 'all')

  const body = {
    summary: input.summary,
    description: input.description,
    start: { dateTime: input.startIso, timeZone: input.timeZone || 'UTC' },
    end: { dateTime: input.endIso, timeZone: input.timeZone || 'UTC' },
    attendees: [
      { email: input.attendee.email, displayName: input.attendee.displayName },
    ],
    conferenceData: {
      createRequest: {
        requestId: `fk-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    },
  }

  const res = await fetch(url.toString(), {
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
    throw new Error(`Google Calendar event create failed (${res.status}): ${text || 'unknown'}`)
  }
  const json = (await res.json()) as {
    id: string
    htmlLink?: string
    hangoutLink?: string
    conferenceData?: {
      entryPoints?: Array<{ entryPointType?: string; uri?: string }>
    }
    start: { dateTime?: string }
    end: { dateTime?: string }
  }
  // Prefer hangoutLink (always present when the conference creates
  // successfully). Fall back to the video entry point if Google ever
  // changes the response shape.
  const meetUrl =
    json.hangoutLink ||
    json.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')?.uri ||
    null
  return {
    id: json.id,
    htmlLink: json.htmlLink,
    meetUrl,
    start: json.start.dateTime || input.startIso,
    end: json.end.dateTime || input.endIso,
  }
}
