import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { sendAgreementEmail, agreementUrl } from '@/lib/agreements/send'
import { cleanInvoiceConfig, invoiceTotal } from '@/lib/agreements/shared'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const admin = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// POST /api/agreements/sign { token, name }
//
// Typed-name e-signature against a SIGNER token (each signer has their own
// link, so we always know who is signing). Records name + timestamp + IP +
// user agent as the audit trail. The conditional update keeps signing
// idempotent - a double click or two open tabs can't double-sign.
//
// When the LAST signer signs, the agreement flips to 'signed' and the
// signed-copy email goes out to every signer plus the CRM team.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { token?: string; name?: string }
  const token = body.token || ''
  const name = (body.name || '').trim()

  if (!token || name.length < 2) {
    return NextResponse.json(
      { success: false, error: 'Please type your full name to sign.' },
      { status: 400 },
    )
  }

  const { data: signer } = await admin
    .from('agreement_signers')
    .select(
      'id, agreement_id, email, signed_at, agreement:agreements(id, client_id, title, status, public_token, cc_emails, invoice_config, lead_id)',
    )
    .eq('token', token)
    .maybeSingle()

  const agreement = (signer?.agreement || null) as {
    id: string
    client_id: string
    title: string
    status: string
    public_token: string
    cc_emails: string[] | null
    invoice_config: unknown
    lead_id: string | null
  } | null

  if (!signer || !agreement || agreement.status === 'draft') {
    return NextResponse.json(
      { success: false, error: 'This signing link is not valid.' },
      { status: 404 },
    )
  }
  if (signer.signed_at || agreement.status === 'signed') {
    return NextResponse.json(
      { success: false, error: 'This agreement has already been signed.' },
      { status: 409 },
    )
  }

  const signedAt = new Date().toISOString()
  const ip =
    (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
    req.headers.get('x-real-ip') ||
    null

  const { data: updated, error } = await admin
    .from('agreement_signers')
    .update({
      signed_at: signedAt,
      signer_name: name,
      sign_ip: ip,
      sign_user_agent: (req.headers.get('user-agent') || '').slice(0, 300) || null,
    })
    .eq('id', signer.id)
    .is('signed_at', null) // idempotency guard against concurrent signs
    .select('id')
    .maybeSingle()

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
  if (!updated) {
    return NextResponse.json(
      { success: false, error: 'This agreement has already been signed.' },
      { status: 409 },
    )
  }

  // Fully signed? Flip the agreement and email the signed copy to everyone.
  const { data: allSigners } = await admin
    .from('agreement_signers')
    .select('email, name, signed_at, signer_name')
    .eq('agreement_id', agreement.id)
    .order('created_at', { ascending: true })
  const pending = (allSigners || []).filter((s) => !s.signed_at)
  const allSigned = pending.length === 0
  let invoiceUrl: string | null = null

  if (allSigned) {
    const signerNames = (allSigners || [])
      .map((s) => (s.signer_name as string | null) || '')
      .filter(Boolean)
      .join(', ')
    // Only the request that actually flips sent->signed runs the
    // completion work (invoice + emails) - two last-signers racing can't
    // double-invoice or double-email.
    const { data: flipped } = await admin
      .from('agreements')
      .update({
        status: 'signed',
        signed_at: signedAt,
        signer_name: signerNames || name,
        updated_at: signedAt,
      })
      .eq('id', agreement.id)
      .eq('status', 'sent')
      .select('id')
      .maybeSingle()
    if (!flipped) {
      return NextResponse.json({ success: true, signedAt, allSigned })
    }

    // Attached invoice: the final signature creates the REAL payment row,
    // billed to the first signer, and the hosted invoice page goes live.
    const cfg = cleanInvoiceConfig(agreement.invoice_config)
    if (cfg && cfg !== 'invalid') {
      const firstSigner = (allSigners || [])[0]
      const total = invoiceTotal(cfg)
      const dueYmd = new Date(Date.parse(signedAt) + cfg.dueDays * 86400000)
        .toISOString()
        .slice(0, 10)
      const { data: pay, error: payErr } = await admin
        .from('payments')
        .insert({
          client_id: agreement.client_id,
          lead_id: agreement.lead_id || null,
          agreement_id: agreement.id,
          amount: total,
          currency: cfg.currency,
          status: 'pending',
          due_date: dueYmd,
          is_invoice: true,
          line_items: cfg.lineItems,
          bill_to_name: (firstSigner?.signer_name as string | null) || (firstSigner?.name as string | null) || null,
          bill_to_email: (firstSigner?.email as string | null) || null,
          issue_date: signedAt.slice(0, 10),
          payment_link: cfg.paymentLink || null,
          tax_rate: 0,
          discount: 0,
          // Delivered via the signed-copy email + the signing page button;
          // 'sent' keeps the invoice dispatch cron from re-sending it.
          send_status: 'sent',
          sent_at: signedAt,
          is_recurring: false,
          recurring_count: 0,
          reminder_enabled: false,
        })
        .select('id, public_token')
        .single()
      if (payErr || !pay) {
        // The signature stands either way - surface the failure for the CRM.
        console.error('[agreements/sign] invoice creation failed:', payErr)
      } else {
        invoiceUrl = `${(process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '')}/invoice/${pay.public_token}`
        await admin.from('agreements').update({ payment_id: pay.id }).eq('id', agreement.id)
        // In-app notification with provenance ("from agreement ...").
        try {
          await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/notifications/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              clientId: agreement.client_id,
              type: 'payment_created',
              data: {
                amount: total,
                currency: cfg.currency,
                dueDate: dueYmd,
                fromAgreement: agreement.title,
                clientId: agreement.client_id,
              },
            }),
          })
        } catch (e) {
          console.error('[agreements/sign] invoice notification failed:', e)
        }
      }
    }

    const link = agreementUrl(agreement.public_token)
    const signedAtText = new Date(signedAt).toLocaleString('en-GB', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })

    for (const s of allSigners || []) {
      await sendAgreementEmail(
        'agreement_signed',
        {
          clientId: agreement.client_id,
          to: s.email,
          recipientName: (s.name as string | null) || (s.signer_name as string | null) || '',
          title: agreement.title,
          signerName: signerNames || name,
          signedAt: signedAtText,
          link,
          invoiceUrl,
        },
        `agreement:${agreement.id}:signed:${s.email}`,
      )
    }

    // CC recipients get the signed copy too (view link, no signature).
    const ccList = (agreement.cc_emails || []).filter(Boolean)
    for (const ccEmail of ccList) {
      await sendAgreementEmail(
        'agreement_signed',
        {
          clientId: agreement.client_id,
          to: ccEmail,
          recipientName: '',
          title: agreement.title,
          signerName: signerNames || name,
          signedAt: signedAtText,
          link,
          invoiceUrl,
        },
        `agreement:${agreement.id}:signed:cc:${ccEmail}`,
      )
    }

    // The CRM team's copy: every account belonging to this client.
    const signerEmails = new Set(
      [...(allSigners || []).map((s) => String(s.email).toLowerCase()), ...ccList.map((e) => e.toLowerCase())],
    )
    const { data: teamUsers } = await admin
      .from('users')
      .select('email')
      .eq('client_id', agreement.client_id)
    const teamEmails = Array.from(
      new Set(
        (teamUsers || [])
          .map((u) => (u.email as string | null) || '')
          .filter((e) => e && !signerEmails.has(e.toLowerCase())),
      ),
    )
    if (teamEmails.length > 0) {
      await sendAgreementEmail(
        'agreement_signed',
        {
          clientId: agreement.client_id,
          to: teamEmails,
          recipientName: '',
          title: agreement.title,
          signerName: signerNames || name,
          signedAt: signedAtText,
          link,
          invoiceUrl,
        },
        `agreement:${agreement.id}:signed:team`,
      )
    }
  }

  return NextResponse.json({ success: true, signedAt, allSigned, invoiceUrl })
}
