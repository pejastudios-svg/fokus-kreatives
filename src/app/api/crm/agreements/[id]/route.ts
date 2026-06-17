import { NextRequest, NextResponse } from 'next/server'
import { adminClient, authorizeForClient } from '@/lib/crm/teamAuth'
import {
  enforceAgreementsTier,
  AGREEMENT_COLUMNS,
  cleanSigners,
  cleanInvoiceConfig,
  emailSigners,
  emailCcRecipients,
  replaceSigners,
  type SignerRow,
} from '@/lib/agreements/shared'

export const dynamic = 'force-dynamic'

// PUT /api/crm/agreements/[id] - update a draft, or send it.
// Signed agreements are immutable; sent ones can only be re-sent.
export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const body = (await req.json().catch(() => ({}))) as {
    clientId?: string
    leadId?: string | null
    title?: string
    bodyHtml?: string
    signers?: string[]
    ccEmails?: string[]
    invoiceConfig?: unknown
    action?: 'send'
  }
  const clientId = body.clientId
  if (!clientId) {
    return NextResponse.json({ success: false, error: 'Missing clientId' }, { status: 400 })
  }
  const auth = await authorizeForClient(clientId, { level: 'manager' })
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
  }
  const tier = await enforceAgreementsTier(auth.caller.user.id, clientId)
  if (!tier.ok) {
    return NextResponse.json({ success: false, error: tier.error }, { status: tier.status })
  }

  const { data: existing } = await adminClient
    .from('agreements')
    .select('id, status, title, public_token, cc_emails')
    .eq('id', id)
    .eq('client_id', clientId)
    .maybeSingle()
  if (!existing) {
    return NextResponse.json({ success: false, error: 'Agreement not found' }, { status: 404 })
  }
  if (existing.status === 'signed') {
    return NextResponse.json(
      { success: false, error: 'Signed agreements cannot be changed.' },
      { status: 409 },
    )
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  let signerRows: SignerRow[] | null = null

  // Content + signer edits only apply to drafts - what was emailed stays frozen.
  if (existing.status === 'draft') {
    if (typeof body.title === 'string' && body.title.trim()) patch.title = body.title.trim()
    if (typeof body.bodyHtml === 'string') patch.body_html = body.bodyHtml
    // Creation set lead_id but updates never did - a lead picked AFTER the
    // draft autosaved was silently dropped on the next save.
    if (body.leadId !== undefined) patch.lead_id = body.leadId || null

    if (body.signers !== undefined) {
      const emails = cleanSigners(body.signers)
      if (!emails) {
        return NextResponse.json(
          { success: false, error: 'One of the signer emails is not valid.' },
          { status: 400 },
        )
      }
      const replaced = await replaceSigners(id, emails)
      if ('error' in replaced) {
        return NextResponse.json({ success: false, error: replaced.error }, { status: 500 })
      }
      signerRows = replaced
      patch.recipient_email = emails[0] || null
    }

    if (body.ccEmails !== undefined) {
      const cc = cleanSigners(body.ccEmails)
      if (!cc) {
        return NextResponse.json(
          { success: false, error: 'One of the CC emails is not valid.' },
          { status: 400 },
        )
      }
      patch.cc_emails = cc
    }

    if (body.invoiceConfig !== undefined) {
      const cfg = cleanInvoiceConfig(body.invoiceConfig)
      if (cfg === 'invalid') {
        return NextResponse.json(
          { success: false, error: 'The attached invoice is not valid.' },
          { status: 400 },
        )
      }
      patch.invoice_config = cfg
    }
  }

  let emailedNow: boolean | undefined
  if (body.action === 'send') {
    if (!signerRows) {
      const { data } = await adminClient
        .from('agreement_signers')
        .select('email, name, token')
        .eq('agreement_id', id)
      signerRows = (data || []) as SignerRow[]
    }
    if (signerRows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Add at least one signer email to send.' },
        { status: 400 },
      )
    }
    patch.status = 'sent'
    patch.sent_at = new Date().toISOString()
  }

  const { error } = await adminClient
    .from('agreements')
    .update(patch)
    .eq('id', id)
    .eq('client_id', clientId)

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  if (body.action === 'send' && signerRows) {
    const title = (patch.title as string) || existing.title
    emailedNow = await emailSigners(clientId, id, title, signerRows)
    const cc = (patch.cc_emails as string[] | undefined) ?? (existing.cc_emails as string[]) ?? []
    if (cc.length > 0) {
      await emailCcRecipients(clientId, id, title, cc, existing.public_token as string)
    }
  }

  const { data: full } = await adminClient
    .from('agreements')
    .select(AGREEMENT_COLUMNS)
    .eq('id', id)
    .single()

  return NextResponse.json({ success: true, agreement: full, emailedNow })
}

// DELETE /api/crm/agreements/[id]?clientId=...
// Drafts and unsigned sends can be deleted freely. Anything carrying a
// real signature (fully signed, or partially signed by one of several
// signers) is a record and cannot be deleted.
export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const clientId = new URL(req.url).searchParams.get('clientId')
  if (!clientId) {
    return NextResponse.json({ success: false, error: 'Missing clientId' }, { status: 400 })
  }
  const auth = await authorizeForClient(clientId, { level: 'manager' })
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
  }
  const tier = await enforceAgreementsTier(auth.caller.user.id, clientId)
  if (!tier.ok) {
    return NextResponse.json({ success: false, error: tier.error }, { status: tier.status })
  }

  const { data: existing } = await adminClient
    .from('agreements')
    .select('id, status')
    .eq('id', id)
    .eq('client_id', clientId)
    .maybeSingle()
  if (!existing) {
    return NextResponse.json({ success: false, error: 'Agreement not found' }, { status: 404 })
  }
  if (existing.status === 'signed') {
    return NextResponse.json(
      { success: false, error: 'Signed agreements cannot be deleted.' },
      { status: 409 },
    )
  }
  const { data: signedSigners } = await adminClient
    .from('agreement_signers')
    .select('id')
    .eq('agreement_id', id)
    .not('signed_at', 'is', null)
    .limit(1)
  if (signedSigners && signedSigners.length > 0) {
    return NextResponse.json(
      { success: false, error: 'This agreement already has a signature and cannot be deleted.' },
      { status: 409 },
    )
  }

  const { error } = await adminClient
    .from('agreements')
    .delete()
    .eq('id', id)
    .eq('client_id', clientId)

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
