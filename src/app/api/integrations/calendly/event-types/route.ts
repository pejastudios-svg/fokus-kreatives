// GET /api/integrations/calendly/event-types?clientId=...
//
// Returns the active Calendly event types belonging to the CRM's
// connected Calendly account. Used by the capture page editor so each
// page can embed a SPECIFIC event type (e.g. "Onboarding Call") and
// skip the host-page selector step.
//
// The PAT is held server-side - we proxy the request so the token
// never leaves the server.

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { listCalendlyEventTypes } from '@/lib/integrations/calendly'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const admin = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

interface IntegrationRow {
  access_token: string | null
  metadata: { calendly_user_uri?: string } | null
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

  const { data: row } = await admin
    .from('user_integrations')
    .select('access_token, metadata')
    .eq('client_id', clientId)
    .eq('provider', 'calendly')
    .eq('status', 'connected')
    .maybeSingle()

  const integration = row as IntegrationRow | null
  if (!integration?.access_token || !integration?.metadata?.calendly_user_uri) {
    return NextResponse.json(
      { success: false, error: 'Calendly not connected' },
      { status: 404 },
    )
  }

  try {
    const eventTypes = await listCalendlyEventTypes(
      integration.access_token,
      integration.metadata.calendly_user_uri,
    )
    // Strip down to the fields the editor actually needs.
    const eventTypesPublic = eventTypes.map((e) => ({
      uri: e.uri,
      name: e.name,
      slug: e.slug,
      scheduling_url: e.scheduling_url,
      duration: e.duration,
      color: e.color,
    }))
    return NextResponse.json({ success: true, eventTypes: eventTypesPublic })
  } catch (err) {
    console.error('[calendly/event-types] fetch error:', err)
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : 'Could not fetch event types',
      },
      { status: 502 },
    )
  }
}
