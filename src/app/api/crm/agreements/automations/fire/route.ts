import { NextRequest, NextResponse } from 'next/server'
import { adminClient, authorizeForClient } from '@/lib/crm/teamAuth'
import { enforceAgreementsTier } from '@/lib/agreements/shared'

export const dynamic = 'force-dynamic'

// POST /api/crm/agreements/automations/fire { clientId, leadId, status }
//
// Called by the leads page after a lead's status changes (table, drawer,
// dropdown, kanban drag - they all share one update path). For every
// enabled rule on that status, STAGE a draft agreement from the rule's
// template: lead attached, signer prefilled with the lead's email, body
// kept with placeholder chips so compose fills it live. Never auto-sends.
// A team notification points at the staged draft to review & send.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    clientId?: string
    leadId?: string
    status?: string
  }
  const clientId = body.clientId
  const leadId = body.leadId
  const status = (body.status || '').trim()
  if (!clientId || !leadId || !status) {
    return NextResponse.json({ success: false, error: 'Missing fields' }, { status: 400 })
  }
  const auth = await authorizeForClient(clientId, { level: 'member' })
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
  }
  // Below-tier client accounts can still move leads around - the automation
  // just quietly doesn't stage agreements for them.
  const tier = await enforceAgreementsTier(auth.caller.user.id, clientId)
  if (!tier.ok) {
    return NextResponse.json({ success: true, staged: 0 })
  }

  const { data: rules } = await adminClient
    .from('agreement_automations')
    .select('id, template_id')
    .eq('client_id', clientId)
    .eq('trigger_status', status)
    .eq('enabled', true)
  if (!rules || rules.length === 0) {
    return NextResponse.json({ success: true, staged: 0 })
  }

  const { data: lead } = await adminClient
    .from('leads')
    .select('id, data')
    .eq('id', leadId)
    .eq('client_id', clientId)
    .maybeSingle()
  if (!lead) {
    return NextResponse.json({ success: false, error: 'Lead not found' }, { status: 404 })
  }
  const leadData = (lead.data || {}) as Record<string, unknown>
  const leadName = typeof leadData.name === 'string' && leadData.name ? leadData.name : 'Lead'
  const leadEmail =
    typeof leadData.email === 'string' && leadData.email
      ? leadData.email.trim().toLowerCase()
      : null

  let staged = 0
  for (const rule of rules) {
    const { data: tpl } = await adminClient
      .from('agreement_templates')
      .select('id, name, body_html')
      .eq('id', rule.template_id)
      .eq('client_id', clientId)
      .maybeSingle()
    if (!tpl) continue

    // One staged draft per (template, lead): re-entering the status while
    // a draft is still sitting there must not pile up duplicates.
    const { data: existing } = await adminClient
      .from('agreements')
      .select('id')
      .eq('client_id', clientId)
      .eq('template_id', tpl.id)
      .eq('lead_id', leadId)
      .eq('status', 'draft')
      .limit(1)
    if (existing && existing.length > 0) continue

    const title = `${tpl.name} - ${leadName}`
    const { data: created, error: insertErr } = await adminClient
      .from('agreements')
      .insert({
        client_id: clientId,
        template_id: tpl.id,
        lead_id: leadId,
        title,
        body_html: tpl.body_html,
        status: 'draft',
        recipient_email: leadEmail,
        created_by: auth.caller.user.id,
      })
      .select('id')
      .single()
    if (insertErr || !created) {
      console.error('[automations/fire] stage failed:', insertErr)
      continue
    }
    if (leadEmail) {
      await adminClient
        .from('agreement_signers')
        .insert({ agreement_id: created.id, email: leadEmail })
    }
    staged++

    try {
      await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/notifications/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          type: 'agreement_staged',
          data: { clientId, agreementTitle: title, leadName, status },
        }),
      })
    } catch (e) {
      console.error('[automations/fire] notification failed:', e)
    }
  }

  return NextResponse.json({ success: true, staged })
}
