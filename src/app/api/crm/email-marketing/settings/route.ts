// GET  /api/crm/email-marketing/settings?clientId=...
// POST /api/crm/email-marketing/settings { clientId, settings }
//
// Per-client email marketing settings (CTA library, PS pool, socials,
// footer address, safety caps). Stored in clients.email_marketing_settings.

import { NextRequest, NextResponse } from 'next/server'
import { admin } from '@/lib/emailOutbox'
import { parseSettings } from '@/lib/emailMarketing/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const clientId = new URL(req.url).searchParams.get('clientId')
  if (!clientId) {
    return NextResponse.json({ success: false, error: 'Missing clientId' }, { status: 400 })
  }
  const { authorizeForClient } = await import('@/lib/crm/teamAuth')
  const auth = await authorizeForClient(clientId, { level: 'member' })
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
  }

  const { data, error } = await admin()
    .from('clients')
    .select('email_marketing_settings, email_from_name, business_name, name')
    .eq('id', clientId)
    .maybeSingle()
  if (error || !data) {
    return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 })
  }
  const { getSendingPlan } = await import('@/lib/emailMarketing/plan')
  const planInfo = await getSendingPlan(clientId)

  return NextResponse.json({
    success: true,
    settings: parseSettings(data.email_marketing_settings),
    senderName:
      data.email_from_name || data.business_name || data.name || '',
    plan: planInfo.plan,
    planAddress: planInfo.address,
    dailyMax: planInfo.dailyMax,
  })
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { clientId?: string; settings?: unknown }
    const clientId = body.clientId
    if (!clientId) {
      return NextResponse.json({ success: false, error: 'Missing clientId' }, { status: 400 })
    }
    const { authorizeForClient } = await import('@/lib/crm/teamAuth')
    const auth = await authorizeForClient(clientId, { level: 'manager' })
    if (!auth.ok) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
    }

    // Normalize through the parser so malformed input can't poison the column.
    const settings = parseSettings(body.settings)
    const { error } = await admin()
      .from('clients')
      .update({ email_marketing_settings: settings })
      .eq('id', clientId)
    if (error) {
      console.error('[email-marketing/settings] save error:', error)
      return NextResponse.json({ success: false, error: 'Could not save' }, { status: 500 })
    }
    return NextResponse.json({ success: true, settings })
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Server error' },
      { status: 500 },
    )
  }
}
