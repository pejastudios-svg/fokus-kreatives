import { NextRequest, NextResponse } from 'next/server'
import { adminClient, authorizeForClient } from '@/lib/crm/teamAuth'
import { enforceAgreementsTier } from '@/lib/agreements/shared'

export const dynamic = 'force-dynamic'

// GET /api/crm/agreements/automations?clientId=... - list rules
export async function GET(req: NextRequest) {
  const clientId = new URL(req.url).searchParams.get('clientId')
  if (!clientId) {
    return NextResponse.json({ success: false, error: 'Missing clientId' }, { status: 400 })
  }
  const auth = await authorizeForClient(clientId, { level: 'member' })
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
  }
  const tier = await enforceAgreementsTier(auth.caller.user.id, clientId)
  if (!tier.ok) {
    return NextResponse.json({ success: false, error: tier.error }, { status: tier.status })
  }

  const { data, error } = await adminClient
    .from('agreement_automations')
    .select('id, template_id, trigger_status, enabled, created_at')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
  return NextResponse.json({ success: true, automations: data || [] })
}

// POST /api/crm/agreements/automations - create a rule
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    clientId?: string
    templateId?: string
    triggerStatus?: string
  }
  const clientId = body.clientId
  const templateId = body.templateId
  const triggerStatus = (body.triggerStatus || '').trim()
  if (!clientId || !templateId || !triggerStatus) {
    return NextResponse.json(
      { success: false, error: 'Missing template or trigger status' },
      { status: 400 },
    )
  }
  const auth = await authorizeForClient(clientId, { level: 'manager' })
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
  }
  const tier = await enforceAgreementsTier(auth.caller.user.id, clientId)
  if (!tier.ok) {
    return NextResponse.json({ success: false, error: tier.error }, { status: tier.status })
  }

  // Template must belong to this client.
  const { data: tpl } = await adminClient
    .from('agreement_templates')
    .select('id')
    .eq('id', templateId)
    .eq('client_id', clientId)
    .maybeSingle()
  if (!tpl) {
    return NextResponse.json({ success: false, error: 'Template not found' }, { status: 404 })
  }

  const { data, error } = await adminClient
    .from('agreement_automations')
    .upsert(
      { client_id: clientId, template_id: templateId, trigger_status: triggerStatus, enabled: true },
      { onConflict: 'template_id,trigger_status' },
    )
    .select('id, template_id, trigger_status, enabled, created_at')
    .single()

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
  return NextResponse.json({ success: true, automation: data })
}

// DELETE /api/crm/agreements/automations?clientId=...&id=...
export async function DELETE(req: NextRequest) {
  const url = new URL(req.url)
  const clientId = url.searchParams.get('clientId')
  const id = url.searchParams.get('id')
  if (!clientId || !id) {
    return NextResponse.json({ success: false, error: 'Missing clientId or id' }, { status: 400 })
  }
  const auth = await authorizeForClient(clientId, { level: 'manager' })
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
  }

  const { error } = await adminClient
    .from('agreement_automations')
    .delete()
    .eq('id', id)
    .eq('client_id', clientId)

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
