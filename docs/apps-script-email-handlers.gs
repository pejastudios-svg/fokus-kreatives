// ============================================================================
// FOKUS KREATIVES - APPS SCRIPT (complete, redesigned emails)
//
// Full replacement for Code.gs. Logic (doPost, dedupe, Supabase helpers,
// recipients, cron runners, daily summaries) is identical to the previous
// version; only the email HTML changed.
//
// Design language matches the public agreement and invoice pages: neutral
// background, one white card, small uppercase brand line, hairline rules,
// a single modest pill button. No gradients, no color bands, no em dashes.
// ============================================================================

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      Logger.log('No body in request');
      return ContentService.createTextOutput('No body');
    }

    const body = JSON.parse(e.postData.contents || '{}');
    Logger.log('Raw body: ' + JSON.stringify(body));

    const scriptSecret = PropertiesService.getScriptProperties().getProperty('APPS_SCRIPT_SECRET');
    if (!scriptSecret) {
      Logger.log('Missing APPS_SCRIPT_SECRET in Script Properties');
      return ContentService.createTextOutput('Server misconfigured');
    }

    if (!body.secret || body.secret !== scriptSecret) {
      Logger.log('Invalid secret');
      return ContentService.createTextOutput('Unauthorized');
    }

    

    const type = body.type;
    const payload = body.payload || {};

    // Dedupe: Google sometimes executes doPost twice for one request.
    // Skip identical payloads seen in the last 60s - but never for read-only
    // calls like 'quota', whose body is identical on every legitimate call.
    if (type !== 'quota') {
      try {
        var cache = CacheService.getScriptCache();
        var dedupeKey = 'dp:' + Utilities.base64Encode(
          Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, e.postData.contents)
        );
        if (cache.get(dedupeKey)) {
          Logger.log('Duplicate doPost skipped: ' + (type || ''));
          return ContentService.createTextOutput('OK (duplicate skipped)');
        }
        cache.put(dedupeKey, '1', 60);
      } catch (err) {
        Logger.log('dedupe check failed, continuing: ' + err);
      }
    }


    Logger.log('Incoming type: ' + type);
    Logger.log(JSON.stringify(payload));

    switch (type) {
      case 'test':
        handleTestEmail(payload);
        break;

      case 'payment_created':
        handlePaymentCreated(payload);
        break;

      case 'payment_due':
        handlePaymentDue(payload);
        break;

      case 'meeting_created':
        handleMeetingCreated(payload);
        break;

      case 'meeting_reminder':
        handleMeetingReminder(payload);
        break;

      case 'meeting_rescheduled':
        handleMeetingRescheduled(payload);
        break;

      case 'meeting_invitee_confirmation':
        handleMeetingInviteeConfirmation(payload);
        break;

      case 'capture_submission':
        handleCaptureSubmission(payload);
        break;

      case 'lead_created':
        handleLeadCreated(payload);
        break;

      case 'lead_magnet':
        handleLeadMagnet(payload);
        break;

      case 'workspace_invite':
        handleInviteEmail(payload, 'workspace');
        break;

      case 'crm_invite':
        handleInviteEmail(payload, 'crm');
        break;

      case 'invoice_sent':
        handleInvoiceSent(payload);
        break;

      case 'marketing_email':
        handleMarketingEmail(payload);
        break;

      case 'email_material_low':
        handleEmailMaterialLow(payload);
        break;

      case 'email_upgrade_nudge':
        handleEmailUpgradeNudge(payload);
        break;

      case 'agreement_sent':
        handleAgreementSent(payload);
        break;

      case 'agreement_signed':
        handleAgreementSigned(payload);
        break;

      case 'approval_created':
        handleApprovalCreated(payload);
        break;

      case 'approval_approved':
        handleApprovalApproved(payload);
        break;

      case 'approval_mention':
        handleApprovalMention(payload);
        break;

      case 'approval_reminder':
        handleApprovalReminder(payload);
        break;

      case 'approval_comment':
        handleApprovalComment(payload);
        break;

      case 'approval_comment_resolved':
        handleApprovalCommentResolved(payload);
        break;

      case 'brand_intake_submitted':
        handleBrandIntakeSubmitted(payload);
        break;

      case 'question_form_submitted':
        handleQuestionFormSubmitted(payload);
        break;

      case 'series_form_submitted':
        handleSeriesFormSubmitted(payload);
        break;

      case 'quota':
        return ContentService.createTextOutput(
          JSON.stringify({ remaining: MailApp.getRemainingDailyQuota() })
        );

      default:
        Logger.log('Unknown type: ' + type);
        break;
    }

    return ContentService.createTextOutput('OK');
  } catch (err) {
    Logger.log('doPost error: ' + err);
    return ContentService.createTextOutput('Error: ' + err);
  }
}

function manualMailTest() {
  MailApp.sendEmail({
    to: 'jedidiahbenenoch@gmail.com',
    subject: 'Manual MailApp test',
    htmlBody: '<p>If you see this, MailApp works.</p>'
  })
  Logger.log('Sent')
  Logger.log('Daily quota remaining: ' + MailApp.getRemainingDailyQuota())
}

function quotaProbe() {
  Logger.log('before: ' + MailApp.getRemainingDailyQuota());
  MailApp.sendEmail({
    to: 'fokuskreatives@gmail.com',
    subject: 'quota probe',
    htmlBody: '<p>probe</p>'
  });
  Logger.log('after: ' + MailApp.getRemainingDailyQuota());
}


// ========== SHARED HELPERS ==========

function safeToCsv(to) {
  if (!to) return '';
  if (Array.isArray(to)) return to.filter(Boolean).join(',');
  return String(to);
}

function normalizeRecipients(to) {
  if (!to) return null;
  if (Array.isArray(to)) {
    return to.join(',');
  }
  return to;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function sendHtmlEmail(payload, subject, html) {
  const toCsv = safeToCsv(payload.to)
  if (!toCsv) { Logger.log('Missing payload.to'); return }
  const msg = { to: toCsv, subject: subject, htmlBody: html }
  if (payload.fromName) msg.name = payload.fromName
  if (payload.replyTo) msg.replyTo = payload.replyTo
  MailApp.sendEmail(msg)
}

// ========== EMAIL DESIGN SYSTEM ==========

var EMAIL_FONT = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function buttonHtml(url, text) {
  if (!url) return '';
  return '<div style="margin:24px 0 4px;">' +
    '<a href="' + url + '" target="_blank" ' +
    'style="display:inline-block;background:#2B79F7;color:#ffffff;text-decoration:none;' +
    'padding:10px 22px;border-radius:9999px;font-size:14px;font-weight:600;">' + text + '</a>' +
    '</div>';
}

function paraHtml(text) {
  return '<p style="margin:0 0 12px;font-size:14px;color:#374151;line-height:1.65;">' + text + '</p>';
}

function mutedHtml(text) {
  return '<p style="margin:14px 0 0;font-size:13px;color:#9CA3AF;line-height:1.6;">' + text + '</p>';
}

// Label/value rows separated by hairlines. rows = [['Amount', 'USD 100'], ...]
// Rows with an empty value are skipped.

function factRowsHtml(rows) {
  var filled = (rows || []).filter(function (r) { return r && r[1]; });
  if (filled.length === 0) return '';
  var tr = filled.map(function (r) {
    return '<tr>' +
      '<td style="padding:9px 0;border-bottom:1px solid #F3F4F6;font-size:13px;color:#6B7280;">' + r[0] + '</td>' +
      '<td align="right" style="padding:9px 0;border-bottom:1px solid #F3F4F6;font-size:13px;color:#111827;font-weight:600;">' + r[1] + '</td>' +
      '</tr>';
  }).join('');
  return '<table width="100%" cellpadding="0" cellspacing="0" border="0" ' +
    'style="margin:18px 0 6px;border-collapse:collapse;">' + tr + '</table>';
}

// brandName is optional - outward (white-labeled) emails pass
// payload.fromName so the header shows the client's brand instead
// of Fokus Kreatives. Internal emails keep the default.

function baseTemplate(title, bodyHtml, brandName) {
  var brand = escapeHtml(brandName || 'Fokus Kreatives');
  return '<div style="margin:0;padding:32px 16px;background:#F6F5F4;">' +
    '<div style="max-width:560px;margin:0 auto;font-family:' + EMAIL_FONT + ';">' +
    '<div style="background:#FFFFFF;border:1px solid #E7E5E0;border-radius:12px;padding:30px 34px;">' +
    '<div style="font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#9CA3AF;">' + brand + '</div>' +
    '<div style="margin:14px 0 16px;font-size:18px;font-weight:600;color:#111827;">' + title + '</div>' +
    bodyHtml +
    '<div style="margin-top:24px;padding-top:16px;border-top:1px solid #F3F4F6;font-size:12px;color:#9CA3AF;line-height:1.6;">' +
    'If you did not expect this email, you can ignore it.' +
    '</div>' +
    '</div>' +
    '</div>' +
    '</div>';
}

// ========== MARKETING (CAMPAIGN) EMAILS ==========

// Campaign value emails arrive PRE-RENDERED: the app builds the final html
// per recipient (links wrapped with that recipient's tracking token, the
// unsubscribe footer baked in) so this handler just delivers it. fromName
// and replyTo carry the client's white-label branding as usual.

function handleMarketingEmail(payload) {
  const recipients = normalizeRecipients(payload.to)
  if (!recipients) { Logger.log('handleMarketingEmail: no recipients'); return }
  if (!payload.html) { Logger.log('handleMarketingEmail: no html'); return }

  const msg = {
    to: recipients,
    subject: payload.subject || '(no subject)',
    htmlBody: payload.html,
  }
  if (payload.fromName) msg.name = payload.fromName
  if (payload.replyTo) msg.replyTo = payload.replyTo
  MailApp.sendEmail(msg)
}

// Internal alert: a client's unused form answers are nearly exhausted, so
// AI value emails are about to run out of fresh material. Sent to everyone
// assigned to the client.

function handleEmailMaterialLow(payload) {
  const recipients = normalizeRecipients(payload.to)
  if (!recipients) { Logger.log('handleEmailMaterialLow: no recipients'); return }

  const clientName = payload.clientName || 'A client'
  const remaining = (payload.remaining != null) ? payload.remaining : 0
  const url = payload.url || ''

  const subject = 'Form answers running low for ' + clientName

  const html = baseTemplate(
    'Email material is running low',
    paraHtml('<b>' + escapeHtml(clientName) + '</b> has only <b>' + remaining +
      '</b> unused form answer' + (remaining === 1 ? '' : 's') + ' left for email campaigns.') +
    paraHtml('Once the answers run out, new value emails cannot be generated without repeating old material. Send them a new questions form to keep the emails fresh.') +
    (url ? buttonHtml(url, 'Open client profile') : '')
  )

  MailApp.sendEmail({ to: recipients, subject: subject, htmlBody: html })
}

// Internal alert: a client's list has outgrown free Google sending, so
// campaigns are spreading across multiple days. Nudge the team to move the
// client to Google Workspace (lifts the daily limit to ~2,000).

function handleEmailUpgradeNudge(payload) {
  const recipients = normalizeRecipients(payload.to)
  if (!recipients) { Logger.log('handleEmailUpgradeNudge: no recipients'); return }

  const clientName = payload.clientName || 'A client'
  const dailyMax = (payload.dailyMax != null) ? payload.dailyMax : 120
  const url = payload.url || 'https://workspace.google.com/'

  const html = baseTemplate(
    'Time to upgrade email sending',
    paraHtml('<b>' + escapeHtml(clientName) + '</b> is sending more emails than the free Google plan safely allows (about ' +
      dailyMax + ' a day), so their campaigns are now spreading across several days to avoid being flagged.') +
    paraHtml('Moving them to Google Workspace lifts the limit to roughly 2,000 a day and sends from their own professional email address. Setup takes a few minutes, then reconnect their email under Settings.') +
    (url ? buttonHtml(url, 'See Google Workspace') : '')
  )

  MailApp.sendEmail({ to: recipients, subject: 'Upgrade email sending for ' + clientName, htmlBody: html })
}

// ========== INVOICES ==========

function handleInvoiceSent(payload) {
  const recipients = normalizeRecipients(payload.to)
  if (!recipients) { Logger.log('handleInvoiceSent: no recipients'); return }

  const billToName = payload.billToName || 'there'
  const invoiceNumber = payload.invoiceNumber || ''
  const amount = (payload.amount != null) ? payload.amount : 0
  const currency = payload.currency || 'USD'
  const dueDate = payload.dueDate || ''
  const link = payload.link || ''

  const subject = payload.subject ||
    ('Invoice' + (invoiceNumber ? ' #' + invoiceNumber : '') + ' from ' + (payload.fromName || 'Fokus Kreatives'))

  const html = baseTemplate(
    'Your invoice is ready',
    paraHtml('Hi ' + escapeHtml(billToName) + ',') +
    paraHtml('Your invoice' +
      (invoiceNumber ? ' <b>#' + escapeHtml(invoiceNumber) + '</b>' : '') +
      ' is ready to view and pay online.') +
    factRowsHtml([
      ['Amount due', escapeHtml(currency) + ' ' + amount],
      ['Due date', dueDate ? escapeHtml(dueDate) : ''],
    ]) +
    (link ? buttonHtml(link, 'View invoice') : ''),
    payload.fromName
  )

  sendHtmlEmail(payload, subject, html)
}

// ========== AGREEMENTS ==========

// Delivers a capture page's lead magnet to the person who submitted the form.
// Two flavours, set by the app via payload.magnetType:
//   - 'url':  a button linking to an external resource (link only).
//   - 'file': same button (pointing at the uploaded file's public URL) PLUS
//             the file attached to the email, fetched from payload.attachUrl.
// White-labeled with the client's brand name. Attachment failures degrade
// gracefully to a link-only email so the lead always gets something.

function handleLeadMagnet(payload) {
  var recipients = normalizeRecipients(payload.to)
  if (!recipients) { Logger.log('handleLeadMagnet: no recipients'); return }

  var leadName = payload.leadName || 'there'
  var url = payload.magnetUrl || ''
  var brand = payload.clientName || 'Fokus Kreatives'
  var buttonText = payload.buttonText || 'Access your resource'
  var intro = payload.message
    ? escapeHtml(payload.message)
    : 'Thanks for signing up. Here is the resource you requested.'

  var body =
    paraHtml('Hi ' + escapeHtml(leadName) + ',') +
    paraHtml(intro) +
    (url ? buttonHtml(url, escapeHtml(buttonText)) : '')

  var html = baseTemplate('Your resource from ' + escapeHtml(brand), body, payload.clientName)

  // Attach the uploaded file when one was provided. Capped to keep under
  // Gmail's ~25MB attachment limit; oversize or failed fetches fall back to
  // the link in the email body.
  var attachments = []
  if (payload.attachUrl) {
    try {
      var resp = UrlFetchApp.fetch(payload.attachUrl, { muteHttpExceptions: true, followRedirects: true })
      if (resp.getResponseCode() === 200) {
        var blob = resp.getBlob()
        if (blob.getBytes().length <= 20 * 1024 * 1024) {
          var fname = (payload.fileName || 'resource').replace(/[^\w.\- ]+/g, '').slice(0, 120)
          blob.setName(fname)
          attachments.push(blob)
        } else {
          Logger.log('handleLeadMagnet: file too large to attach, sending link only')
        }
      }
    } catch (e) {
      Logger.log('handleLeadMagnet: attach failed, sending link only: ' + e)
    }
  }

  var subject = payload.subject || ('Your resource from ' + brand)
  var msg = { to: recipients, subject: subject, htmlBody: html }
  // No fromName from the capture route, so brand the sender with the client.
  if (payload.fromName) msg.name = payload.fromName
  else if (payload.clientName) msg.name = payload.clientName
  if (payload.replyTo) msg.replyTo = payload.replyTo
  if (attachments.length) msg.attachments = attachments
  MailApp.sendEmail(msg)
}

function handleAgreementSent(payload) {
  const recipients = normalizeRecipients(payload.to)
  if (!recipients) { Logger.log('handleAgreementSent: no recipients'); return }

  const recipientName = payload.recipientName || 'there'
  const title = payload.title || 'Agreement'
  const link = payload.link || ''
  const fromName = payload.fromName || 'Fokus Kreatives'
  // CC copies carry cc:true - same email, "view" wording, no signing ask.
  const isCc = payload.cc === true

  const subject = payload.subject || (title + ' from ' + fromName)

  const body = isCc
    ? paraHtml('Hi ' + escapeHtml(recipientName) + ',') +
      paraHtml('<b>' + escapeHtml(fromName) + '</b> has shared <b>' +
        escapeHtml(title) + '</b> with you for your records.') +
      (link ? buttonHtml(link, 'View agreement') : '') +
      mutedHtml('No action is needed from you.')
    : paraHtml('Hi ' + escapeHtml(recipientName) + ',') +
      paraHtml('<b>' + escapeHtml(fromName) + '</b> has sent you <b>' +
        escapeHtml(title) + '</b> to review and sign online.') +
      (link ? buttonHtml(link, 'Review and sign') : '') +
      mutedHtml('Signing takes less than a minute. Once signed, a copy is emailed to you automatically.')

  const html = baseTemplate(
    isCc ? 'An agreement was shared with you' : 'You have an agreement to sign',
    body,
    payload.fromName
  )

  sendHtmlEmail(payload, subject, html)
}

function handleAgreementSigned(payload) {
  const recipients = normalizeRecipients(payload.to)
  if (!recipients) { Logger.log('handleAgreementSigned: no recipients'); return }

  const recipientName = payload.recipientName || 'there'
  const title = payload.title || 'Agreement'
  const signerName = payload.signerName || ''
  const signedAt = payload.signedAt || ''
  const link = payload.link || ''
  const invoiceUrl = payload.invoiceUrl || ''

  const subject = payload.subject || ('Signed: ' + title)

  const html = baseTemplate(
    'Agreement signed',
    paraHtml('Hi ' + escapeHtml(recipientName) + ',') +
    paraHtml('<b>' + escapeHtml(title) + '</b> has been signed' +
      (signerName ? ' by <b>' + escapeHtml(signerName) + '</b>' : '') +
      (signedAt ? ' on ' + escapeHtml(signedAt) : '') + '.') +
    (link ? buttonHtml(link, 'View signed agreement') : '') +
    (invoiceUrl
      ? paraHtml('An invoice for this agreement is ready.') + buttonHtml(invoiceUrl, 'View invoice')
      : '') +
    mutedHtml(payload.pdfHtml
      ? 'A PDF copy of the signed agreement is attached for your records.'
      : 'Keep this email for your records. The link above always shows the signed document.'),
    payload.fromName
  )

  // Attach a PDF of the signed agreement when the app provided its HTML.
  // Apps Script renders HTML -> PDF natively (no library needed). Password
  // protected agreements omit pdfHtml on purpose and stay link-only.
  var attachments = []
  if (payload.pdfHtml) {
    try {
      var name = (payload.pdfName || (title + '.pdf')).replace(/[^\w.\- ]+/g, '').slice(0, 120)
      if (name.slice(-4).toLowerCase() !== '.pdf') name += '.pdf'
      var pdf = Utilities.newBlob(payload.pdfHtml, 'text/html', 'agreement.html')
        .getAs('application/pdf')
        .setName(name)
      attachments.push(pdf)
    } catch (e) {
      Logger.log('handleAgreementSigned: PDF build failed, sending without attachment: ' + e)
    }
  }

  var msg = { to: normalizeRecipients(payload.to), subject: subject, htmlBody: html }
  if (payload.fromName) msg.name = payload.fromName
  if (payload.replyTo) msg.replyTo = payload.replyTo
  if (attachments.length) msg.attachments = attachments
  MailApp.sendEmail(msg)
}

// ========== PAYMENTS ==========

function handlePaymentCreated(payload) {
  if (!payload) { Logger.log('handlePaymentCreated: no payload'); return }

  const recipients = normalizeRecipients(payload.to)
  if (!recipients) { Logger.log('handlePaymentCreated: no recipients'); return }

  const amount = payload.amount || 0
  const currency = payload.currency || 'USD'
  const dueDate = payload.dueDate || null
  const clientName = payload.clientName || 'there'

  const subject = payload.subject || 'New payment just got logged for your account'

  const html = baseTemplate(
    'A payment was added to your account',
    paraHtml('Hi ' + escapeHtml(clientName) + ',') +
    paraHtml('A new payment was just added to your CRM.') +
    factRowsHtml([
      ['Amount', escapeHtml(currency) + ' ' + amount],
      ['Due date', dueDate ? escapeHtml(dueDate) : ''],
    ])
  )

  MailApp.sendEmail({ to: recipients, subject: subject, htmlBody: html })
}

function handlePaymentDue(payload) {
  const recipients = normalizeRecipients(payload.to);
  if (!recipients) return;

  const amount = payload.amount || 0;
  const currency = payload.currency || 'USD';
  const dueDate = payload.dueDate || '';
  const clientName = payload.clientName || 'Client';

  const subject = payload.subject || ('Payment due for ' + clientName);

  const html = baseTemplate(
    'Payment due',
    paraHtml('A payment is now due.') +
    factRowsHtml([
      ['Client', escapeHtml(clientName)],
      ['Amount', escapeHtml(currency) + ' ' + amount],
      ['Due date', dueDate ? escapeHtml(dueDate) : ''],
    ])
  )

  MailApp.sendEmail({ to: recipients, subject: subject, htmlBody: html });
}

// ========== MEETINGS ==========

// Helper: turn payload.calendar into HTML links + ics attachment.
// Returns { buttonsHtml, attachments } - caller appends buttons into
// its template and passes attachments to MailApp.sendEmail.
function buildCalendarBlock(payload) {
  const cal = payload.calendar
  if (!cal || !cal.startIso) {
    return { buttonsHtml: '', attachments: [] }
  }

  const btn = (href, label) =>
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
      btn(cal.googleUrl, 'Google Calendar') +
      btn(cal.outlookUrl, 'Outlook') +
      btn(cal.office365Url, 'Office 365') +
      btn(cal.yahooUrl, 'Yahoo') +
      '<div style="margin-top:10px;font-size:12px;color:#9CA3AF;">' +
        'Apple Calendar users: open the attached .ics file.' +
      '</div>' +
    '</div>'

  const icsBlob = Utilities.newBlob(cal.ics, 'text/calendar', 'invite.ics')
  return { buttonsHtml: buttonsHtml, attachments: [icsBlob] }
}

function handleMeetingCreated(payload) {
  const recipients = normalizeRecipients(payload.to)
  if (!recipients) return

  const title = payload.title || 'Meeting'
  const when = payload.when || ''
  const link = payload.link || ''
  const clientName = payload.clientName || 'Client'
  const platform = payload.platform || ''
  const attendeeName = payload.attendeeName || ''
  const attendeeEmail = payload.attendeeEmail || ''

  const platformLabel = platform || 'Manual booking'
  const subject = payload.subject || ('New ' + platformLabel + ' meeting: ' + title)

  var bookedBy = ''
  if (attendeeName || attendeeEmail) {
    bookedBy = escapeHtml(attendeeName || attendeeEmail) +
      (attendeeName && attendeeEmail ? ' (' + escapeHtml(attendeeEmail) + ')' : '')
  }

  const cal = buildCalendarBlock(payload)

  const html = baseTemplate(
    'New meeting scheduled',
    paraHtml('A new meeting has been scheduled' +
      (platform ? ' via <b>' + escapeHtml(platform) + '</b>' : '') + '.') +
    factRowsHtml([
      ['Meeting', escapeHtml(title)],
      ['Client', escapeHtml(clientName)],
      ['When', when ? escapeHtml(when) : ''],
      ['Platform', platform ? escapeHtml(platform) : ''],
      ['Booked by', bookedBy],
    ]) +
    (link ? buttonHtml(link, 'Open meeting link') : '') +
    cal.buttonsHtml
  )

  MailApp.sendEmail({
    to: recipients,
    subject: subject,
    htmlBody: html,
    attachments: cal.attachments,
  })
}

function handleMeetingInviteeConfirmation(payload) {
  const recipients = normalizeRecipients(payload.to)
  if (!recipients) return

  const title = payload.title || 'Meeting'
  const when = payload.when || ''
  const link = payload.link || ''
  const clientName = payload.clientName || 'them'
  const platform = payload.platform || ''
  const attendeeName = payload.attendeeName || 'there'

  const subject = payload.subject || ('Your meeting with ' + clientName + ' is confirmed')

  const cal = buildCalendarBlock(payload)

  const html = baseTemplate(
    'Your meeting is confirmed',
    paraHtml('Hi ' + escapeHtml(attendeeName) + ',') +
    paraHtml('Your meeting with <b>' + escapeHtml(clientName) + '</b> is confirmed.') +
    factRowsHtml([
      ['Meeting', escapeHtml(title)],
      ['When', when ? escapeHtml(when) : ''],
      ['Platform', platform ? escapeHtml(platform) : ''],
    ]) +
    (link ? buttonHtml(link, 'Join meeting') : '') +
    cal.buttonsHtml +
    mutedHtml('See you then.'),
    payload.fromName || (clientName !== 'them' ? clientName : '')
  )

  const msg = { to: recipients, subject: subject, htmlBody: html, attachments: cal.attachments }
  if (payload.fromName) msg.name = payload.fromName
  if (payload.replyTo) msg.replyTo = payload.replyTo
  MailApp.sendEmail(msg)
}

function handleMeetingRescheduled(payload) {
  const recipients = normalizeRecipients(payload.to);
  if (!recipients) return;

  const title = payload.title || 'Your meeting';
  const when = payload.when || '';
  const link = payload.link || '';
  const clientName = payload.clientName || 'the team';

  const html = baseTemplate(
    'Your meeting was rescheduled',
    paraHtml('<b>' + escapeHtml(title) + '</b> with ' + escapeHtml(clientName) + ' has a new time.') +
    factRowsHtml([['New time', when ? escapeHtml(when) : '']]) +
    (link ? buttonHtml(link, 'Join meeting') : ''),
    payload.fromName
  )

  const msg = { to: recipients, subject: 'Rescheduled: ' + title, htmlBody: html }
  if (payload.fromName) msg.name = payload.fromName
  if (payload.replyTo) msg.replyTo = payload.replyTo
  MailApp.sendEmail(msg)
}

function handleMeetingReminder(payload) {
  const recipients = normalizeRecipients(payload.to);
  if (!recipients) return;

  const title = payload.title || 'Meeting';
  const when = payload.when || '';
  const link = payload.link || '';
  const clientName = payload.clientName || 'Client';
  const timing = payload.timing || 'upcoming';

  const subject = payload.subject || ('Reminder: ' + title + ' (' + timing + ')');

  const html = baseTemplate(
    'Meeting reminder',
    paraHtml('You have a meeting ' + escapeHtml(timing) + '.') +
    factRowsHtml([
      ['Meeting', escapeHtml(title)],
      ['Client', escapeHtml(clientName)],
      ['When', when ? escapeHtml(when) : ''],
    ]) +
    (link ? buttonHtml(link, 'Join meeting') : '')
  )

  MailApp.sendEmail({ to: recipients, subject: subject, htmlBody: html });
}

// ========== CAPTURE / LEADS ==========

function handleCaptureSubmission(payload) {
  if (!payload) { Logger.log('handleCaptureSubmission: no payload'); return }

  const recipients = normalizeRecipients(payload.to)
  if (!recipients) { Logger.log('handleCaptureSubmission: no recipients'); return }

  const pageName = payload.pageName || 'Capture page'
  const formData = payload.formData || {}
  const fieldLabels = payload.fieldLabels || {}
  const clientName = payload.clientName || 'there'

  // Build label-aware rows. Falls back to a friendly version of the raw
  // key (e.g. "Meeting date" instead of "meeting_date") so submission
  // keys that aren't in fieldLabels still look readable.
  const skipKeys = ['meeting_date', 'meeting_time']
  const keys = Object.keys(formData).filter(k => skipKeys.indexOf(k) === -1)
  keys.sort()

  function prettyKey(k) {
    return String(k).replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  }

  const rows = keys.map(function (k) {
    const label = fieldLabels[k] || prettyKey(k)
    const raw = formData[k]
    const val = (raw === null || raw === undefined || String(raw) === '')
      ? '-'
      : escapeHtml(String(raw))
    return [escapeHtml(label), val]
  })

  const subject = payload.subject || ('New lead from "' + pageName + '"')

  const html = baseTemplate(
    'New capture page submission',
    paraHtml('Hi ' + escapeHtml(clientName) + ',') +
    paraHtml('Someone just filled out your capture page <b>' + escapeHtml(pageName) + '</b>.') +
    factRowsHtml(rows)
  )

  MailApp.sendEmail({ to: recipients, subject: subject, htmlBody: html })
}

function renderFormTable(formData, fieldLabels) {
  const labels = fieldLabels || {}
  const keys = Object.keys(formData || {})
  keys.sort()

  return keys.map((k) => {
    const label = labels[k] || k
    const v = formData[k]
    const val = (v === null || v === undefined || String(v) === '') ? '-' : String(v)
    return `<tr>
      <td style="padding:6px 10px;border:1px solid #e5e7eb;"><b>${label}</b></td>
      <td style="padding:6px 10px;border:1px solid #e5e7eb;">${val}</td>
    </tr>`
  }).join('')
}

function handleLeadCreated(payload) {
  if (!payload) { Logger.log('handleLeadCreated: no payload'); return }

  const recipients = normalizeRecipients(payload.to)
  if (!recipients) { Logger.log('handleLeadCreated: no recipients'); return }

  const leadName = payload.leadName || 'New Lead'
  const source = payload.source || 'Unknown source'
  const clientName = payload.clientName || 'there'

  const subject = payload.subject || 'You just got a new lead in your CRM'

  const html = baseTemplate(
    'New lead in your CRM',
    paraHtml('Hi ' + escapeHtml(clientName) + ',') +
    paraHtml('You just got a new lead added to your CRM.') +
    factRowsHtml([
      ['Name', escapeHtml(leadName)],
      ['Source', escapeHtml(source)],
    ])
  )

  MailApp.sendEmail({ to: recipients, subject: subject, htmlBody: html })
}

// ========== APPROVALS ==========

function handleApprovalCreated(payload) {
  const clientName = payload.clientName || 'Client';
  const approvalTitle = payload.approvalTitle || payload.title || 'Approval';
  const url = payload.url || '';

  const subject = 'Approval created: ' + approvalTitle;
  const html = baseTemplate(
    'New approval created',
    factRowsHtml([
      ['Client', escapeHtml(clientName)],
      ['Approval', escapeHtml(approvalTitle)],
    ]) +
    buttonHtml(url, 'Open approval')
  );

  sendHtmlEmail(payload, subject, html);
}

function handleApprovalApproved(payload) {
  const clientName = payload.clientName || 'Client';
  const approvalTitle = payload.approvalTitle || payload.title || 'Approval';
  const url = payload.url || '';

  const subject = 'Approved: ' + approvalTitle;
  const html = baseTemplate(
    'Approval approved',
    factRowsHtml([
      ['Client', escapeHtml(clientName)],
      ['Approval', escapeHtml(approvalTitle)],
    ]) +
    buttonHtml(url, 'View approval')
  );

  sendHtmlEmail(payload, subject, html);
}

function handleApprovalMention(payload) {
  const clientName = payload.clientName || 'Client';
  const approvalTitle = payload.approvalTitle || payload.title || 'Approval';
  const url = payload.url || '';
  const commentSnippet = payload.commentSnippet || '';

  const subject = 'You were mentioned: ' + approvalTitle;
  const html = baseTemplate(
    'You were mentioned in a comment',
    paraHtml('You were mentioned in a comment on <b>' + escapeHtml(approvalTitle) +
      '</b> for <b>' + escapeHtml(clientName) + '</b>.') +
    (commentSnippet
      ? paraHtml('<span style="color:#6B7280;">&quot;' + escapeHtml(commentSnippet) + '&quot;</span>')
      : '') +
    buttonHtml(url, 'Open approval')
  );

  sendHtmlEmail(payload, subject, html);
}

function handleApprovalReminder(payload) {
  const clientName = payload.clientName || 'Client';
  const approvalTitle = payload.approvalTitle || payload.title || 'Approval';
  const url = payload.url || '';
  const reminderLabel = payload.reminderLabel || 'Reminder';

  const subject = 'Reminder: ' + approvalTitle;
  const html = baseTemplate(
    'Approval reminder',
    factRowsHtml([
      ['Client', escapeHtml(clientName)],
      ['Approval', escapeHtml(approvalTitle)],
      ['Reminder', escapeHtml(reminderLabel)],
    ]) +
    buttonHtml(url, 'Open approval')
  );

  sendHtmlEmail(payload, subject, html);
}

function handleApprovalComment(payload) {
  const clientName = payload.clientName || 'Someone'
  const approvalTitle = payload.approvalTitle || payload.title || 'Approval'
  const url = payload.url || ''
  const commentSnippet = payload.commentSnippet || ''

  const subject = 'New comment on: ' + approvalTitle
  const html = baseTemplate(
    'New comment on an approval',
    paraHtml('<b>' + escapeHtml(clientName) + '</b> commented on <b>' +
      escapeHtml(approvalTitle) + '</b>.') +
    (commentSnippet
      ? paraHtml('<span style="color:#6B7280;">&quot;' + escapeHtml(commentSnippet) + '&quot;</span>')
      : '') +
    buttonHtml(url, 'Open approval')
  )

  sendHtmlEmail(payload, subject, html)
}

function handleApprovalCommentResolved(payload) {
  const approvalTitle = payload.approvalTitle || payload.title || 'Approval'
  const url = payload.url || ''
  const commentSnippet = payload.commentSnippet || ''

  const subject = 'Resolved: comment on ' + approvalTitle
  const html = baseTemplate(
    'Your comment was resolved',
    paraHtml('Your comment on <b>' + escapeHtml(approvalTitle) + '</b> was marked resolved.') +
    (commentSnippet
      ? paraHtml('<span style="color:#6B7280;">&quot;' + escapeHtml(commentSnippet) + '&quot;</span>')
      : '') +
    buttonHtml(url, 'Open approval')
  )

  sendHtmlEmail(payload, subject, html)
}

// ========== FORMS / INTAKE ==========

function handleBrandIntakeSubmitted(payload) {
  const clientName = payload.clientName || 'A client';
  const businessName = payload.businessName || '';
  const url = payload.url || '';

  const who = businessName ? clientName + ' (' + businessName + ')' : clientName;
  const subject = 'Brand intake submitted: ' + who;

  const html = baseTemplate(
    'Brand intake submitted',
    paraHtml('<b>' + escapeHtml(who) + '</b> just submitted their brand intake form.') +
    paraHtml('Review their profile and kick off content creation.') +
    buttonHtml(url, 'View client profile')
  );

  sendHtmlEmail(payload, subject, html);
}

function handleQuestionFormSubmitted(payload) {
  const clientName = payload.clientName || 'A client';
  const businessName = payload.businessName || '';
  const count = typeof payload.count === 'number' ? payload.count : 0;
  const url = payload.url || '';

  const who = businessName ? clientName + ' (' + businessName + ')' : clientName;
  const subject = count
    ? who + ' answered ' + count + ' braindump question' + (count === 1 ? '' : 's')
    : who + ' submitted a braindump';

  const html = baseTemplate(
    'Question form submitted',
    paraHtml('<b>' + escapeHtml(who) + '</b> just filled out their braindump form' +
      (count ? ' and dropped <b>' + count + '</b> answer' + (count === 1 ? '' : 's') + ' into their topic bank' : '') + '.') +
    paraHtml('Their topics are ready to turn into scripts.') +
    buttonHtml(url, 'Open client profile')
  );

  sendHtmlEmail(payload, subject, html);
}

function handleSeriesFormSubmitted(payload) {
  const clientName = payload.clientName || 'A client';
  const businessName = payload.businessName || '';
  const seriesTitle = payload.seriesTitle || 'a series';
  const count = typeof payload.count === 'number' ? payload.count : 0;
  const url = payload.url || '';

  const who = businessName ? clientName + ' (' + businessName + ')' : clientName;
  const subject = count
    ? who + ' filled out ' + count + ' answer' + (count === 1 ? '' : 's') + ' for "' + seriesTitle + '"'
    : who + ' submitted "' + seriesTitle + '"';

  const html = baseTemplate(
    'Series form submitted',
    paraHtml('<b>' + escapeHtml(who) + '</b> just submitted the series form for <b>' +
      escapeHtml(seriesTitle) + '</b>' +
      (count ? ', with <b>' + count + '</b> per-entry answer' + (count === 1 ? '' : 's') : '') + '.') +
    paraHtml('Open the Series Form tab on the dashboard and click <b>Build prompt</b> on the form to assemble the external prompt from their answers.') +
    buttonHtml(url, 'Open client profile')
  );

  sendHtmlEmail(payload, subject, html);
}

// ========== INVITES ==========

function handleInviteEmail(payload, context) {
  if (!payload) { Logger.log('handleInviteEmail: no payload'); return }

  const recipients = normalizeRecipients(payload.to)
  if (!recipients) { Logger.log('handleInviteEmail: no recipients'); return }

  const inviteeName = payload.inviteeName || 'there'
  const inviterName = payload.inviterName || 'Someone'
  const inviterAvatar = payload.inviterAvatarUrl || ''
  const role = payload.role || ''
  const workspaceName = payload.workspaceName || 'your workspace'
  const acceptUrl = payload.acceptUrl || '#'

  var subtitle = ''
  if (context === 'workspace') {
    subtitle = inviterName + ' invited you to join the Fokus Kreatives workspace.'
  } else if (context === 'crm') {
    subtitle = inviterName + ' invited you to join the client workspace: ' + workspaceName + '.'
  }

  var roleText = role
  if (roleText) {
    roleText = roleText.charAt(0).toUpperCase() + roleText.slice(1).toLowerCase()
  }

  const initial = escapeHtml((inviterName || '?').charAt(0).toUpperCase())

  // Avatar - email-safe (table-based, no flex). Either a real image or a
  // letter fallback rendered in a 44x44 cell that actually centers in Gmail.
  var avatarCell
  if (inviterAvatar) {
    avatarCell =
      '<img src="' + inviterAvatar + '" alt="' + escapeHtml(inviterName) + '" ' +
      'width="44" height="44" ' +
      'style="display:block;width:44px;height:44px;border-radius:44px;object-fit:cover;" />'
  } else {
    avatarCell =
      '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="44" ' +
        'style="border-collapse:collapse;width:44px;height:44px;">' +
        '<tr>' +
          '<td align="center" valign="middle" width="44" height="44" ' +
            'style="width:44px;height:44px;border-radius:44px;' +
            'background-color:#2B79F7;color:#FFFFFF;' +
            'font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:700;' +
            'line-height:44px;text-align:center;mso-line-height-rule:exactly;">' +
            initial +
          '</td>' +
        '</tr>' +
      '</table>'
  }

  const inviterCard =
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ' +
      'style="margin:18px 0 6px;border:1px solid #F3F4F6;border-radius:10px;">' +
      '<tr>' +
        '<td valign="middle" width="60" style="padding:14px 0 14px 16px;">' +
          avatarCell +
        '</td>' +
        '<td valign="middle" style="padding:14px 16px;">' +
          '<div style="color:#111827;font-size:14px;font-weight:600;line-height:1.3;">' +
            escapeHtml(inviterName) +
          '</div>' +
          (roleText
            ? '<div style="margin-top:3px;color:#6B7280;font-size:13px;line-height:1.4;">' +
                'Inviting you as <b style="color:#374151;">' + escapeHtml(roleText) + '</b>' +
              '</div>'
            : ''
          ) +
        '</td>' +
      '</tr>' +
    '</table>'

  const brand = context === 'crm' ? workspaceName : 'Fokus Kreatives'

  const html = baseTemplate(
    'You have been invited',
    paraHtml('Hi ' + escapeHtml(inviteeName) + ',') +
    paraHtml(escapeHtml(subtitle)) +
    inviterCard +
    buttonHtml(acceptUrl, 'Accept invitation'),
    brand
  )

  MailApp.sendEmail({
    to: recipients,
    subject: 'You were invited to join ' + workspaceName,
    htmlBody: html,
  })
}

// ========== TEST ==========

function handleTestEmail(payload) {
  const to = payload.to || Session.getActiveUser().getEmail();
  const subject = payload.subject || 'Fokus Test Email';
  const body = payload.body || 'This is a test email from Fokus Apps Script.';

  MailApp.sendEmail({
    to: to,
    subject: subject,
    htmlBody: baseTemplate('Test email', paraHtml(escapeHtml(body)))
  });
}

// ========== SUPABASE HELPERS ==========

function getSupabaseConfig() {
  const url = PropertiesService.getScriptProperties().getProperty('SUPABASE_URL')
  const key = PropertiesService.getScriptProperties().getProperty('SUPABASE_SERVICE_ROLE_KEY')

  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in Script Properties')
  }

  return { url, key }
}

function supabaseRequest(path, query, method, body) {
  const { url, key } = getSupabaseConfig()

  let fullUrl = url + '/' + path
  if (query) {
    fullUrl += '?' + query
  }

  const options = {
    method: method || 'GET',
    headers: {
      'apikey': key,
      'Authorization': 'Bearer ' + key,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    muteHttpExceptions: true,
  }

  if (body) {
    options.payload = JSON.stringify(body)
  }

  const res = UrlFetchApp.fetch(fullUrl, options)
  const code = res.getResponseCode()
  const text = res.getContentText()

  if (code < 200 || code >= 300) {
    Logger.log('Supabase error ' + code + ' on ' + fullUrl + ': ' + text)
    throw new Error('Supabase error ' + code)
  }

  return JSON.parse(text || '[]')
}

// ===== RECIPIENTS FROM SUPABASE =====

function getNotificationTargetsFromSupabase(clientId) {
  // 1) Load client for name + settings
  const clients = supabaseRequest(
    'clients',
    'select=name,business_name,notification_settings&id=eq.' + encodeURIComponent(clientId)
  )
  if (!clients || clients.length === 0) {
    Logger.log('getNotificationTargetsFromSupabase: no client ' + clientId)
    return {
      clientDisplayName: 'Client',
      notificationSettings: {},
      emails: [],
    }
  }

  const client = clients[0]
  const clientDisplayName = client.business_name || client.name || 'Client'
  const notificationSettings = client.notification_settings || {}

  // 2) Workspace owners (client_id IS NULL, role admin/manager)
  const owners = supabaseRequest(
    'users',
    'select=email,role,client_id&client_id=is.null'
  )

  // 3) CRM team (this client, role client/admin/manager)
  const clientUsers = supabaseRequest(
    'users',
    'select=email,role,client_id&client_id=eq.' + encodeURIComponent(clientId)
  )

  const emailSet = new Set()
  const emails = []

  // Always include workspace owners (admin, manager)
  owners.forEach(function (u) {
    if (!u.email) return
    if (['admin', 'manager'].indexOf(u.role) === -1) return
    if (emailSet.has(u.email)) return
    emailSet.add(u.email)
    emails.push(u.email)
  })

  // If CRM team exists, include them too (client, admin, manager for this client)
  var hasCrmTeam = false
  clientUsers.forEach(function (u) {
    if (['client', 'admin', 'manager'].indexOf(u.role) !== -1) {
      hasCrmTeam = true
    }
  })

  if (hasCrmTeam) {
    clientUsers.forEach(function (u) {
      if (!u.email) return
      if (['client', 'admin', 'manager'].indexOf(u.role) === -1) return
      if (emailSet.has(u.email)) return
      emailSet.add(u.email)
      emails.push(u.email)
    })
  }

  return { clientDisplayName, notificationSettings, emails }
}

// ========== CRON RUNNERS ==========

function drainEmailOutbox() {
  const props = PropertiesService.getScriptProperties()
  const appUrl = props.getProperty('APP_URL')
  const cronSecret = props.getProperty('CRON_SECRET')

  if (!appUrl || !cronSecret) {
    Logger.log('Missing APP_URL or CRON_SECRET in Script Properties')
    return
  }

  const url = `${appUrl}/api/cron/send-emails?secret=${encodeURIComponent(cronSecret)}`
  try {
    const res = UrlFetchApp.fetch(url, { method: 'get', muteHttpExceptions: true })
    Logger.log('drainEmailOutbox: ' + res.getResponseCode() + ' ' + res.getContentText())
  } catch (e) {
    Logger.log('drainEmailOutbox failed: ' + e)
  }
}

// Email campaigns worker (Emails tab): generates upcoming drafts and
// dispatches due campaign emails. Add a time trigger every 5-10 minutes.
function runEmailCampaignsCron() {
  const props = PropertiesService.getScriptProperties()
  const appUrl = props.getProperty('APP_URL')
  const cronSecret = props.getProperty('CRON_SECRET')
  if (!appUrl || !cronSecret) {
    Logger.log('Missing APP_URL or CRON_SECRET in Script Properties')
    return
  }
  const url = appUrl + '/api/cron/email-campaigns?secret=' + encodeURIComponent(cronSecret)
  try {
    const res = UrlFetchApp.fetch(url, { method: 'get', muteHttpExceptions: true })
    Logger.log('runEmailCampaignsCron: ' + res.getResponseCode() + ' ' + res.getContentText())
  } catch (e) {
    Logger.log('runEmailCampaignsCron failed: ' + e)
  }
}

// Recently Deleted purge (Agreements): hard-deletes agreements soft-deleted
// 30+ days ago. Add a daily time trigger.
function runAgreementsPurge() {
  const props = PropertiesService.getScriptProperties()
  const appUrl = props.getProperty('APP_URL')
  const cronSecret = props.getProperty('CRON_SECRET')
  if (!appUrl || !cronSecret) {
    Logger.log('Missing APP_URL or CRON_SECRET in Script Properties')
    return
  }
  const url = appUrl + '/api/cron/purge-agreements?secret=' + encodeURIComponent(cronSecret)
  try {
    const res = UrlFetchApp.fetch(url, { method: 'get', muteHttpExceptions: true })
    Logger.log('runAgreementsPurge: ' + res.getResponseCode() + ' ' + res.getContentText())
  } catch (e) {
    Logger.log('runAgreementsPurge failed: ' + e)
  }
}

function dispatchInvoices() {
  const props = PropertiesService.getScriptProperties()
  const appUrl = props.getProperty('APP_URL')
  const cronSecret = props.getProperty('CRON_SECRET')
  if (!appUrl || !cronSecret) {
    Logger.log('Missing APP_URL or CRON_SECRET in Script Properties')
    return
  }
  const url = appUrl + '/api/cron/dispatch-invoices?secret=' + encodeURIComponent(cronSecret)
  try {
    const res = UrlFetchApp.fetch(url, { method: 'get', muteHttpExceptions: true })
    Logger.log('dispatchInvoices: ' + res.getResponseCode() + ' ' + res.getContentText())
  } catch (e) {
    Logger.log('dispatchInvoices failed: ' + e)
  }
}

function runApprovalsCron() {
  const props = PropertiesService.getScriptProperties()
  const appUrl = props.getProperty('APP_URL') // e.g. https://fokus-kreatives.vercel.app
  const cronSecret = props.getProperty('CRON_SECRET')

  if (!appUrl || !cronSecret) {
    Logger.log('Missing APP_URL or CRON_SECRET in Script Properties')
    return
  }

  const endpoints = [
    `${appUrl}/api/approvals/remind?secret=${encodeURIComponent(cronSecret)}`,
    `${appUrl}/api/approvals/auto-approve?secret=${encodeURIComponent(cronSecret)}`
  ]

  for (var i = 0; i < endpoints.length; i++) {
    try {
      const res = UrlFetchApp.fetch(endpoints[i], { muteHttpExceptions: true })
      Logger.log('Cron call: ' + endpoints[i])
      Logger.log('Status: ' + res.getResponseCode())
      Logger.log('Body: ' + res.getContentText())
    } catch (e) {
      Logger.log('Cron call failed: ' + endpoints[i] + ' err=' + e)
    }
  }
}

// ========== DAILY SUMMARIES ==========

function sendDailyMeetingSummary() {
  try {
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const tomorrowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)

    const fromIso = todayStart.toISOString()
    const toIso = tomorrowStart.toISOString()

    // Load today's scheduled meetings
    const meetings = supabaseRequest(
      'meetings',
      [
        'select=client_id,title,date_time,location_url,status',
        'status=eq.scheduled',
        'date_time=gte.' + encodeURIComponent(fromIso),
        'date_time=lt.' + encodeURIComponent(toIso),
      ].join('&')
    )

    if (!meetings || meetings.length === 0) {
      Logger.log('sendDailyMeetingSummary: no meetings today')
      return
    }

    // Group by client_id
    const byClient = {}
    meetings.forEach(function (m) {
      if (!m.client_id) return
      const cid = m.client_id
      if (!byClient[cid]) byClient[cid] = []
      byClient[cid].push(m)
    })

    for (var clientId in byClient) {
      var clientMeetings = byClient[clientId]
      if (!clientMeetings || clientMeetings.length === 0) continue

      var targets = getNotificationTargetsFromSupabase(clientId)
      var emails = targets.emails
      var ns = targets.notificationSettings || {}

      // Respect meeting notifications toggle
      var meetingsEnabled = (ns.meetings !== false)
      if (!meetingsEnabled) {
        Logger.log('sendDailyMeetingSummary: meetings disabled for client ' + clientId)
        continue
      }

      if (!emails || emails.length === 0) {
        Logger.log('sendDailyMeetingSummary: no emails for client ' + clientId)
        continue
      }

      var rows = clientMeetings.map(function (m) {
        var dt = new Date(m.date_time)
        var when = dt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
        var label = escapeHtml(m.title || 'Untitled') +
          (m.location_url
            ? ' &middot; <a href="' + m.location_url + '" style="color:#2B79F7;text-decoration:none;">Join link</a>'
            : '')
        return [when, label]
      })

      var html = baseTemplate(
        "Today's meetings",
        paraHtml("Here's your meeting schedule for today (" + escapeHtml(todayStart.toDateString()) + ').') +
        factRowsHtml(rows)
      )

      var subject = "Today's meetings for " + targets.clientDisplayName

      MailApp.sendEmail({
        to: emails.join(','),
        subject: subject,
        htmlBody: html,
      })
    }

  } catch (err) {
    Logger.log('sendDailyMeetingSummary error: ' + err)
  }
}

function sendDailyPaymentSummary() {
  try {
    const now = new Date()
    const todayYmd = now.toISOString().split('T')[0]

    // Load pending + overdue payments
    const payments = supabaseRequest(
      'payments',
      [
        'select=client_id,amount,currency,status,due_date',
        'status=in.(pending,overdue)'
      ].join('&')
    )

    if (!payments || payments.length === 0) {
      Logger.log('sendDailyPaymentSummary: no pending/overdue payments')
      return
    }

    // Filter in JS: due today or overdue
    const relevant = payments.filter(function (p) {
      if (!p.due_date) return false
      var due = p.due_date // assume YYYY-MM-DD
      return due <= todayYmd // today or earlier = overdue
    })

    if (relevant.length === 0) {
      Logger.log('sendDailyPaymentSummary: no due/overdue today')
      return
    }

    // Group by client_id
    const byClient = {}
    relevant.forEach(function (p) {
      if (!p.client_id) return
      const cid = p.client_id
      if (!byClient[cid]) byClient[cid] = []
      byClient[cid].push(p)
    })

    for (var clientId in byClient) {
      var clientPayments = byClient[clientId]
      if (!clientPayments || clientPayments.length === 0) continue

      var targets = getNotificationTargetsFromSupabase(clientId)
      var emails = targets.emails

      if (!emails || emails.length === 0) {
        Logger.log('sendDailyPaymentSummary: no emails for client ' + clientId)
        continue
      }

      var rows = clientPayments.map(function (p) {
        var label = escapeHtml(p.status || 'pending') +
          (p.due_date ? ' &middot; due ' + escapeHtml(p.due_date) : '')
        return [label, escapeHtml(p.currency || 'USD') + ' ' + p.amount]
      })

      var html = baseTemplate(
        'Payments due or overdue',
        paraHtml('Here are the payments that are due or overdue as of ' + escapeHtml(todayYmd) + '.') +
        factRowsHtml(rows)
      )

      var subject = 'Payments due/overdue for ' + targets.clientDisplayName

      MailApp.sendEmail({
        to: emails.join(','),
        subject: subject,
        htmlBody: html,
      })
    }

  } catch (err) {
    Logger.log('sendDailyPaymentSummary error: ' + err)
  }
}


// ========== MISC UTILITIES ==========

function objectToRows(obj) {
  if (!obj || typeof obj !== 'object') return ''
  const skip = new Set(['meeting_date','meeting_time'])
  return Object.keys(obj)
    .filter(k => !skip.has(k))
    .map(k => {
      const v = obj[k]
      const val = (v === null || v === undefined) ? '' : String(v)
      return `<tr><td style="padding:6px 10px;border:1px solid #e5e7eb;"><b>${k}</b></td><td style="padding:6px 10px;border:1px solid #e5e7eb;">${val}</td></tr>`
    })
    .join('')
}
