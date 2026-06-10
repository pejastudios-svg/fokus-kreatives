/**
 * Server-side ports of the outward-facing Apps Script email templates.
 *
 * Used by the gmail_smtp send path (nodemailer) for clients who connected
 * their own Gmail. Kept visually identical to the Apps Script versions so a
 * recipient can't tell which pipeline delivered the email. Apps Script
 * remains the renderer for the fallback path, so any copy change here should
 * be mirrored there.
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

function escapeHtml(str: unknown): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function buttonHtml(url: string, text: string): string {
  if (!url) return ''
  return `
    <div style="margin: 18px 0;">
      <a href="${url}" target="_blank"
         style="display:inline-block;background:#2B79F7;color:#fff;text-decoration:none;
                padding:12px 18px;border-radius:10px;font-weight:700;">
        ${text}
      </a>
    </div>
  `
}

function baseTemplate(title: string, bodyHtml: string, brandName?: string): string {
  return `
  <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;">
    <div style="background:linear-gradient(135deg,#2B79F7 0%,#1E54B7 60%,#143A80 100%);
                padding:22px 24px;border-radius:14px 14px 0 0;">
      <div style="color:#fff;font-size:18px;font-weight:800;">${escapeHtml(brandName || 'Fokus Kreatives')}</div>
      <div style="color:#E8F1FF;margin-top:6px;font-size:14px;">${title}</div>
    </div>
    <div style="border:1px solid #e5e7eb;border-top:0;border-radius:0 0 14px 14px;
                padding:22px 24px;background:#ffffff;">
      ${bodyHtml}
      <div style="margin-top:18px;color:#9ca3af;font-size:12px;">
        If you didn&rsquo;t expect this email, you can ignore it.
      </div>
    </div>
  </div>
  `
}

// Mirrors the Apps Script buildCalendarBlock: add-to-calendar button row +
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
        'style="display:inline-block;margin:4px 6px 4px 0;padding:8px 14px;' +
        'background:#F3F4F6;color:#111827;text-decoration:none;font-size:12px;' +
        'font-weight:600;border-radius:8px;border:1px solid #E5E7EB;">' +
        label +
        '</a>'
      : ''

  const buttonsHtml =
    '<div style="margin:18px 0;padding:14px 16px;background:#F9FAFB;' +
    'border:1px solid #E5E7EB;border-radius:12px;">' +
    '<div style="font-size:13px;font-weight:600;color:#111827;margin-bottom:8px;">' +
    '📅 Add to your calendar' +
    '</div>' +
    '<div style="font-size:12px;color:#4B5563;margin-bottom:10px;">' +
    'One-click add. Your calendar will handle reminders for you.' +
    '</div>' +
    btn(calendar.googleUrl, 'Google Calendar') +
    btn(calendar.outlookUrl, 'Outlook') +
    btn(calendar.office365Url, 'Office 365') +
    btn(calendar.yahooUrl, 'Yahoo') +
    '<div style="margin-top:8px;font-size:11px;color:#6B7280;">' +
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
    'You have a new invoice',
    '<div style="font-size:14px;color:#111827;">' +
      '<p style="margin:0 0 10px;">Hi ' + escapeHtml(billToName) + ',</p>' +
      '<p style="margin:0 0 12px;">Your invoice' +
      (invoiceNumber ? ' <b>#' + escapeHtml(invoiceNumber) + '</b>' : '') +
      ' is ready to view and pay online.</p>' +
      '<div style="background:#F9FAFB;border-radius:12px;padding:12px 16px;margin-bottom:12px;">' +
      '<p style="margin:0 0 4px;"><b>Amount due:</b> ' + escapeHtml(currency) + ' ' + escapeHtml(amount) + '</p>' +
      (dueDate ? '<p style="margin:0;"><b>Due date:</b> ' + escapeHtml(dueDate) + '</p>' : '') +
      '</div>' +
      (link ? buttonHtml(link, 'View invoice') : '') +
      '</div>',
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

  const linkHtml = link
    ? '<p style="margin:20px 0;"><a href="' + link + '" target="_blank" ' +
      'style="display:inline-block;background:#2B79F7;color:#fff;text-decoration:none;' +
      'padding:12px 22px;border-radius:10px;font-weight:700;">Join meeting</a></p>'
    : ''

  const cal = buildCalendarBlock(payload.calendar as CalendarMeta | undefined)

  const html =
    '<div style="font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px; margin: 0 auto;">' +
    '<h2 style="color:#111827;">You&rsquo;re booked in</h2>' +
    '<p>Hey ' + escapeHtml(attendeeName) + ',</p>' +
    '<p>Your meeting with <strong>' + escapeHtml(clientName) + '</strong> is confirmed' +
    (platform ? ' on <strong>' + escapeHtml(platform) + '</strong>' : '') + '.</p>' +
    '<div style="background:#F9FAFB;border-radius:12px;padding:14px 18px;margin:12px 0;">' +
    '<p style="margin:0 0 6px;"><strong>Title:</strong> ' + escapeHtml(title) + '</p>' +
    (when ? '<p style="margin:0 0 6px;"><strong>When:</strong> ' + escapeHtml(when) + '</p>' : '') +
    (platform ? '<p style="margin:0;"><strong>Platform:</strong> ' + escapeHtml(platform) + '</p>' : '') +
    '</div>' +
    linkHtml +
    cal.buttonsHtml +
    '<p style="color:#6B7280; font-size:12px; margin-top:16px;">See you then.</p>' +
    '</div>'

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

  const linkHtml = link
    ? '<p><a href="' + link + '" target="_blank" style="display:inline-block;background:#2B79F7;color:#fff;text-decoration:none;padding:10px 16px;border-radius:10px;font-weight:700;">Join link</a></p>'
    : ''

  const html =
    '<div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto;">' +
    '<h2 style="color:#111827;">Your meeting has been rescheduled</h2>' +
    '<p><strong>' + escapeHtml(title) + '</strong> with ' + escapeHtml(clientName) + ' has a new time:</p>' +
    '<div style="background:#F9FAFB;border-radius:12px;padding:14px 18px;margin:12px 0;"><strong>' + escapeHtml(when) + '</strong></div>' +
    linkHtml +
    '<p style="font-size:12px;color:#6b7280;">Sent by ' + escapeHtml(fromName || 'Fokus Kreatives') + '</p>' +
    '</div>'

  return { subject: 'Rescheduled: ' + title, html, attachments: [] }
}

// ---------------------------------------------------------------------------

/** Render an outward email type to subject + html + attachments, or null when
 *  the type has no TS template (caller falls back to Apps Script). */
export function renderOutwardEmail(type: string, payload: Payload): RenderedEmail | null {
  switch (type) {
    case 'invoice_sent':
      return invoiceSent(payload)
    case 'meeting_invitee_confirmation':
      return meetingInviteeConfirmation(payload)
    case 'meeting_rescheduled':
      return meetingRescheduled(payload)
    default:
      return null
  }
}
