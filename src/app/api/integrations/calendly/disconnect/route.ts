// POST /api/integrations/calendly/disconnect
//
// Body: { clientId: string }
//
// Removes the Calendly connection: deletes the webhook on Calendly's
// side (best-effort - errors are logged but don't block) and removes
// the row from user_integrations. Capture pages with
// meeting_integration='calendly' fall back to the manual date/time
// picker until the user picks a different integration.

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { deleteCalendlyWebhook } from '@/lib/integrations/calendly'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const admin = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

interface IntegrationRow {
  access_token: string | null
  metadata: { webhook_uri?: string } | null
}

export async function POST(req: NextRequest) {
  try {
    const { clientId } = (await req.json()) as { clientId?: string }
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
      .maybeSingle()

    const integration = row as IntegrationRow | null
    if (integration?.access_token && integration?.metadata?.webhook_uri) {
      await deleteCalendlyWebhook(
        integration.access_token,
        integration.metadata.webhook_uri,
      )
    }

    const { error } = await admin
      .from('user_integrations')
      .delete()
      .eq('client_id', clientId)
      .eq('provider', 'calendly')

    if (error) {
      console.error('[calendly/disconnect] delete error:', error)
      return NextResponse.json(
        { success: false, error: 'Could not remove connection' },
        { status: 500 },
      )
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[calendly/disconnect] error:', err)
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Server error' },
      { status: 500 },
    )
  }
}
