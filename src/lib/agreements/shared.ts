import { adminClient } from '@/lib/crm/teamAuth'
import { sendAgreementEmail, agreementUrl } from './send'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Columns the CRM list/detail responses return, with signers and the
 *  linked invoice's state embedded. The payments embed is disambiguated by
 *  constraint name - agreements and payments reference each other. */
export const AGREEMENT_COLUMNS =
  'id, title, status, public_token, lead_id, template_id, recipient_name, recipient_email, cc_emails, signed_at, sent_at, viewed_at, created_at, body_html, invoice_config, payment_id, ' +
  'signers:agreement_signers(id, email, name, signed_at, signer_name), ' +
  'payment:payments!agreements_payment_id_fkey(id, status, public_token)'

export interface InvoiceConfig {
  lineItems: { description: string; quantity: number; unit_price: number }[]
  currency: string
  dueDays: number
  /** External checkout URL - becomes the invoice page's "Pay now" button. */
  paymentLink?: string | null
}

/** Validate the attached-invoice config. Returns the cleaned config, null
 *  for "no invoice", or 'invalid'. */
export function cleanInvoiceConfig(raw: unknown): InvoiceConfig | null | 'invalid' {
  if (raw == null) return null
  if (typeof raw !== 'object') return 'invalid'
  const cfg = raw as Partial<InvoiceConfig>
  if (!Array.isArray(cfg.lineItems)) return 'invalid'
  const lineItems = cfg.lineItems
    .map((li) => ({
      description: String(li?.description ?? '').slice(0, 300),
      quantity: Number(li?.quantity) || 0,
      unit_price: Number(li?.unit_price) || 0,
    }))
    .filter((li) => li.description.trim() !== '' || li.quantity > 0 || li.unit_price > 0)
  if (lineItems.length === 0) return null
  const currency = String(cfg.currency || 'USD').slice(0, 8).toUpperCase()
  const dueDays = Math.max(0, Math.min(365, Math.floor(Number(cfg.dueDays) || 0)))
  let paymentLink: string | null = null
  if (typeof cfg.paymentLink === 'string' && cfg.paymentLink.trim()) {
    const raw = cfg.paymentLink.trim().slice(0, 500)
    paymentLink = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  }
  return { lineItems, currency, dueDays, paymentLink }
}

export function invoiceTotal(cfg: InvoiceConfig): number {
  return cfg.lineItems.reduce((s, li) => s + li.quantity * li.unit_price, 0)
}

/** Server-side mirror of the UI tier gate: Agreements is a top-tier
 *  feature for client-side accounts. Agency staff (client_id null) always
 *  pass, and clients with no tier assigned keep full access - the same
 *  backwards-compatibility rule the tab gating uses. Without this, a
 *  middle/lower-tier client could hit the API directly past the hidden tab. */
export async function enforceAgreementsTier(
  userId: string,
  clientId: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const { data: me } = await adminClient
    .from('users')
    .select('client_id')
    .eq('id', userId)
    .maybeSingle()
  if (!me || me.client_id === null) return { ok: true } // agency side
  const { data: client } = await adminClient
    .from('clients')
    .select('package_tier')
    .eq('id', clientId)
    .maybeSingle()
  const tier = (client?.package_tier as string | null) ?? null
  if (tier === null || tier === 'top') return { ok: true }
  return {
    ok: false,
    status: 403,
    error: 'Agreements are not included in your current plan.',
  }
}

/** Validate + dedupe a signer email list. Returns null on any invalid entry. */
export function cleanSigners(raw: unknown): string[] | null {
  const list = Array.isArray(raw) ? raw : []
  const emails = Array.from(
    new Set(list.map((e) => String(e || '').trim().toLowerCase()).filter(Boolean)),
  )
  if (emails.some((e) => !EMAIL_RE.test(e))) return null
  return emails
}

export interface SignerRow {
  email: string
  name: string | null
  token: string
}

/** Replace a draft's signer rows with a fresh email list. */
export async function replaceSigners(
  agreementId: string,
  emails: string[],
): Promise<SignerRow[] | { error: string }> {
  const del = await adminClient
    .from('agreement_signers')
    .delete()
    .eq('agreement_id', agreementId)
  if (del.error) return { error: del.error.message }
  if (emails.length === 0) return []
  const { data, error } = await adminClient
    .from('agreement_signers')
    .insert(emails.map((email) => ({ agreement_id: agreementId, email })))
    .select('email, name, token')
  if (error) return { error: error.message }
  return (data || []) as SignerRow[]
}

/** Email every signer their personal signing link. Returns false when any
 *  send fell back to the outbox (still delivers, just not instantly). */
export async function emailSigners(
  clientId: string,
  agreementId: string,
  title: string,
  signers: SignerRow[],
): Promise<boolean> {
  let allNow = true
  for (const s of signers) {
    const ok = await sendAgreementEmail(
      'agreement_sent',
      {
        clientId,
        to: s.email,
        recipientName: s.name || '',
        title,
        link: agreementUrl(s.token),
      },
      `agreement:${agreementId}:sent:${s.email}:${Date.now()}`,
    )
    if (!ok) allNow = false
  }
  return allNow
}

/** Email CC recipients a copy notice with the VIEW link - no signature
 *  asked of them. The `cc: true` flag switches the template's wording. */
export async function emailCcRecipients(
  clientId: string,
  agreementId: string,
  title: string,
  ccEmails: string[],
  publicToken: string,
): Promise<void> {
  for (const email of ccEmails) {
    await sendAgreementEmail(
      'agreement_sent',
      {
        clientId,
        to: email,
        recipientName: '',
        title,
        link: agreementUrl(publicToken),
        cc: true,
      },
      `agreement:${agreementId}:cc:${email}:${Date.now()}`,
    )
  }
}
