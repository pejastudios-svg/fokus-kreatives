// Token store for Zoom. Mirrors googleTokenStore but with one
// important wrinkle: Zoom ROTATES the refresh_token on every refresh
// call, so we have to persist the new refresh_token back to the DB
// after a successful refresh. Failing to do that means subsequent
// refreshes use a stale token and Zoom rejects them.

import { createClient as createServiceClient } from '@supabase/supabase-js'
import { refreshZoomAccessToken } from './zoom'

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
  metadata: { zoom_user_email?: string } | null
}

export interface ConnectedZoomIntegration {
  accessToken: string
  userId: string
  hostEmail: string | null
}

export async function getConnectedZoomIntegration(
  clientId: string,
): Promise<ConnectedZoomIntegration | null> {
  const { data: row } = await admin
    .from('user_integrations')
    .select('id, access_token, refresh_token, expires_at, user_id, metadata')
    .eq('client_id', clientId)
    .eq('provider', 'zoom')
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
      hostEmail: integration.metadata?.zoom_user_email ?? null,
    }
  }

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
    const refreshed = await refreshZoomAccessToken(integration.refresh_token)
    const newExpiresAt = new Date(
      Date.now() + (refreshed.expires_in - 60) * 1000,
    ).toISOString()
    // CRUCIAL: persist the new refresh_token. Zoom invalidates the
    // previous one after rotation - if we don't store the fresh one,
    // the next refresh call will fail.
    await admin
      .from('user_integrations')
      .update({
        access_token: refreshed.access_token,
        refresh_token: refreshed.refresh_token,
        expires_at: newExpiresAt,
        status: 'connected',
        last_error: null,
      })
      .eq('id', integration.id)
    return {
      accessToken: refreshed.access_token,
      userId: integration.user_id,
      hostEmail: integration.metadata?.zoom_user_email ?? null,
    }
  } catch (err) {
    console.error('[zoom-token] refresh failed:', err)
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
