// POST /api/integrations/zoom/disconnect
//
// Removes the Zoom integration row. Zoom doesn't have a meaningful
// token revoke endpoint that's worth calling from server-side (it's
// possible via /oauth/revoke but requires Basic auth + isn't a hard
// requirement - the user can revoke from their Zoom account if
// they want a hard cutoff). We just delete locally.

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const admin = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

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

    const { error } = await admin
      .from('user_integrations')
      .delete()
      .eq('client_id', clientId)
      .eq('provider', 'zoom')

    if (error) {
      console.error('[zoom/disconnect] delete error:', error)
      return NextResponse.json(
        { success: false, error: 'Could not remove connection' },
        { status: 500 },
      )
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[zoom/disconnect] error:', err)
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Server error' },
      { status: 500 },
    )
  }
}
