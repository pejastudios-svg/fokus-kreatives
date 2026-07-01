import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { verifyAccessPassword } from '@/lib/agreements/password'
import { asEncryptedBody, decryptBodyWithPassword } from '@/lib/agreements/bodyCrypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const admin = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

interface SignerOut {
  id: string
  name: string | null
  email: string
  signedAt: string | null
  signerName: string | null
}

const AGREEMENT_SELECT =
  'id, client_id, title, body_html, status, viewed_at, signed_at, payment_id, access_password_hash, deleted_at, body_encryption'

interface AgreementRow {
  id: string
  client_id: string
  title: string
  body_html: string
  status: string
  viewed_at: string | null
  signed_at: string | null
  payment_id: string | null
  access_password_hash: string | null
  deleted_at: string | null
  body_encryption: unknown
}

// GET /api/agreements/info?token=... - public readout for the signing page.
//
// The token is either a SIGNER token (their personal signing link - they
// get the signature input) or the agreement's public token (view-only,
// used by the CRM "copy link" action). Mirrors /api/invoices/info.
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const token = url.searchParams.get('token')
  const password = url.searchParams.get('password') || ''
  if (!token) {
    return NextResponse.json({ success: false, error: 'Missing token' }, { status: 400 })
  }

  let agreement: AgreementRow | null = null
  let currentSignerId: string | null = null

  const { data: signerRow } = await admin
    .from('agreement_signers')
    .select(`id, agreement:agreements(${AGREEMENT_SELECT})`)
    .eq('token', token)
    .maybeSingle()

  if (signerRow?.agreement) {
    agreement = signerRow.agreement as unknown as AgreementRow
    currentSignerId = signerRow.id as string
  } else {
    const { data } = await admin
      .from('agreements')
      .select(AGREEMENT_SELECT)
      .eq('public_token', token)
      .maybeSingle()
    agreement = (data as AgreementRow | null) || null
  }

  if (!agreement || agreement.status === 'draft') {
    return NextResponse.json({ success: false, error: 'Agreement not found' }, { status: 404 })
  }

  // Soft-deleted: the link is dead but the signature still legally happened.
  if (agreement.deleted_at) {
    return NextResponse.json(
      { success: false, gone: true, error: 'This agreement is no longer available.' },
      { status: 410 },
    )
  }

  // Password-locked: until the correct password is supplied, return only the
  // title/sender + a locked flag, never the body or signer list.
  if (agreement.access_password_hash) {
    if (!password || !verifyAccessPassword(password, agreement.access_password_hash)) {
      const { data: lockClient } = await admin
        .from('clients')
        .select('business_name, name, email_from_name')
        .eq('id', agreement.client_id)
        .maybeSingle()
      const lockFrom =
        (lockClient?.email_from_name as string | null)?.trim() ||
        (lockClient?.business_name as string | null)?.trim() ||
        (lockClient?.name as string | null)?.trim() ||
        'Fokus Kreativez'
      return NextResponse.json({
        success: true,
        agreement: {
          title: agreement.title,
          locked: true,
          from: lockFrom,
          passwordError: Boolean(password),
        },
      })
    }
  }

  // Past the lock gate: decrypt the body for locked agreements (password was
  // just verified above). Unlocked agreements use the stored plaintext.
  let bodyHtml = agreement.body_html
  if (agreement.access_password_hash) {
    const enc = asEncryptedBody(agreement.body_encryption)
    if (enc) {
      const plain = decryptBodyWithPassword(enc, password)
      if (plain == null) {
        return NextResponse.json(
          { success: false, error: 'Could not open this agreement.' },
          { status: 500 },
        )
      }
      bodyHtml = plain
    }
  }

  // First open stamps viewed_at (kept once set).
  if (!agreement.viewed_at && agreement.status === 'sent') {
    await admin
      .from('agreements')
      .update({ viewed_at: new Date().toISOString() })
      .eq('id', agreement.id)
  }

  const { data: signerRows } = await admin
    .from('agreement_signers')
    .select('id, name, email, signed_at, signer_name')
    .eq('agreement_id', agreement.id)
    .order('created_at', { ascending: true })

  const signers: SignerOut[] = (signerRows || []).map((s) => ({
    id: s.id as string,
    name: (s.name as string | null) || null,
    email: s.email as string,
    signedAt: (s.signed_at as string | null) || null,
    signerName: (s.signer_name as string | null) || null,
  }))

  // Attached invoice (created by the final signature): the signing page
  // shows "Continue to invoice" and, once paid, says so.
  let invoiceUrl: string | null = null
  let invoicePaid = false
  if (agreement.payment_id) {
    const { data: pay } = await admin
      .from('payments')
      .select('public_token, status')
      .eq('id', agreement.payment_id)
      .maybeSingle()
    if (pay?.public_token) {
      invoiceUrl = `/invoice/${pay.public_token}`
      invoicePaid = pay.status === 'paid'
    }
  }

  // Sender display name, same precedence as the email branding.
  const { data: client } = await admin
    .from('clients')
    .select('business_name, name, email_from_name')
    .eq('id', agreement.client_id)
    .maybeSingle()
  const fromName =
    (client?.email_from_name as string | null)?.trim() ||
    (client?.business_name as string | null)?.trim() ||
    (client?.name as string | null)?.trim() ||
    'Fokus Kreativez'

  return NextResponse.json({
    success: true,
    agreement: {
      title: agreement.title,
      bodyHtml,
      status: agreement.status,
      signedAt: agreement.signed_at,
      from: fromName,
      signers,
      currentSignerId,
      invoiceUrl,
      invoicePaid,
    },
  })
}
