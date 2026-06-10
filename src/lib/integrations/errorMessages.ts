// Turns raw provider/OAuth error strings (e.g. Google's
// `invalid_grant ... Token has been expired or revoked`) into short,
// friendly messages we can safely show users. Falls back to a generic
// "reconnect" message rather than leaking raw JSON.

type Provider = 'calendly' | 'google_meet' | 'zoom' | 'gmail_smtp'

const LABELS: Record<Provider, string> = {
  calendly: 'Calendly',
  google_meet: 'Google Calendar',
  zoom: 'Zoom',
  gmail_smtp: 'Email (Gmail)',
}

export function providerLabel(provider?: Provider | null): string {
  return provider ? LABELS[provider] : 'this integration'
}

/** Map a raw integration error to a human-friendly sentence. */
export function humanizeIntegrationError(
  raw: string | null | undefined,
  provider?: Provider | null,
): string {
  const label = providerLabel(provider)
  if (!raw) return `Something went wrong with ${label}. Try reconnecting.`

  const text = raw.toLowerCase()

  // Expired / revoked OAuth token - the most common one. Needs a reconnect.
  if (
    text.includes('invalid_grant') ||
    text.includes('expired or revoked') ||
    text.includes('token has been expired') ||
    text.includes('token refresh') ||
    text.includes('refresh failed')
  ) {
    return `Your ${label} connection expired. Click Connect to reconnect.`
  }

  // No connection at all.
  if (text.includes('not connected') || text.includes('no refresh_token')) {
    return `${label} isn't connected yet. Connect it to continue.`
  }

  // Missing OAuth scope / permission for this specific action (e.g. the
  // Zoom token can create meetings but lacks delete permission).
  if (
    text.includes('does not contain scopes') ||
    text.includes('insufficient scope') ||
    text.includes('missing scope')
  ) {
    if (provider === 'zoom') {
      return 'Zoom is missing permission to cancel meetings. Add the "meeting:delete:meeting" scope to your Zoom app, then disconnect and reconnect Zoom.'
    }
    return `${label} is missing a permission for this action. Update your ${label} app's scopes, then disconnect and reconnect.`
  }

  // Auth / permission problems.
  if (
    text.includes('unauthorized') ||
    text.includes('401') ||
    text.includes('403') ||
    text.includes('access_denied')
  ) {
    return `${label} denied access. Reconnect and approve the requested permissions.`
  }

  // Webhook setup hiccup (Calendly).
  if (text.includes('webhook')) {
    return `${label} connected, but automatic booking sync couldn't be set up. Try reconnecting.`
  }

  // Rate limit.
  if (text.includes('rate limit') || text.includes('429')) {
    return `${label} is temporarily rate-limited. Try again in a few minutes.`
  }

  // Generic fallback - never show the raw payload.
  return `Something went wrong with ${label}. Try reconnecting.`
}
