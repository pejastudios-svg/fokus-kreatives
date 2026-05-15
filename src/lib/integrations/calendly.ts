// Calendly API client + webhook signature verification.
//
// Two flows:
//   1. CONNECT: user pastes a Personal Access Token (PAT). We hit
//      /users/me to verify + grab their `current_organization` URI,
//      then create a webhook subscription pointed at our endpoint.
//      Both the PAT and the webhook signing key get stored in
//      user_integrations.
//   2. WEBHOOK: Calendly POSTs `invitee.created` to our endpoint
//      when someone books. We verify the signature, then insert into
//      our meetings table with attendee details + the join URL.
//
// Calendly's auth model is simple compared to OAuth - a PAT is a
// long-lived token that doesn't expire. No refresh logic needed.

const CALENDLY_API_BASE = 'https://api.calendly.com'

export interface CalendlyUser {
  /** Full Calendly URI, e.g. https://api.calendly.com/users/<uuid> */
  uri: string
  name: string
  email: string
  /** The organization the user belongs to. Webhooks scope to this. */
  current_organization: string
  /** User's public booking URL, e.g. https://calendly.com/<slug> */
  scheduling_url: string
}

export interface CalendlyWebhookSubscription {
  uri: string
  callback_url: string
  signing_key: string
}

/** Verify a Personal Access Token by fetching /users/me. Returns the
 *  user profile on success; throws on auth / network failure. */
export async function verifyCalendlyToken(token: string): Promise<CalendlyUser> {
  const res = await fetch(`${CALENDLY_API_BASE}/users/me`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Calendly token verification failed (${res.status}): ${body || 'unknown error'}`)
  }
  const json = (await res.json()) as { resource: CalendlyUser }
  return json.resource
}

/** Create a webhook subscription on Calendly's side for invitee.created
 *  events. Returns the subscription details including the signing_key
 *  we use to verify incoming webhook payloads. */
export async function createCalendlyWebhook(
  token: string,
  user: CalendlyUser,
  callbackUrl: string,
): Promise<CalendlyWebhookSubscription> {
  const res = await fetch(`${CALENDLY_API_BASE}/webhook_subscriptions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: callbackUrl,
      events: ['invitee.created', 'invitee.canceled'],
      organization: user.current_organization,
      user: user.uri,
      scope: 'user',
    }),
    cache: 'no-store',
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Calendly webhook subscription failed (${res.status}): ${body || 'unknown error'}`)
  }
  const json = (await res.json()) as { resource: CalendlyWebhookSubscription }
  return json.resource
}

/** Map Calendly's `scheduled_event.location.type` to our meetings
 *  table's location_type column. Calendly's enum is richer than ours
 *  (it includes phone calls + in-person), so anything that isn't a
 *  known video conference falls back to 'custom'. The location_url
 *  still gets stored either way, so users can click through.
 *
 *  Calendly types seen in the wild:
 *    physical, inbound_call, outbound_call, google_conference,
 *    zoom_conference, gotomeeting_conference, webex_conference,
 *    microsoft_teams_conference, custom, ask_invitee */
export function mapCalendlyLocationType(
  calendlyType: string | null | undefined,
): 'zoom' | 'google_meet' | 'custom' {
  switch (calendlyType) {
    case 'zoom_conference':
      return 'zoom'
    case 'google_conference':
      return 'google_meet'
    default:
      return 'custom'
  }
}

export interface CalendlyEventType {
  uri: string
  name: string
  slug: string
  /** Public booking URL for THIS event type, e.g.
   *  https://calendly.com/<user>/<event-slug>. Linking to this skips
   *  the "pick an event type" step in the embed. */
  scheduling_url: string
  duration: number
  color: string
  active: boolean
}

/** List the active event types belonging to a Calendly user. The
 *  capture-page editor uses this so each page can embed a specific
 *  event type's scheduler (e.g. "Onboarding Call") instead of the
 *  user's main page which lists every event type. */
export async function listCalendlyEventTypes(
  token: string,
  userUri: string,
): Promise<CalendlyEventType[]> {
  const url = new URL(`${CALENDLY_API_BASE}/event_types`)
  url.searchParams.set('user', userUri)
  url.searchParams.set('active', 'true')
  url.searchParams.set('count', '100')
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Calendly event types fetch failed (${res.status}): ${body || 'unknown'}`)
  }
  const json = (await res.json()) as { collection: CalendlyEventType[] }
  return json.collection ?? []
}

/** Delete a webhook subscription. Best-effort - swallows errors so
 *  disconnecting locally still works if Calendly rejects the call
 *  (e.g. token already revoked). */
export async function deleteCalendlyWebhook(
  token: string,
  subscriptionUri: string,
): Promise<void> {
  try {
    await fetch(subscriptionUri, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
  } catch (err) {
    console.error('[calendly] deleteWebhook swallowed:', err)
  }
}

/** Verify the `Calendly-Webhook-Signature` header against the request
 *  body using the signing key Calendly returned at subscription time.
 *
 *  Calendly's signature header format:
 *    t=<unix_seconds>,v1=<hex_hmac_sha256>
 *
 *  HMAC input is `<t>.<rawBody>`. Returns true when v1 matches. */
export async function verifyCalendlySignature(
  rawBody: string,
  signatureHeader: string | null,
  signingKey: string,
): Promise<boolean> {
  if (!signatureHeader || !signingKey) return false
  const parts = signatureHeader.split(',').reduce<Record<string, string>>((acc, p) => {
    const [k, v] = p.split('=')
    if (k && v) acc[k.trim()] = v.trim()
    return acc
  }, {})
  const t = parts.t
  const v1 = parts.v1
  if (!t || !v1) return false

  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(signingKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(`${t}.${rawBody}`))
  const hex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return hex === v1
}

// Calendly webhook payload shapes (the bits we care about - the full
// schema is much wider). Documented at
// https://developer.calendly.com/api-docs/24a1f2b13ee23-invitee-created
export interface CalendlyInviteeCreatedPayload {
  event: 'invitee.created' | 'invitee.canceled'
  created_at: string
  payload: {
    /** Invitee URI. */
    uri: string
    /** The booked scheduled event - separate resource. */
    scheduled_event: {
      uri: string
      name: string
      start_time: string
      end_time: string
      location?: {
        type: string
        join_url?: string
        location?: string
      }
    }
    name: string
    email: string
    status: 'active' | 'canceled'
    cancellation?: { reason?: string }
  }
}
