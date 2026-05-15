// Loads the connected Google integration for a CRM and returns a
// usable access_token. If the stored token is within 60s of expiring
// (or already expired), we refresh it via the stored refresh_token
// and persist the new access_token + expiry back to the DB.
//
// Separate file from google.ts so the pure OAuth helpers stay free
// of Supabase imports - keeps unit-testability + dependency direction
// clean.

import { createClient as createServiceClient } from '@supabase/supabase-js'
import { refreshGoogleAccessToken } from './google'

const admin = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

interface IntegrationRow {
  id: string
  access_token: string | null
  refresh_token: string | null
  expires_at: string | null
  user_id: string
  metadata: { google_user_email?: string } | null
}

export interface ConnectedGoogleIntegration {
  accessToken: string
  userId: string
  hostEmail: string | null
}

/** Returns the connected Google integration for a CRM with a fresh
 *  access token, refreshing on demand. Returns null when no
 *  connection exists or the refresh failed (we mark status='error'
 *  in that case so the UI can prompt for reconnect). */
export async function getConnectedGoogleIntegration(
  clientId: string,
): Promise<ConnectedGoogleIntegration | null> {
  const { data: row } = await admin
    .from('user_integrations')
    .select('id, access_token, refresh_token, expires_at, user_id, metadata')
    .eq('client_id', clientId)
    .eq('provider', 'google_meet')
    .eq('status', 'connected')
    .maybeSingle()

  const integration = row as IntegrationRow | null
  if (!integration?.access_token) return null

  const expiresAt = integration.expires_at ? Date.parse(integration.expires_at) : 0
  const expiresSoon = !expiresAt || expiresAt - Date.now() < 60_000

  if (!expiresSoon) {
    return {
      accessToken: integration.access_token,
      userId: integration.user_id,
      hostEmail: integration.metadata?.google_user_email ?? null,
    }
  }

  // Refresh on demand. If we don't have a refresh_token (shouldn't
  // happen given access_type=offline at connect time, but defensive)
  // there's nothing we can do - mark error and let the user reconnect.
  if (!integration.refresh_token) {
    await admin
      .from('user_integrations')
      .update({
        status: 'error',
        last_error: 'Access token expired and no refresh_token available',
      })
      .eq('id', integration.id)
    return null
  }

  try {
    const refreshed = await refreshGoogleAccessToken(integration.refresh_token)
    const newExpiresAt = new Date(
      Date.now() + (refreshed.expires_in - 60) * 1000,
    ).toISOString()
    await admin
      .from('user_integrations')
      .update({
        access_token: refreshed.access_token,
        expires_at: newExpiresAt,
        status: 'connected',
        last_error: null,
      })
      .eq('id', integration.id)
    return {
      accessToken: refreshed.access_token,
      userId: integration.user_id,
      hostEmail: integration.metadata?.google_user_email ?? null,
    }
  } catch (err) {
    console.error('[google-token] refresh failed:', err)
    await admin
      .from('user_integrations')
      .update({
        status: 'error',
        last_error: err instanceof Error ? err.message : 'Token refresh failed',
      })
      .eq('id', integration.id)
    return null
  }
}
