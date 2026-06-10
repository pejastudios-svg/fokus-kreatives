// GET /api/integrations/list?clientId=...
//
// Returns the integrations connected to this CRM. Used by the
// settings UI to show connect/disconnect state for each provider.
//
// We strip the raw access_token and refresh_token from the response -
// the UI only needs to know that a connection exists and the public
// metadata (Calendly email, scheduling URL, etc.).

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const admin = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

interface IntegrationRow {
  provider: 'calendly' | 'google_meet' | 'zoom' | 'gmail_smtp'
  status: string
  last_error: string | null
  metadata: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const clientId = searchParams.get('clientId')
  if (!clientId) {
    return NextResponse.json(
      { success: false, error: 'Missing clientId' },
      { status: 400 },
    )
  }

  const { authorizeForClient } = await import('@/lib/crm/teamAuth')
  const auth = await authorizeForClient(clientId, { level: 'manager' })
  if (!auth.ok) {
    return NextResponse.json(
      { success: false, error: auth.error },
      { status: auth.status },
    )
  }

  const { data, error } = await admin
    .from('user_integrations')
    .select('provider, status, last_error, metadata, created_at, updated_at')
    .eq('client_id', clientId)

  if (error) {
    console.error('[integrations/list] error:', error)
    return NextResponse.json(
      { success: false, error: 'Could not list integrations' },
      { status: 500 },
    )
  }

  // Drop anything sensitive from metadata before returning. We only
  // ship the display-safe bits (email, name, scheduling URL) to the
  // client. Signing keys and webhook URIs stay server-side. We DO
  // surface webhook_registered so the UI can warn users on free-tier
  // Calendly that bookings won't auto-log.
  const integrations = ((data ?? []) as IntegrationRow[]).map((row) => {
    const meta = row.metadata ?? {}
    const m = meta as {
      calendly_user_email?: string
      calendly_user_name?: string
      scheduling_url?: string
      webhook_registered?: boolean
      google_user_email?: string
      google_user_name?: string
      zoom_user_email?: string
      zoom_user_name?: string
      gmail_address?: string
    }
    // Pick the display strings out of the provider-specific metadata
    // shape. Each provider stores its own fields (Calendly puts
    // calendly_user_email, Google puts google_user_email, etc.) -
    // we collapse them to a single `display` so the UI doesn't need
    // to branch.
    const email =
      m.calendly_user_email || m.google_user_email || m.zoom_user_email || m.gmail_address || null
    const name =
      m.calendly_user_name || m.google_user_name || m.zoom_user_name || null
    return {
      provider: row.provider,
      status: row.status,
      last_error: row.last_error,
      created_at: row.created_at,
      updated_at: row.updated_at,
      webhook_registered: m.webhook_registered !== false,
      display: {
        email,
        name,
        scheduling_url: m.scheduling_url || null,
      },
    }
  })

  return NextResponse.json({ success: true, integrations })
}
