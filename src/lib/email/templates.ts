/**
 * Server-side ports of the outward-facing Apps Script email templates.
 *
 * Used by the gmail_smtp send path (nodemailer) for clients who connected
 * their own Gmail. Kept visually identical to the Apps Script versions so a
 * recipient can't tell which pipeline delivered the email. Apps Script
 * remains the renderer for the fallback path, so any copy change here should
 * be mirrored there (docs/apps-script-email-handlers.gs).
 *
 * Design language matches the public agreement and invoice pages: neutral
 * canvas, one white card, small uppercase brand line, hairline rules, a
 * single modest pill button. No color bands, no oversized type.
 */

export interface EmailAttachment {
  filename: string
  content: string
  contentType: string
}

export interface RenderedEmail {
  subject: string
  html: string
  attachments: EmailAttachment[]
}

const FONT = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"

function escapeHtml(str: unknown): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** One modest pill button, same shape as the Sign / Pay now buttons. */
function buttonHtml(url: string, text: string): string {
  if (!url) return ''
  return (
    '<div style="margin:24px 0 4px;">' +
    `<a href="${url}" target="_blank" ` +
    'style="display:inline-block;background:#2B79F7;color:#ffffff;text-decoration:none;' +
    `padding:10px 22px;border-radius:9999px;font-size:14px;font-weight:600;">${text}</a>` +
    '</div>'
  )
}

function para(text: string): string {
  return `<p style="margin:0 0 12px;font-size:14px;color:#374151;line-height:1.65;">${text}</p>`
}

function muted(text: string): string {
  return `<p style="margin:14px 0 0;font-size:13px;color:#9CA3AF;line-height:1.6;">${text}</p>`
}

/** Label/value rows separated by hairlines, replacing gray fact boxes. */
function factRows(rows: Array<[string, string]>): string {
  const filled = rows.filter(([, v]) => v)
  if (filled.length === 0) return ''
  const tr = filled
    .map(
      ([label, value]) =>
        '<tr>' +
        `<td style="padding:9px 0;border-bottom:1px solid #F3F4F6;font-size:13px;color:#6B7280;">${label}</td>` +
        `<td align="right" style="padding:9px 0;border-bottom:1px solid #F3F4F6;font-size:13px;color:#111827;font-weight:600;">${value}</td>` +
        '</tr>',
    )
    .join('')
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 6px;border-collapse:collapse;">${tr}</table>`
}

// brandName is optional - outward (white-labeled) emails pass
// payload.fromName so the header shows the client's brand instead
// of Fokus Kreatives. Internal emails keep the default.
function baseTemplate(title: string, bodyHtml: string, brandName?: string): string {
  const brand = escapeHtml(brandName || 'Fokus Kreatives')
  return (
    `<div style="margin:0;padding:32px 16px;background:#F6F5F4;">` +
    `<div style="max-width:560px;margin:0 auto;font-family:${FONT};">` +
    '<div style="background:#FFFFFF;border:1px solid #E7E5E0;border-radius:12px;padding:30px 34px;">' +
    `<div style="font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#9CA3AF;">${brand}</div>` +
    `<div style="margin:14px 0 16px;font-size:18px;font-weight:600;color:#111827;">${title}</div>` +
    bodyHtml +
    '<div style="margin-top:24px;padding-top:16px;border-top:1px solid #F3F4F6;font-size:12px;color:#9CA3AF;line-height:1.6;">' +
    'If you did not expect this email, you can ignore it.' +
    '</div>' +
    '</div>' +
    '</div>' +
    '</div>'
  )
}

// Mirrors the Apps Script buildCalendarBlock: add-to-calendar links +
// the .ics file as an attachment for Apple Calendar / Outlook desktop.
interface CalendarMeta {
  startIso?: string
  ics?: string
  googleUrl?: string
  outlookUrl?: string
  office365Url?: string
  yahooUrl?: string
}

function buildCalendarBlock(calendar: CalendarMeta | undefined): {
  buttonsHtml: string
  attachments: EmailAttachment[]
} {
  if (!calendar || !calendar.startIso) return { buttonsHtml: '', attachments: [] }

  const btn = (href: string | undefined, label: string) =>
    href
      ? '<a href="' + href + '" target="_blank" ' +
        'style="display:inline-block;margin:4px 6px 4px 0;padding:7px 14px;' +
        'background:#FFFFFF;color:#374151;text-decoration:none;font-size:12px;' +
        'font-weight:600;border-radius:9999px;border:1px solid #E5E7EB;">' +
        label +
        '</a>'
      : ''

  const buttonsHtml =
    '<div style="margin:20px 0 4px;padding:16px 18px;border:1px solid #F3F4F6;border-radius:10px;">' +
    '<div style="font-size:13px;font-weight:600;color:#111827;margin-bottom:10px;">' +
    'Add to your calendar' +
    '</div>' +
    btn(calendar.googleUrl, 'Google Calendar') +
    btn(calendar.outlookUrl, 'Outlook') +
    btn(calendar.office365Url, 'Office 365') +
    btn(calendar.yahooUrl, 'Yahoo') +
    '<div style="margin-top:10px;font-size:12px;color:#9CA3AF;">' +
    'Apple Calendar users: open the attached .ics file.' +
    '</div>' +
    '</div>'

  const attachments: EmailAttachment[] = calendar.ics
    ? [{ filename: 'invite.ics', content: calendar.ics, contentType: 'text/calendar' }]
    : []

  return { buttonsHtml, attachments }
}

type Payload = Record<string, unknown>
const str = (p: Payload, k: string): string =>
  typeof p[k] === 'string' ? (p[k] as string) : p[k] != null ? String(p[k]) : ''

// ---------------------------------------------------------------------------
// invoice_sent
// ---------------------------------------------------------------------------
function invoiceSent(payload: Payload): RenderedEmail {
  const billToName = str(payload, 'billToName') || 'there'
  const invoiceNumber = str(payload, 'invoiceNumber')
  const amount = payload.amount != null ? String(payload.amount) : '0'
  const currency = str(payload, 'currency') || 'USD'
  const dueDate = str(payload, 'dueDate')
  const link = str(payload, 'link')
  const fromName = str(payload, 'fromName')

  const subject =
    str(payload, 'subject') ||
    'Invoice' + (invoiceNumber ? ' #' + invoiceNumber : '') + ' from ' + (fromName || 'Fokus Kreatives')

  const html = baseTemplate(
    'Your invoice is ready',
    para('Hi ' + escapeHtml(billToName) + ',') +
      para(
        'Your invoice' +
          (invoiceNumber ? ' <b>#' + escapeHtml(invoiceNumber) + '</b>' : '') +
          ' is ready to view and pay online.',
      ) +
      factRows([
        ['Amount due', escapeHtml(currency) + ' ' + escapeHtml(amount)],
        ['Due date', escapeHtml(dueDate)],
      ]) +
      (link ? buttonHtml(link, 'View invoice') : ''),
    fromName,
  )

  return { subject, html, attachments: [] }
}

// ---------------------------------------------------------------------------
// meeting_invitee_confirmation
// ---------------------------------------------------------------------------
function meetingInviteeConfirmation(payload: Payload): RenderedEmail {
  const title = str(payload, 'title') || 'Meeting'
  const when = str(payload, 'when')
  const link = str(payload, 'link')
  const clientName = str(payload, 'clientName') || 'them'
  const platform = str(payload, 'platform')
  const attendeeName = str(payload, 'attendeeName') || 'there'

  const subject = str(payload, 'subject') || 'Your meeting with ' + clientName + ' is confirmed'

  const cal = buildCalendarBlock(payload.calendar as CalendarMeta | undefined)

  const html = baseTemplate(
    'Your meeting is confirmed',
    para('Hi ' + escapeHtml(attendeeName) + ',') +
      para('Your meeting with <b>' + escapeHtml(clientName) + '</b> is confirmed.') +
      factRows([
        ['Meeting', escapeHtml(title)],
        ['When', escapeHtml(when)],
        ['Platform', escapeHtml(platform)],
      ]) +
      (link ? buttonHtml(link, 'Join meeting') : '') +
      cal.buttonsHtml +
      muted('See you then.'),
    str(payload, 'fromName') || (clientName !== 'them' ? clientName : ''),
  )

  return { subject, html, attachments: cal.attachments }
}

// ---------------------------------------------------------------------------
// meeting_rescheduled
// ---------------------------------------------------------------------------
function meetingRescheduled(payload: Payload): RenderedEmail {
  const title = str(payload, 'title') || 'Your meeting'
  const when = str(payload, 'when')
  const link = str(payload, 'link')
  const clientName = str(payload, 'clientName') || 'the team'
  const fromName = str(payload, 'fromName')

  const html = baseTemplate(
    'Your meeting was rescheduled',
    para('<b>' + escapeHtml(title) + '</b> with ' + escapeHtml(clientName) + ' has a new time.') +
      factRows([['New time', escapeHtml(when)]]) +
      (link ? buttonHtml(link, 'Join meeting') : ''),
    fromName,
  )

  return { subject: 'Rescheduled: ' + title, html, attachments: [] }
}

// ---------------------------------------------------------------------------
// agreement_sent
// ---------------------------------------------------------------------------
function agreementSent(payload: Payload): RenderedEmail {
  const recipientName = str(payload, 'recipientName') || 'there'
  const title = str(payload, 'title') || 'Agreement'
  const link = str(payload, 'link')
  const fromName = str(payload, 'fromName')
  // CC copies carry cc:true - same email, "view" wording, no signing ask.
  const isCc = payload.cc === true

  const subject =
    str(payload, 'subject') || title + ' from ' + (fromName || 'Fokus Kreatives')

  const html = baseTemplate(
    isCc ? 'An agreement was shared with you' : 'You have an agreement to sign',
    para('Hi ' + escapeHtml(recipientName) + ',') +
      (isCc
        ? para(
            '<b>' + escapeHtml(fromName || 'Fokus Kreatives') + '</b> has shared <b>' +
              escapeHtml(title) + '</b> with you for your records.',
          ) +
          (link ? buttonHtml(link, 'View agreement') : '') +
          muted('No action is needed from you.')
        : para(
            '<b>' + escapeHtml(fromName || 'Fokus Kreatives') + '</b> has sent you <b>' +
              escapeHtml(title) + '</b> to review and sign online.',
          ) +
          (link ? buttonHtml(link, 'Review and sign') : '') +
          muted('Signing takes less than a minute. Once signed, a copy is emailed to you automatically.')),
    fromName,
  )

  return { subject, html, attachments: [] }
}

// ---------------------------------------------------------------------------
// agreement_signed
// ---------------------------------------------------------------------------
function agreementSigned(payload: Payload): RenderedEmail {
  const recipientName = str(payload, 'recipientName') || 'there'
  const title = str(payload, 'title') || 'Agreement'
  const signerName = str(payload, 'signerName')
  const signedAt = str(payload, 'signedAt')
  const link = str(payload, 'link')
  const invoiceUrl = str(payload, 'invoiceUrl')
  const fromName = str(payload, 'fromName')

  const subject = str(payload, 'subject') || 'Signed: ' + title

  const html = baseTemplate(
    'Agreement signed',
    para('Hi ' + escapeHtml(recipientName) + ',') +
      para(
        '<b>' + escapeHtml(title) + '</b> has been signed' +
          (signerName ? ' by <b>' + escapeHtml(signerName) + '</b>' : '') +
          (signedAt ? ' on ' + escapeHtml(signedAt) : '') + '.',
      ) +
      (link ? buttonHtml(link, 'View signed agreement') : '') +
      (invoiceUrl
        ? para('An invoice for this agreement is ready.') + buttonHtml(invoiceUrl, 'View invoice')
        : '') +
      muted('Keep this email for your records. The link above always shows the signed document.'),
    fromName,
  )

  return { subject, html, attachments: [] }
}

// ---------------------------------------------------------------------------

/** Render an outward email type to subject + html + attachments, or null when
 *  the type has no TS template (caller falls back to Apps Script). */
export function renderOutwardEmail(type: string, payload: Payload): RenderedEmail | null {
  switch (type) {
    // Campaign emails arrive pre-rendered per recipient (links are already
    // wrapped with that recipient's tracking token) - pass them through.
    case 'marketing_email':
      return {
        subject: String(payload.subject || ''),
        html: String(payload.html || ''),
        attachments: [],
      }
    case 'invoice_sent':
      return invoiceSent(payload)
    case 'meeting_invitee_confirmation':
      return meetingInviteeConfirmation(payload)
    case 'meeting_rescheduled':
      return meetingRescheduled(payload)
    case 'agreement_sent':
      return agreementSent(payload)
    case 'agreement_signed':
      return agreementSigned(payload)
    default:
      return null
  }
}
