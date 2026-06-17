import { NextRequest, NextResponse } from 'next/server'
import { adminClient, authorizeForClient } from '@/lib/crm/teamAuth'
import { enforceAgreementsTier } from '@/lib/agreements/shared'
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

async function isWorkspaceOwner(userId: string, clientId: string): Promise<boolean> {
  const { data } = await adminClient
    .from('users')
    .select('role, client_id')
    .eq('id', userId)
    .maybeSingle()
  return data?.role === 'client' && data?.client_id === clientId
}

// PUT /api/crm/agreements/templates/[id] - rename / update body
export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const body = (await req.json().catch(() => ({}))) as {
    clientId?: string
    name?: string
    bodyHtml?: string
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

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim()
  if (typeof body.bodyHtml === 'string') {
    // Locked template: keep it encrypted at rest, re-wrapping under the same
    // server-recoverable key so editing needs no password.
    const { data: cur } = await adminClient
      .from('agreement_templates')
      .select('body_encryption')
      .eq('id', id)
      .eq('client_id', clientId)
      .maybeSingle()
    const curEnc = asEncryptedBody(cur?.body_encryption)
    if (curEnc) {
      patch.body_encryption = reEncryptBody(curEnc, body.bodyHtml)
      patch.body_html = ''
    } else {
      patch.body_html = body.bodyHtml
    }
  }

  const { data, error } = await adminClient
    .from('agreement_templates')
    .update(patch)
    .eq('id', id)
    .eq('client_id', clientId)
    .select('id, name, body_html, created_at, updated_at')
    .maybeSingle()

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ success: false, error: 'Template not found' }, { status: 404 })
  }
  return NextResponse.json({ success: true, template: data })
}

// POST /api/crm/agreements/templates/[id] { clientId, action, password? }
//  - set_password: set/clear the template's access password (any role).
//  - unlock: verify password, return body_html so the editor can open it.
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const body = (await req.json().catch(() => ({}))) as {
    clientId?: string
    action?: 'set_password' | 'unlock'
    password?: string | null
  }
  const clientId = body.clientId
  if (!clientId || !body.action) {
    return NextResponse.json({ success: false, error: 'Missing clientId or action' }, { status: 400 })
  }
  const auth = await authorizeForClient(clientId, { level: 'member' })
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
  }
  const tier = await enforceAgreementsTier(auth.caller.user.id, clientId)
  if (!tier.ok) {
    return NextResponse.json({ success: false, error: tier.error }, { status: tier.status })
  }

  const { data: tpl } = await adminClient
    .from('agreement_templates')
    .select('id, access_password_hash, body_html, body_encryption')
    .eq('id', id)
    .eq('client_id', clientId)
    .maybeSingle()
  if (!tpl) {
    return NextResponse.json({ success: false, error: 'Template not found' }, { status: 404 })
  }
  const enc = asEncryptedBody(tpl.body_encryption)
  const wasLocked = Boolean(tpl.access_password_hash)
  const currentPassword = (body as { currentPassword?: string | null }).currentPassword
  const force = (body as { force?: boolean }).force === true

  if (body.action === 'set_password') {
    const clearing = body.password == null || body.password === ''

    if (clearing) {
      if (!wasLocked) return NextResponse.json({ success: true, passwordProtected: false })
      let plain: string | null = null
      if (currentPassword && enc) {
        plain = decryptBodyWithPassword(enc, currentPassword)
        if (plain == null) {
          return NextResponse.json({ success: false, error: 'Incorrect password.' }, { status: 401 })
        }
      } else if (force && (await isWorkspaceOwner(auth.caller.user.id, clientId))) {
        plain = enc ? decryptBodyWithServer(enc) : (tpl.body_html as string)
      } else {
        return NextResponse.json(
          { success: false, error: 'Enter the current password to remove the lock, or ask the workspace owner.' },
          { status: 401 },
        )
      }
      const { error } = await adminClient
        .from('agreement_templates')
        .update({
          access_password_hash: null,
          body_encryption: null,
          body_html: plain ?? '',
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('client_id', clientId)
      if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
      return NextResponse.json({ success: true, passwordProtected: false })
    }

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
    let plain: string
    if (wasLocked && enc) {
      if (currentPassword) {
        const p = decryptBodyWithPassword(enc, currentPassword)
        if (p == null) {
          return NextResponse.json({ success: false, error: 'Incorrect current password.' }, { status: 401 })
        }
        plain = p
      } else if (force && (await isWorkspaceOwner(auth.caller.user.id, clientId))) {
        plain = decryptBodyWithServer(enc)
      } else {
        return NextResponse.json(
          { success: false, error: 'Enter the current password to change it.' },
          { status: 401 },
        )
      }
    } else {
      plain = (tpl.body_html as string) || ''
    }
    const sealed = encryptBody(plain, body.password)
    const { error } = await adminClient
      .from('agreement_templates')
      .update({
        access_password_hash: hashAccessPassword(body.password),
        body_encryption: sealed,
        body_html: '',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('client_id', clientId)
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    return NextResponse.json({ success: true, passwordProtected: true })
  }

  // unlock
  if (!wasLocked) {
    return NextResponse.json({ success: true, bodyHtml: tpl.body_html })
  }
  if (force && (await isWorkspaceOwner(auth.caller.user.id, clientId))) {
    return NextResponse.json({
      success: true,
      bodyHtml: enc ? decryptBodyWithServer(enc) : (tpl.body_html as string),
    })
  }
  if (!verifyAccessPassword(String(body.password || ''), tpl.access_password_hash as string)) {
    return NextResponse.json({ success: false, error: 'Incorrect password.' }, { status: 401 })
  }
  const plain = enc ? decryptBodyWithPassword(enc, String(body.password || '')) : (tpl.body_html as string)
  if (plain == null) {
    return NextResponse.json({ success: false, error: 'Incorrect password.' }, { status: 401 })
  }
  return NextResponse.json({ success: true, bodyHtml: plain })
}

// DELETE /api/crm/agreements/templates/[id]?clientId=...
export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const url = new URL(req.url)
  const clientId = url.searchParams.get('clientId')
  const password = url.searchParams.get('password') || ''
  const force = url.searchParams.get('force') === 'true'
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

  // A locked template can only be deleted with its password (or by the
  // workspace owner) - so the lock can't be sidestepped by deleting it.
  const { data: tpl } = await adminClient
    .from('agreement_templates')
    .select('access_password_hash')
    .eq('id', id)
    .eq('client_id', clientId)
    .maybeSingle()
  if (tpl?.access_password_hash) {
    const okByPassword = verifyAccessPassword(password, tpl.access_password_hash as string)
    const okByOwner = force && (await isWorkspaceOwner(auth.caller.user.id, clientId))
    if (!okByPassword && !okByOwner) {
      return NextResponse.json(
        {
          success: false,
          error: 'This template is locked. Enter its password to delete it, or ask the workspace owner.',
          locked: true,
        },
        { status: 401 },
      )
    }
  }

  const { error } = await adminClient
    .from('agreement_templates')
    .delete()
    .eq('id', id)
    .eq('client_id', clientId)

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
