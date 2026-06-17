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

      case 'workspace_invite':
        handleInviteEmail(payload, 'workspace');
        break;

      case 'crm_invite':
        handleInviteEmail(payload, 'crm');
        break;

      case 'invoice_sent':
        handleInvoiceSent(payload);
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

function buttonHtml(url, text) {
  if (!url) return '';
  return `
    <div style="margin: 18px 0;">
      <a href="${url}" target="_blank"
         style="display:inline-block;background:#2B79F7;color:#fff;text-decoration:none;
                padding:12px 18px;border-radius:10px;font-weight:700;">
        ${text}
      </a>
    </div>
  `;
}

// brandName is optional - outward (white-labeled) emails pass
// payload.fromName so the header shows the client's brand instead
// of Fokus Kreatives. Internal emails keep the default.
function baseTemplate(title, bodyHtml, brandName) {
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
        If you didn’t expect this email, you can ignore it.
      </div>
    </div>
  </div>
  `;
}

// White-label aware sender: when the payload carries fromName/replyTo
// (attached server-side for outward emails only), the email displays the
// client's name as the sender and replies go to the client.
function sendHtmlEmail(payload, subject, html) {
  const toCsv = safeToCsv(payload.to)
  if (!toCsv) { Logger.log('Missing payload.to'); return }
  const msg = { to: toCsv, subject: subject, htmlBody: html }
  if (payload.fromName) msg.name = payload.fromName
  if (payload.replyTo) msg.replyTo = payload.replyTo
  MailApp.sendEmail(msg)
}

// ========== APPROVALS ==========

function handleApprovalComment(payload) {
  const clientName = payload.clientName || 'Someone'
  const approvalTitle = payload.approvalTitle || payload.title || 'Approval'
  const url = payload.url || ''
  const commentSnippet = payload.commentSnippet || ''

  const subject = `New comment on: ${approvalTitle}`
  const html = baseTemplate(
    'New comment on an approval',
    `
      <div style="font-size:14px;color:#111827;">
        <div><b>${escapeHtml(clientName)}</b> commented on <b>${escapeHtml(approvalTitle)}</b>.</div>
        ${commentSnippet ? `<div style="margin-top:10px;color:#374151;"><b>Comment:</b><br/>"${escapeHtml(commentSnippet)}"</div>` : ''}
        ${buttonHtml(url, 'Open approval')}
      </div>
    `
  )

  sendHtmlEmail(payload, subject, html)
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


function handleApprovalCommentResolved(payload) {
  const clientName = payload.clientName || 'Client'
  const approvalTitle = payload.approvalTitle || payload.title || 'Approval'
  const url = payload.url || ''
  const commentSnippet = payload.commentSnippet || ''

  const subject = `Resolved: comment on ${approvalTitle}`
  const html = baseTemplate(
    'A comment you wrote was marked resolved',
    `
      <div style="font-size:14px;color:#111827;">
        <div>Your comment on <b>${escapeHtml(approvalTitle)}</b> was marked resolved.</div>
        ${commentSnippet ? `<div style="margin-top:10px;color:#374151;"><b>Your comment:</b><br/>"${escapeHtml(commentSnippet)}"</div>` : ''}
        ${buttonHtml(url, 'Open approval')}
      </div>
    `
  )

  sendHtmlEmail(payload, subject, html)
}

function handleApprovalCreated(payload) {
  const clientName = payload.clientName || 'Client';
  const approvalTitle = payload.approvalTitle || payload.title || 'Approval';
  const url = payload.url || '';

  const subject = `Approval created: ${approvalTitle}`;
  const html = baseTemplate(
    'New approval created',
    `
      <div style="font-size:14px;color:#111827;">
        <div><b>Client:</b> ${clientName}</div>
        <div style="margin-top:6px;"><b>Approval:</b> ${approvalTitle}</div>
        ${buttonHtml(url, 'Open approval')}
      </div>
    `
  );

  sendHtmlEmail(payload, subject, html);
}

function handleApprovalApproved(payload) {
  const clientName = payload.clientName || 'Client';
  const approvalTitle = payload.approvalTitle || payload.title || 'Approval';
  const url = payload.url || '';

  const subject = `Approved: ${approvalTitle}`;
  const html = baseTemplate(
    'Approval approved',
    `
      <div style="font-size:14px;color:#111827;">
        <div><b>Client:</b> ${clientName}</div>
        <div style="margin-top:6px;"><b>Approval:</b> ${approvalTitle}</div>
        ${buttonHtml(url, 'View approval')}
      </div>
    `
  );

  sendHtmlEmail(payload, subject, html);
}

function handleApprovalMention(payload) {
  const clientName = payload.clientName || 'Client';
  const approvalTitle = payload.approvalTitle || payload.title || 'Approval';
  const url = payload.url || '';
  const commentSnippet = payload.commentSnippet || '';

  const subject = `You were mentioned: ${approvalTitle}`;
  const html = baseTemplate(
    'You were mentioned in an approval comment',
    `
      <div style="font-size:14px;color:#111827;">
        <div><b>Client:</b> ${clientName}</div>
        <div style="margin-top:6px;"><b>Approval:</b> ${approvalTitle}</div>
        ${commentSnippet ? `<div style="margin-top:10px;color:#374151;"><b>Comment:</b><br/>"${commentSnippet}"</div>` : ''}
        ${buttonHtml(url, 'Open approval')}
      </div>
    `
  );

  sendHtmlEmail(payload, subject, html);
}

function handleApprovalReminder(payload) {
  const clientName = payload.clientName || 'Client';
  const approvalTitle = payload.approvalTitle || payload.title || 'Approval';
  const url = payload.url || '';
  const reminderLabel = payload.reminderLabel || 'Reminder';

  const subject = `Reminder: ${approvalTitle}`;
  const html = baseTemplate(
    'Approval reminder',
    `
      <div style="font-size:14px;color:#111827;">
        <div><b>Client:</b> ${clientName}</div>
        <div style="margin-top:6px;"><b>Approval:</b> ${approvalTitle}</div>
        <div style="margin-top:10px;color:#374151;"><b>Reminder:</b> ${reminderLabel}</div>
        ${buttonHtml(url, 'Open approval')}
      </div>
    `
  );

  sendHtmlEmail(payload, subject, html);
}

// ========== FORMS / INTAKE ==========

function handleBrandIntakeSubmitted(payload) {
  const clientName = payload.clientName || 'A client';
  const businessName = payload.businessName || '';
  const url = payload.url || '';

  const who = businessName ? `${clientName} (${businessName})` : clientName;
  const subject = `Brand intake submitted: ${who}`;

  const html = baseTemplate(
    'Brand intake submitted',
    `
      <div style="font-size:14px;color:#111827;">
        <p style="margin:0 0 10px;"><b>${escapeHtml(who)}</b> just submitted their brand intake form.</p>
        <p style="margin:0;color:#4B5563;">Review their profile and kick off content creation.</p>
        ${buttonHtml(url, 'View client profile')}
      </div>
    `
  );

  sendHtmlEmail(payload, subject, html);
}

function handleQuestionFormSubmitted(payload) {
  const clientName = payload.clientName || 'A client';
  const businessName = payload.businessName || '';
  const count = typeof payload.count === 'number' ? payload.count : 0;
  const url = payload.url || '';

  const who = businessName ? `${clientName} (${businessName})` : clientName;
  const subject = count
    ? `${who} answered ${count} braindump question${count === 1 ? '' : 's'}`
    : `${who} submitted a braindump`;

  const html = baseTemplate(
    'Question form submitted',
    `
      <div style="font-size:14px;color:#111827;">
        <p style="margin:0 0 10px;"><b>${escapeHtml(who)}</b> just filled out their braindump form${count ? ` and dropped <b>${count}</b> answer${count === 1 ? '' : 's'} into their topic bank` : ''}.</p>
        <p style="margin:0;color:#4B5563;">Their topics are ready to turn into scripts.</p>
        ${buttonHtml(url, 'Open client profile')}
      </div>
    `
  );

  sendHtmlEmail(payload, subject, html);
}

function handleSeriesFormSubmitted(payload) {
  const clientName = payload.clientName || 'A client';
  const businessName = payload.businessName || '';
  const seriesTitle = payload.seriesTitle || 'a series';
  const count = typeof payload.count === 'number' ? payload.count : 0;
  const url = payload.url || '';

  const who = businessName ? `${clientName} (${businessName})` : clientName;
  const subject = count
    ? `${who} filled out ${count} answer${count === 1 ? '' : 's'} for "${seriesTitle}"`
    : `${who} submitted "${seriesTitle}"`;

  const html = baseTemplate(
    'Series form submitted',
    `
      <div style="font-size:14px;color:#111827;">
        <p style="margin:0 0 10px;"><b>${escapeHtml(who)}</b> just submitted the series form for <b>${escapeHtml(seriesTitle)}</b>${count ? `, with <b>${count}</b> per-entry answer${count === 1 ? '' : 's'}` : ''}.</p>
        <p style="margin:0;color:#4B5563;">Open the Series Form tab on the dashboard and click <b>Build prompt</b> on the form to assemble the external prompt from their answers.</p>
        ${buttonHtml(url, 'Open client profile')}
      </div>
    `
  );

  sendHtmlEmail(payload, subject, html);
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
    'You have a new invoice',
    '<div style="font-size:14px;color:#111827;">' +
      '<p style="margin:0 0 10px;">Hi ' + escapeHtml(billToName) + ',</p>' +
      '<p style="margin:0 0 12px;">Your invoice' +
        (invoiceNumber ? ' <b>#' + escapeHtml(invoiceNumber) + '</b>' : '') +
        ' is ready to view and pay online.</p>' +
      '<div style="background:#F9FAFB;border-radius:12px;padding:12px 16px;margin-bottom:12px;">' +
        '<p style="margin:0 0 4px;"><b>Amount due:</b> ' + escapeHtml(currency) + ' ' + amount + '</p>' +
        (dueDate ? '<p style="margin:0;"><b>Due date:</b> ' + escapeHtml(dueDate) + '</p>' : '') +
      '</div>' +
      (link ? buttonHtml(link, 'View invoice') : '') +
    '</div>',
    payload.fromName
  )

  sendHtmlEmail(payload, subject, html)
}

// ========== AGREEMENTS ==========

function handleAgreementSent(payload) {
  const recipients = normalizeRecipients(payload.to)
  if (!recipients) { Logger.log('handleAgreementSent: no recipients'); return }

  const recipientName = payload.recipientName || 'there'
  const title = payload.title || 'Agreement'
  const link = payload.link || ''
  const fromName = payload.fromName || 'Fokus Kreatives'

  const subject = payload.subject || (title + ' from ' + fromName)

  const html = baseTemplate(
    'You have an agreement to review and sign',
    '<div style="font-size:14px;color:#111827;">' +
      '<p style="margin:0 0 10px;">Hi ' + escapeHtml(recipientName) + ',</p>' +
      '<p style="margin:0 0 12px;"><b>' + escapeHtml(fromName) + '</b> has sent you <b>' +
        escapeHtml(title) + '</b> to review and sign online.</p>' +
      buttonHtml(link, 'Review and sign') +
      '<p style="margin:12px 0 0;color:#6B7280;font-size:13px;">Signing takes less than a minute. ' +
        'Once signed, a copy is emailed to you automatically.</p>' +
    '</div>',
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

  const subject = payload.subject || ('Signed: ' + title)

  const html = baseTemplate(
    'Agreement signed',
    '<div style="font-size:14px;color:#111827;">' +
      '<p style="margin:0 0 10px;">Hi ' + escapeHtml(recipientName) + ',</p>' +
      '<p style="margin:0 0 12px;"><b>' + escapeHtml(title) + '</b> has been signed' +
        (signerName ? ' by <b>' + escapeHtml(signerName) + '</b>' : '') +
        (signedAt ? ' on ' + escapeHtml(signedAt) : '') + '.</p>' +
      buttonHtml(link, 'View signed agreement') +
      '<p style="margin:12px 0 0;color:#6B7280;font-size:13px;">Keep this email for your records. ' +
        'The link above always shows the signed document.</p>' +
    '</div>',
    payload.fromName
  )

  sendHtmlEmail(payload, subject, html)
}

// ========== PAYMENTS ==========

function handlePaymentCreated(payload) {
  if (!payload) {
    Logger.log('handlePaymentCreated: no payload')
    return
  }

  const recipients = normalizeRecipients(payload.to)
  if (!recipients) {
    Logger.log('handlePaymentCreated: no recipients')
    return
  }

  const amount = payload.amount || 0
  const currency = payload.currency || 'USD'
  const dueDate = payload.dueDate || null
  const clientName = payload.clientName || 'there'

  const subject =
    payload.subject || `New payment just got logged for your account`

  const dueText = dueDate
    ? 'Due date: <strong>' + escapeHtml(dueDate) + '</strong>'
    : 'No due date set yet.'

  const html =
    '<div style="font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px; margin: 0 auto;">' +
      '<h2 style="color:#111827; margin-bottom:8px;">Hey ' + escapeHtml(clientName) + ',</h2>' +
      '<p style="color:#111827; margin:0 0 12px;">A new payment was just added to your CRM.</p>' +
      '<div style="background:#F9FAFB; border-radius:12px; padding:12px 16px; margin-bottom:12px;">' +
        '<p style="margin:0 0 4px;"><strong>Amount:</strong> ' + escapeHtml(currency) + ' ' + amount + '</p>' +
        '<p style="margin:0 0 4px;">' + dueText + '</p>' +
      '</div>' +
      '<p style="color:#6B7280; font-size:12px; margin-top:16px;">Sent by Fokus Kreatives</p>' +
    '</div>'

  MailApp.sendEmail({
    to: recipients,
    subject: subject,
    htmlBody: html,
  })
}

function handlePaymentDue(payload) {
  const recipients = normalizeRecipients(payload.to);
  if (!recipients) return;

  const amount = payload.amount || 0;
  const currency = payload.currency || 'USD';
  const dueDate = payload.dueDate || '';
  const clientName = payload.clientName || 'Client';

  const subject = payload.subject || ('Payment due for ' + clientName);
  const html =
    '<div style="font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px; margin: 0 auto;">' +
      '<h2 style="color:#b91c1c;">Payment Due Reminder</h2>' +
      '<p>A payment is now due.</p>' +
      '<ul>' +
        '<li><strong>Client:</strong> ' + escapeHtml(clientName) + '</li>' +
        '<li><strong>Amount:</strong> ' + currency + ' ' + amount + '</li>' +
        '<li><strong>Due date:</strong> ' + dueDate + '</li>' +
      '</ul>' +
      '<p style="font-size:12px;color:#6b7280;">Sent by Fokus Kreatives</p>' +
    '</div>';

  MailApp.sendEmail({
    to: recipients,
    subject: subject,
    htmlBody: html
  });
}

// ========== MEETINGS ==========

// Helper: turn payload.calendar into HTML button row + ics attachment.
// Returns { buttonsHtml, attachments } — caller appends buttons into
// its template and passes attachments to MailApp.sendEmail.
function buildCalendarBlock(payload) {
  const cal = payload.calendar
  if (!cal || !cal.startIso) {
    return { buttonsHtml: '', attachments: [] }
  }

  const btn = (href, label) =>
    '<a href="' + href + '" target="_blank" ' +
      'style="display:inline-block;margin:4px 6px 4px 0;padding:8px 14px;' +
      'background:#F3F4F6;color:#111827;text-decoration:none;font-size:12px;' +
      'font-weight:600;border-radius:8px;border:1px solid #E5E7EB;">' +
      label +
    '</a>'

  const buttonsHtml =
    '<div style="margin:18px 0;padding:14px 16px;background:#F9FAFB;' +
      'border:1px solid #E5E7EB;border-radius:12px;">' +
      '<div style="font-size:13px;font-weight:600;color:#111827;margin-bottom:8px;">' +
        '📅 Add to your calendar' +
      '</div>' +
      '<div style="font-size:12px;color:#4B5563;margin-bottom:10px;">' +
        'One-click add. Your calendar will handle reminders for you.' +
      '</div>' +
      btn(cal.googleUrl, 'Google Calendar') +
      btn(cal.outlookUrl, 'Outlook') +
      btn(cal.office365Url, 'Office 365') +
      btn(cal.yahooUrl, 'Yahoo') +
      '<div style="margin-top:8px;font-size:11px;color:#6B7280;">' +
        'Apple Calendar users: open the attached .ics file.' +
      '</div>' +
    '</div>'

  // ICS as a downloadable / clickable attachment. Apple Calendar +
  // Outlook desktop open it natively.
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

  var linkHtml = ''
  if (link) {
    linkHtml = '<p><a href="' + link + '" target="_blank" ' +
      'style="display:inline-block;background:#2B79F7;color:#fff;text-decoration:none;' +
      'padding:10px 16px;border-radius:10px;font-weight:700;">Open meeting link</a></p>'
  }

  var attendeeHtml = ''
  if (attendeeName || attendeeEmail) {
    attendeeHtml =
      '<li><strong>Booked by:</strong> ' +
        escapeHtml(attendeeName || attendeeEmail) +
        (attendeeName && attendeeEmail
          ? ' (<a href="mailto:' + attendeeEmail + '">' + escapeHtml(attendeeEmail) + '</a>)'
          : '') +
      '</li>'
  }

  const cal = buildCalendarBlock(payload)

  const html =
    '<div style="font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px; margin: 0 auto;">' +
      '<h2 style="color:#111827;">New Meeting Scheduled</h2>' +
      '<p>A new meeting has been scheduled' + (platform ? ' via <strong>' + escapeHtml(platform) + '</strong>' : '') + '.</p>' +
      '<ul>' +
        '<li><strong>Title:</strong> ' + escapeHtml(title) + '</li>' +
        '<li><strong>Client:</strong> ' + escapeHtml(clientName) + '</li>' +
        (when ? '<li><strong>When:</strong> ' + escapeHtml(when) + '</li>' : '') +
        (platform ? '<li><strong>Platform:</strong> ' + escapeHtml(platform) + '</li>' : '') +
        attendeeHtml +
      '</ul>' +
      linkHtml +
      cal.buttonsHtml +
      '<p style="font-size:12px;color:#6b7280;">Sent by Fokus Kreativez</p>' +
    '</div>'

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

  var linkHtml = ''
  if (link) {
    linkHtml =
      '<p style="margin:20px 0;"><a href="' + link + '" target="_blank" ' +
        'style="display:inline-block;background:#2B79F7;color:#fff;text-decoration:none;' +
        'padding:12px 22px;border-radius:10px;font-weight:700;">Join meeting</a></p>'
  }

  const cal = buildCalendarBlock(payload)

  const html =
    '<div style="font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px; margin: 0 auto;">' +
      '<h2 style="color:#111827;">You\'re booked in</h2>' +
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
  var linkHtml = link ? '<p><a href="' + link + '" target="_blank" style="display:inline-block;background:#2B79F7;color:#fff;text-decoration:none;padding:10px 16px;border-radius:10px;font-weight:700;">Join link</a></p>' : '';
  var html =
    '<div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto;">' +
      '<h2 style="color:#111827;">Your meeting has been rescheduled</h2>' +
      '<p><strong>' + escapeHtml(title) + '</strong> with ' + escapeHtml(clientName) + ' has a new time:</p>' +
      '<div style="background:#F9FAFB;border-radius:12px;padding:14px 18px;margin:12px 0;"><strong>' + escapeHtml(when) + '</strong></div>' +
      linkHtml +
      '<p style="font-size:12px;color:#6b7280;">Sent by ' + escapeHtml(payload.fromName || 'Fokus Kreatives') + '</p>' +
    '</div>';

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
  var linkHtml = '';
  if (link) {
    linkHtml = '<p><a href="' + link + '">Join meeting</a></p>';
  }

  const html =
    '<div style="font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px; margin: 0 auto;">' +
      '<h2 style="color:#111827;">Meeting Reminder</h2>' +
      '<p>You have a meeting ' + escapeHtml(timing) + '.</p>' +
      '<ul>' +
        '<li><strong>Title:</strong> ' + escapeHtml(title) + '</li>' +
        '<li><strong>Client:</strong> ' + escapeHtml(clientName) + '</li>' +
        (when ? '<li><strong>When:</strong> ' + escapeHtml(when) + '</li>' : '') +
      '</ul>' +
      linkHtml +
      '<p style="font-size:12px;color:#6b7280;">Sent by Fokus Kreatives</p>' +
    '</div>';

  MailApp.sendEmail({
    to: recipients,
    subject: subject,
    htmlBody: html
  });
}

// ========== CAPTURE / LEADS ==========

function handleCaptureSubmission(payload) {
  if (!payload) {
    Logger.log('handleCaptureSubmission: no payload')
    return
  }

  const recipients = normalizeRecipients(payload.to)
  if (!recipients) {
    Logger.log('handleCaptureSubmission: no recipients')
    return
  }

  const pageName = payload.pageName || 'Capture page'
  const slug = payload.slug || ''
  const formData = payload.formData || {}
  const fieldLabels = payload.fieldLabels || {}
  const clientName = payload.clientName || 'there'

  // Build label-aware bullet list. Falls back to a friendly version
  // of the raw key (e.g. "Meeting date" instead of "meeting_date") so
  // submission keys that aren't in fieldLabels still look readable.
  const skipKeys = ['meeting_date', 'meeting_time']
  const keys = Object.keys(formData).filter(k => !skipKeys.includes(k))
  keys.sort()

  function prettyKey(k) {
    return String(k).replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  }

  var rowsHtml = ''
  keys.forEach(function (k) {
    const label = fieldLabels[k] || prettyKey(k)
    const raw = formData[k]
    const val = (raw === null || raw === undefined || String(raw) === '')
      ? '—'
      : escapeHtml(String(raw))
    rowsHtml +=
      '<tr>' +
        '<td style="padding:8px 12px;border:1px solid #e5e7eb;background:#F9FAFB;width:40%;"><b>' + escapeHtml(label) + '</b></td>' +
        '<td style="padding:8px 12px;border:1px solid #e5e7eb;">' + val + '</td>' +
      '</tr>'
  })

  const subject = payload.subject || ('New lead from "' + pageName + '"')

  const html =
    '<div style="font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif; max-width: 620px; margin: 0 auto;">' +
      '<h2 style="color:#111827; margin-bottom:8px;">Hey ' + escapeHtml(clientName) + ',</h2>' +
      '<p style="margin:0 0 12px; color:#111827;">Good news - someone just filled out your capture page <strong>' +
        escapeHtml(pageName) +
      '</strong>.</p>' +
      (slug ? '<p style="margin:0 0 12px; color:#6B7280; font-size:13px;">Slug: ' + escapeHtml(slug) + '</p>' : '') +
      '<table style="border-collapse:collapse;width:100%;margin-top:8px;">' +
        rowsHtml +
      '</table>' +
      '<p style="color:#6B7280; font-size:12px; margin-top:20px;">Sent by Fokus Kreatives</p>' +
    '</div>'

  MailApp.sendEmail({
    to: recipients,
    subject: subject,
    htmlBody: html
  })
}

function renderFormTable(formData, fieldLabels) {
  const labels = fieldLabels || {}
  const keys = Object.keys(formData || {})
  keys.sort()

  return keys.map((k) => {
    const label = labels[k] || k
    const v = formData[k]
    const val = (v === null || v === undefined || String(v) === '') ? '—' : String(v)
    return `<tr>
      <td style="padding:6px 10px;border:1px solid #e5e7eb;"><b>${label}</b></td>
      <td style="padding:6px 10px;border:1px solid #e5e7eb;">${val}</td>
    </tr>`
  }).join('')
}

function handleLeadCreated(payload) {
  if (!payload) {
    Logger.log('handleLeadCreated: no payload')
    return
  }

  const recipients = normalizeRecipients(payload.to)
  if (!recipients) {
    Logger.log('handleLeadCreated: no recipients')
    return
  }

  const leadName = payload.leadName || 'New Lead'
  const source = payload.source || 'Unknown source'
  const clientName = payload.clientName || 'there'

  const subject =
    payload.subject || `You just got a new lead in your CRM`

  const html =
    '<div style="font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px; margin: 0 auto;">' +
      '<h2 style="color:#111827; margin-bottom:8px;">Hey ' + escapeHtml(clientName) + ',</h2>' +
      '<p style="margin:0 0 12px; color:#111827;">You just got a new lead added to your CRM.</p>' +
      '<div style="background:#F9FAFB; border-radius:12px; padding:12px 16px; margin-bottom:12px;">' +
        '<p style="margin:0 0 4px;"><strong>Name:</strong> ' + escapeHtml(leadName) + '</p>' +
        '<p style="margin:0 0 4px;"><strong>Source:</strong> ' + escapeHtml(source) + '</p>' +
      '</div>' +
      '<p style="color:#6B7280; font-size:12px; margin-top:16px;">Sent by Fokus Kreatives</p>' +
    '</div>'

  MailApp.sendEmail({
    to: recipients,
    subject: subject,
    htmlBody: html,
  })
}

// ========== INVITES ==========

function handleInviteEmail(payload, context) {
  if (!payload) {
    Logger.log('handleInviteEmail: no payload')
    return
  }

  const recipients = normalizeRecipients(payload.to)
  if (!recipients) {
    Logger.log('handleInviteEmail: no recipients')
    return
  }

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
  // letter fallback rendered in a 48x48 cell that actually centers in Gmail.
  var avatarCell
  if (inviterAvatar) {
    avatarCell =
      '<img src="' + inviterAvatar + '" alt="' + escapeHtml(inviterName) + '" ' +
      'width="48" height="48" ' +
      'style="display:block;width:48px;height:48px;border-radius:48px;object-fit:cover;border:2px solid #2B79F7;" />'
  } else {
    avatarCell =
      '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="48" ' +
        'style="border-collapse:collapse;width:48px;height:48px;">' +
        '<tr>' +
          '<td align="center" valign="middle" width="48" height="48" ' +
            'style="width:48px;height:48px;border-radius:48px;' +
            'background:linear-gradient(135deg,#2B79F7 0%,#1E54B7 100%);' +
            'background-color:#2B79F7;color:#FFFFFF;' +
            'font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:700;' +
            'line-height:48px;text-align:center;mso-line-height-rule:exactly;">' +
            initial +
          '</td>' +
        '</tr>' +
      '</table>'
  }

  const html =
'<!doctype html><html><body style="margin:0;padding:0;background:#F4F6FA;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif;">' +
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F4F6FA;padding:32px 12px;">' +
    '<tr><td align="center">' +
      '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" ' +
        'style="max-width:600px;width:100%;background:#FFFFFF;border-radius:16px;overflow:hidden;border:1px solid #E5E7EB;">' +

        // Header
        '<tr>' +
          '<td style="background:linear-gradient(135deg,#2B79F7 0%,#1E54B7 50%,#143A80 100%);background-color:#2B79F7;padding:22px 28px;">' +
            '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' +
              '<tr>' +
                '<td align="left" valign="middle">' +
                  '<img src="https://silly-blue-r3z2xucguf.edgeone.app/FOKUS%20CREATIVES%20logo.png" alt="Fokus Kreatives" ' +
                    'width="32" height="32" style="display:block;height:32px;width:auto;border:0;" />' +
                '</td>' +
                '<td align="right" valign="middle" style="color:#E5E7EB;font-size:13px;font-weight:500;">' +
                  'Workspace Invitation' +
                '</td>' +
              '</tr>' +
            '</table>' +
          '</td>' +
        '</tr>' +

        // Greeting
        '<tr>' +
          '<td style="padding:36px 32px 16px;">' +
            '<h1 style="margin:0 0 12px;color:#0F172A;font-size:22px;font-weight:700;line-height:1.3;">' +
              'Hey ' + escapeHtml(inviteeName) + ',' +
            '</h1>' +
            '<p style="margin:0;color:#475569;font-size:15px;line-height:1.65;">' +
              escapeHtml(subtitle) +
            '</p>' +
          '</td>' +
        '</tr>' +

        // Inviter card (sits in its own subtle panel for breathing room)
        '<tr>' +
          '<td style="padding:8px 32px 28px;">' +
            '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ' +
              'style="background:#F8FAFC;border:1px solid #E5E7EB;border-radius:12px;">' +
              '<tr>' +
                '<td valign="middle" width="64" style="padding:14px 0 14px 16px;">' +
                  avatarCell +
                '</td>' +
                '<td valign="middle" style="padding:14px 16px;">' +
                  '<div style="color:#0F172A;font-size:15px;font-weight:600;line-height:1.3;">' +
                    escapeHtml(inviterName) +
                  '</div>' +
                  (roleText
                    ? '<div style="margin-top:3px;color:#64748B;font-size:13px;line-height:1.4;">' +
                        'Inviting you as <strong style="color:#334155;font-weight:600;">' + escapeHtml(roleText) + '</strong>' +
                      '</div>'
                    : ''
                  ) +
                '</td>' +
              '</tr>' +
            '</table>' +
          '</td>' +
        '</tr>' +

        // CTA
        '<tr>' +
          '<td style="padding:0 32px 36px;">' +
            '<p style="margin:0 0 20px;color:#475569;font-size:15px;line-height:1.65;">' +
              'Click the button below to accept and get access to your workspace.' +
            '</p>' +
            '<table role="presentation" cellpadding="0" cellspacing="0" border="0">' +
              '<tr>' +
                '<td style="border-radius:9999px;background:linear-gradient(135deg,#2B79F7 0%,#1E54B7 100%);background-color:#2B79F7;">' +
                  '<a href="' + acceptUrl + '" target="_blank" ' +
                    'style="display:inline-block;padding:13px 28px;color:#FFFFFF;text-decoration:none;' +
                    'font-size:15px;font-weight:600;line-height:1;border-radius:9999px;">' +
                    'Accept Invitation' +
                  '</a>' +
                '</td>' +
              '</tr>' +
            '</table>' +
          '</td>' +
        '</tr>' +

        // Footer
        '<tr>' +
          '<td style="padding:0 32px;">' +
            '<div style="height:1px;background:#E5E7EB;line-height:1px;font-size:1px;">&nbsp;</div>' +
          '</td>' +
        '</tr>' +
        '<tr>' +
          '<td style="padding:18px 32px 28px;">' +
            '<p style="margin:0;color:#94A3B8;font-size:12px;line-height:1.55;">' +
              'If you weren\'t expecting this, you can safely ignore this email.' +
            '</p>' +
          '</td>' +
        '</tr>' +

      '</table>' +
    '</td></tr>' +
  '</table>' +
'</body></html>'

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
    htmlBody: '<p>' + body + '</p>'
  });
}

// ===== SUPABASE HELPERS =====

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

// ===== CRON RUNNERS =====

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

// ===== DAILY MEETING SUMMARY (for TODAY) =====

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

      // Build HTML list
      var html = '<div style="font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px; margin: 0 auto;">' +
        '<h2 style="color:#111827;">Today\'s Meetings</h2>' +
        '<p>Here\'s a summary of your meetings for today (' + todayStart.toDateString() + '):</p>' +
        '<ul>'

      clientMeetings.forEach(function (m) {
        var dt = new Date(m.date_time)
        var when = dt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
        html += '<li><strong>' + escapeHtml(m.title || 'Untitled') + '</strong> at ' + when
        if (m.location_url) {
          html += ' – <a href="' + m.location_url + '">Join link</a>'
        }
        html += '</li>'
      })

      html += '</ul><p style="font-size:12px;color:#6b7280;">Sent by Fokus Kreatives</p></div>'

      var subject = 'Today\'s meetings for ' + targets.clientDisplayName

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

// ===== DAILY PAYMENT (REVENUE) SUMMARY =====

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

      // Build HTML
      var html = '<div style="font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px; margin: 0 auto;">' +
        '<h2 style="color:#111827;">Payments Due / Overdue</h2>' +
        '<p>Here are payments that are due or overdue as of ' + todayYmd + ':</p>' +
        '<ul>'

      clientPayments.forEach(function (p) {
        html += '<li>'
        html += '<strong>' + (p.currency || 'USD') + ' ' + p.amount + '</strong>'
        html += ' – status: ' + escapeHtml(p.status || '')
        html += ' – due date: ' + escapeHtml(p.due_date || '')
        html += '</li>'
      })

      html += '</ul><p style="font-size:12px;color:#6b7280;">Sent by Fokus Kreatives</p></div>'

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