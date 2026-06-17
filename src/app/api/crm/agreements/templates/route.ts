import { NextRequest, NextResponse } from 'next/server'
import { adminClient, authorizeForClient } from '@/lib/crm/teamAuth'
import { enforceAgreementsTier } from '@/lib/agreements/shared'

export const dynamic = 'force-dynamic'

// GET /api/crm/agreements/templates?clientId=...  - list templates
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
    .from('agreement_templates')
    .select('id, name, body_html, created_at, updated_at')
    .eq('client_id', clientId)
    .order('updated_at', { ascending: false })

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
  return NextResponse.json({ success: true, templates: data || [] })
}

// POST /api/crm/agreements/templates - create a template
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    clientId?: string
    name?: string
    bodyHtml?: string
  }
  const clientId = body.clientId
  const name = (body.name || '').trim()
  if (!clientId || !name) {
    return NextResponse.json(
      { success: false, error: 'Missing clientId or name' },
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

  const { data, error } = await adminClient
    .from('agreement_templates')
    .insert({ client_id: clientId, name, body_html: body.bodyHtml || '' })
    .select('id, name, body_html, created_at, updated_at')
    .single()

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
  return NextResponse.json({ success: true, template: data })
}
