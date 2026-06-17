import { NextRequest, NextResponse } from 'next/server'
import { adminClient, authorizeForClient } from '@/lib/crm/teamAuth'
import {
  enforceAgreementsTier,
  AGREEMENT_COLUMNS,
  cleanSigners,
  cleanInvoiceConfig,
  emailSigners,
  emailCcRecipients,
  presentAgreement,
  type SignerRow,
} from '@/lib/agreements/shared'

export const dynamic = 'force-dynamic'

// GET /api/crm/agreements?clientId=...[&view=deleted] - list agreements with
// their signers. Default excludes soft-deleted; view=deleted returns the
// Recently Deleted set (restorable, auto-purged after 30 days).
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const clientId = url.searchParams.get('clientId')
  const deletedView = url.searchParams.get('view') === 'deleted'
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

  let query = adminClient
    .from('agreements')
    .select(AGREEMENT_COLUMNS)
    .eq('client_id', clientId)
  query = deletedView
    ? query.not('deleted_at', 'is', null).order('deleted_at', { ascending: false })
    : query.is('deleted_at', null).order('updated_at', { ascending: false })

  const { data, error } = await query
  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
  // Strip the password hash + withhold body_html for locked agreements.
  const agreements = (data || []).map((r) => presentAgreement(r as unknown as Record<string, unknown>))
  return NextResponse.json({ success: true, agreements })
}

// POST /api/crm/agreements - create an agreement (draft or send right away).
// `signers` is the list of emails that must each sign; everyone gets their
// own signing link. The body arrives already FILLED from the compose
// preview when sending, so it stays frozen from that moment on.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    clientId?: string
    templateId?: string | null
    leadId?: string | null
    title?: string
    bodyHtml?: string
    signers?: string[]
    ccEmails?: string[]
    invoiceConfig?: unknown
    send?: boolean
  }
  const clientId = body.clientId
  const title = (body.title || '').trim()
  const bodyHtml = body.bodyHtml || ''

  if (!clientId || !title || !bodyHtml.trim()) {
    return NextResponse.json(
      { success: false, error: 'Missing title or agreement content.' },
      { status: 400 },
    )
  }
  const signers = cleanSigners(body.signers)
  if (!signers) {
    return NextResponse.json(
      { success: false, error: 'One of the signer emails is not valid.' },
      { status: 400 },
    )
  }
  const ccEmails = cleanSigners(body.ccEmails)
  if (!ccEmails) {
    return NextResponse.json(
      { success: false, error: 'One of the CC emails is not valid.' },
      { status: 400 },
    )
  }
  const invoiceCfg = cleanInvoiceConfig(body.invoiceConfig)
  if (invoiceCfg === 'invalid') {
    return NextResponse.json(
      { success: false, error: 'The attached invoice is not valid.' },
      { status: 400 },
    )
  }
  if (body.send && signers.length === 0) {
    return NextResponse.json(
      { success: false, error: 'Add at least one signer email to send.' },
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

  const nowIso = new Date().toISOString()
  const { data: row, error } = await adminClient
    .from('agreements')
    .insert({
      client_id: clientId,
      template_id: body.templateId || null,
      lead_id: body.leadId || null,
      title,
      body_html: bodyHtml,
      status: body.send ? 'sent' : 'draft',
      // Legacy single-recipient column doubles as the list display summary.
      recipient_email: signers[0] || null,
      cc_emails: ccEmails,
      invoice_config: invoiceCfg,
      sent_at: body.send ? nowIso : null,
      created_by: auth.caller.user.id,
    })
    .select('id, public_token')
    .single()

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  let signerRows: SignerRow[] = []
  if (signers.length > 0) {
    const { data: inserted, error: signersErr } = await adminClient
      .from('agreement_signers')
      .insert(signers.map((email) => ({ agreement_id: row.id, email })))
      .select('email, name, token')
    if (signersErr) {
      return NextResponse.json({ success: false, error: signersErr.message }, { status: 500 })
    }
    signerRows = (inserted || []) as SignerRow[]
  }

  let emailedNow = true
  if (body.send) {
    emailedNow = await emailSigners(clientId, row.id as string, title, signerRows)
    if (ccEmails.length > 0) {
      await emailCcRecipients(clientId, row.id as string, title, ccEmails, row.public_token as string)
    }
  }

  const { data: full } = await adminClient
    .from('agreements')
    .select(AGREEMENT_COLUMNS)
    .eq('id', row.id)
    .single()

  // Creator just authored it -> return with body included (unlocked).
  return NextResponse.json({
    success: true,
    agreement: full ? presentAgreement(full as unknown as Record<string, unknown>, { unlocked: true }) : full,
    emailedNow,
  })
}
