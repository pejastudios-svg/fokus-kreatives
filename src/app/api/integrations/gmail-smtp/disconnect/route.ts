// POST /api/integrations/gmail-smtp/disconnect
//
// Body: { clientId: string }
//
// Deletes our encrypted copy of the app password. There is NO remote-revoke
// API for Gmail app passwords, so the UI also tells the client to delete the
// app password in their Google account. Outward emails fall back to the
// branded Apps Script sender.

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
      return NextResponse.json({ success: false, error: 'Missing clientId' }, { status: 400 })
    }

    const { authorizeForClient } = await import('@/lib/crm/teamAuth')
    const auth = await authorizeForClient(clientId, { level: 'manager' })
    if (!auth.ok) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
    }

    const { error } = await admin
      .from('user_integrations')
      .delete()
      .eq('client_id', clientId)
      .eq('provider', 'gmail_smtp')

    if (error) {
      console.error('[gmail-smtp/disconnect] delete error:', error)
      return NextResponse.json(
        { success: false, error: 'Could not remove connection' },
        { status: 500 },
      )
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[gmail-smtp/disconnect] error:', err)
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Server error' },
      { status: 500 },
    )
  }
}
