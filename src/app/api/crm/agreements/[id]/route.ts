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
  presentAgreement,
  type SignerRow,
} from '@/lib/agreements/shared'
import { hashAccessPassword, verifyAccessPassword, isUsablePassword } from '@/lib/agreements/password'
import {
  encryptBody,
  decryptBodyWithPassword,
  decryptBodyWithServer,
  reEncryptBody,
  asEncryptedBody,
  serverKeyConfigured,
} from '@/lib/agreements/bodyCrypto'

export const dynamic = 'force-dynamic'

/** Workspace owner = the client-portal account that owns THIS CRM (role
 *  'client', client_id = this client). Only they can force-remove a lost
 *  password / recover a locked doc - not the agency, not team members. */
async function isWorkspaceOwner(userId: string, clientId: string): Promise<boolean> {
  const { data } = await adminClient
    .from('users')
    .select('role, client_id')
    .eq('id', userId)
    .maybeSingle()
  return data?.role === 'client' && data?.client_id === clientId
}

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
    .select('id, status, title, public_token, cc_emails, body_encryption')
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
  const existingEnc = asEncryptedBody(existing.body_encryption)

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  let signerRows: SignerRow[] | null = null

  // Content + signer edits only apply to drafts - what was emailed stays frozen.
  if (existing.status === 'draft') {
    if (typeof body.title === 'string' && body.title.trim()) patch.title = body.title.trim()
    if (typeof body.bodyHtml === 'string') {
      // Locked draft: keep it encrypted at rest. Re-wrap the new body under
      // the same (server-recoverable) key so no password is needed to save.
      if (existingEnc) {
        patch.body_encryption = reEncryptBody(existingEnc, body.bodyHtml)
        patch.body_html = ''
      } else {
        patch.body_html = body.bodyHtml
      }
    }
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

  return NextResponse.json({
    success: true,
    agreement: full ? presentAgreement(full as unknown as Record<string, unknown>, { unlocked: true }) : full,
    emailedNow,
  })
}

// POST /api/crm/agreements/[id] { clientId, action, password? }
//  - set_password (member): set or clear (password null/'') the access
//    password on an agreement. Works on any status, including signed.
//  - unlock (member): verify the password and return body_html so the editor
//    can open a locked agreement.
//  - restore / delete_permanent (manager): Recently Deleted actions.
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const body = (await req.json().catch(() => ({}))) as {
    clientId?: string
    action?: 'set_password' | 'unlock' | 'restore' | 'delete_permanent'
    password?: string | null
    currentPassword?: string | null
    force?: boolean
  }
  const clientId = body.clientId
  const action = body.action
  if (!clientId || !action) {
    return NextResponse.json({ success: false, error: 'Missing clientId or action' }, { status: 400 })
  }
  // Password set + unlock are open to any role ("any role can do this");
  // restore / permanent-delete stay manager-gated like delete.
  const level = action === 'set_password' || action === 'unlock' ? 'member' : 'manager'
  const auth = await authorizeForClient(clientId, { level })
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
  }
  const tier = await enforceAgreementsTier(auth.caller.user.id, clientId)
  if (!tier.ok) {
    return NextResponse.json({ success: false, error: tier.error }, { status: tier.status })
  }

  const { data: existing } = await adminClient
    .from('agreements')
    .select('id, access_password_hash, deleted_at, body_html, body_encryption')
    .eq('id', id)
    .eq('client_id', clientId)
    .maybeSingle()
  if (!existing) {
    return NextResponse.json({ success: false, error: 'Agreement not found' }, { status: 404 })
  }
  const enc = asEncryptedBody(existing.body_encryption)
  const wasLocked = Boolean(existing.access_password_hash)

  if (action === 'set_password') {
    const clearing = body.password == null || body.password === ''

    // --- Clearing / removing the lock ---
    if (clearing) {
      if (!wasLocked) {
        return NextResponse.json({ success: true, passwordProtected: false })
      }
      // Must prove the current password OR be the workspace owner (recovery).
      let plain: string | null = null
      if (body.currentPassword && enc) {
        plain = decryptBodyWithPassword(enc, body.currentPassword)
        if (plain == null) {
          return NextResponse.json({ success: false, error: 'Incorrect password.' }, { status: 401 })
        }
      } else if (body.force && (await isWorkspaceOwner(auth.caller.user.id, clientId))) {
        plain = enc ? decryptBodyWithServer(enc) : (existing.body_html as string)
      } else {
        return NextResponse.json(
          {
            success: false,
            error: 'Enter the current password to remove the lock, or ask the workspace owner.',
          },
          { status: 401 },
        )
      }
      const { error } = await adminClient
        .from('agreements')
        .update({
          access_password_hash: null,
          body_encryption: null,
          body_html: plain ?? '',
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('client_id', clientId)
      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 })
      }
      return NextResponse.json({ success: true, passwordProtected: false })
    }

    // --- Setting or changing a password ---
    if (!isUsablePassword(body.password)) {
      return NextResponse.json(
        { success: false, error: 'Password must be at least 4 characters.' },
        { status: 400 },
      )
    }
    if (!serverKeyConfigured()) {
      return NextResponse.json(
        { success: false, error: 'Encryption is not configured on the server (EMAIL_CRED_KEY).' },
        { status: 500 },
      )
    }
    // Recover the current plaintext to re-encrypt under the new password.
    let plain: string
    if (wasLocked && enc) {
      if (body.currentPassword) {
        const p = decryptBodyWithPassword(enc, body.currentPassword)
        if (p == null) {
          return NextResponse.json({ success: false, error: 'Incorrect current password.' }, { status: 401 })
        }
        plain = p
      } else if (body.force && (await isWorkspaceOwner(auth.caller.user.id, clientId))) {
        plain = decryptBodyWithServer(enc)
      } else {
        return NextResponse.json(
          { success: false, error: 'Enter the current password to change it.' },
          { status: 401 },
        )
      }
    } else {
      plain = (existing.body_html as string) || ''
    }
    const sealed = encryptBody(plain, body.password)
    const { error } = await adminClient
      .from('agreements')
      .update({
        access_password_hash: hashAccessPassword(body.password),
        body_encryption: sealed,
        body_html: '', // plaintext no longer lives in the row
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('client_id', clientId)
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }
    return NextResponse.json({ success: true, passwordProtected: true })
  }

  if (action === 'unlock') {
    if (!wasLocked) {
      return NextResponse.json({ success: true, bodyHtml: existing.body_html })
    }
    // Agency owner can open without the password (recovery).
    if (body.force && (await isWorkspaceOwner(auth.caller.user.id, clientId))) {
      const plain = enc ? decryptBodyWithServer(enc) : (existing.body_html as string)
      return NextResponse.json({ success: true, bodyHtml: plain })
    }
    if (!verifyAccessPassword(String(body.password || ''), existing.access_password_hash as string)) {
      return NextResponse.json({ success: false, error: 'Incorrect password.' }, { status: 401 })
    }
    const plain = enc ? decryptBodyWithPassword(enc, String(body.password || '')) : (existing.body_html as string)
    if (plain == null) {
      return NextResponse.json({ success: false, error: 'Incorrect password.' }, { status: 401 })
    }
    return NextResponse.json({ success: true, bodyHtml: plain })
  }

  if (action === 'restore') {
    const { error } = await adminClient
      .from('agreements')
      .update({ deleted_at: null, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('client_id', clientId)
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  }

  if (action === 'delete_permanent') {
    // Only hard-delete something already in Recently Deleted.
    if (!existing.deleted_at) {
      return NextResponse.json(
        { success: false, error: 'Delete it first, then it can be permanently removed.' },
        { status: 400 },
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

  return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 })
}

// DELETE /api/crm/agreements/[id]?clientId=...
// SOFT delete (PandaDoc-style): the agreement leaves the page and its public
// link goes dead, but the signature/audit trail and already-sent emails are
// untouched. Signed agreements CAN be soft-deleted (you're removing your
// record + the live link, not un-signing). Restorable for 30 days from
// Recently Deleted, then a cron hard-deletes it.
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

  const url = new URL(req.url)
  const password = url.searchParams.get('password') || ''
  const force = url.searchParams.get('force') === 'true'

  const { data: existing } = await adminClient
    .from('agreements')
    .select('id, access_password_hash')
    .eq('id', id)
    .eq('client_id', clientId)
    .maybeSingle()
  if (!existing) {
    return NextResponse.json({ success: false, error: 'Agreement not found' }, { status: 404 })
  }

  // A locked agreement can only be deleted with its password (or by the
  // workspace owner) - so the lock can't be sidestepped by deleting it.
  if (existing.access_password_hash) {
    const okByPassword = verifyAccessPassword(password, existing.access_password_hash as string)
    const okByOwner = force && (await isWorkspaceOwner(auth.caller.user.id, clientId))
    if (!okByPassword && !okByOwner) {
      return NextResponse.json(
        {
          success: false,
          error: 'This agreement is locked. Enter its password to delete it, or ask the workspace owner.',
          locked: true,
        },
        { status: 401 },
      )
    }
  }

  const { error } = await adminClient
    .from('agreements')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('client_id', clientId)

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
