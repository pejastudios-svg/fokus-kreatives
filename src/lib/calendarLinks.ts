// Add-to-calendar helpers.
//
// Builds one-click "add to calendar" URLs for Google / Outlook /
// Yahoo plus a full ICS file (Apple Calendar, Outlook desktop, any
// standards-compliant client). All emitted from a single
// CalendarEvent input so the submit endpoint only has to assemble
// the event details once.
//
// We pass these into Apps Script alongside the meeting_created /
// meeting_invitee_confirmation payloads; the template renders the
// links as buttons and attaches the ICS so recipients can add the
// event to their calendar in one click. Their calendar then handles
// the reminders, freeing us from sending reminder emails ourselves.

export interface CalendarEvent {
  title: string
  description?: string
  /** ISO 8601 UTC string. */
  startIso: string
  /** ISO 8601 UTC string. */
  endIso: string
  /** Plain text location or join URL. */
  location?: string
  organizer?: { name?: string; email?: string }
  attendee?: { name?: string; email?: string }
}

/** Compact ICS / Google calendar format: YYYYMMDDTHHmmssZ. */
function formatStamp(iso: string): string {
  return iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

function escapeIcs(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

/** Google Calendar "create event" URL. Pre-fills the event, user
 *  clicks Save in their Google Calendar UI. */
export function googleCalendarLink(ev: CalendarEvent): string {
  const u = new URL('https://calendar.google.com/calendar/render')
  u.searchParams.set('action', 'TEMPLATE')
  u.searchParams.set('text', ev.title)
  u.searchParams.set('dates', `${formatStamp(ev.startIso)}/${formatStamp(ev.endIso)}`)
  if (ev.description) u.searchParams.set('details', ev.description)
  if (ev.location) u.searchParams.set('location', ev.location)
  return u.toString()
}

/** Outlook Web / Office 365 "compose event" deeplink. */
export function outlookCalendarLink(ev: CalendarEvent): string {
  const u = new URL('https://outlook.live.com/calendar/0/deeplink/compose')
  u.searchParams.set('path', '/calendar/action/compose')
  u.searchParams.set('rru', 'addevent')
  u.searchParams.set('subject', ev.title)
  u.searchParams.set('startdt', ev.startIso)
  u.searchParams.set('enddt', ev.endIso)
  if (ev.description) u.searchParams.set('body', ev.description)
  if (ev.location) u.searchParams.set('location', ev.location)
  return u.toString()
}

/** Office 365 (business Outlook) compose link - same shape as
 *  outlook.live.com but on the office.com domain. Some recipients'
 *  org SSO is bound to office.com and rejects the .live.com URL. */
export function office365CalendarLink(ev: CalendarEvent): string {
  return outlookCalendarLink(ev).replace(
    'outlook.live.com',
    'outlook.office.com',
  )
}

/** Yahoo Calendar add-event URL. */
export function yahooCalendarLink(ev: CalendarEvent): string {
  const u = new URL('https://calendar.yahoo.com/')
  u.searchParams.set('v', '60')
  u.searchParams.set('title', ev.title)
  u.searchParams.set('st', formatStamp(ev.startIso))
  u.searchParams.set('et', formatStamp(ev.endIso))
  if (ev.description) u.searchParams.set('desc', ev.description)
  if (ev.location) u.searchParams.set('in_loc', ev.location)
  return u.toString()
}

/** Full ICS file content. Use as an email attachment named
 *  "invite.ics" with MIME type "text/calendar". Apple Calendar,
 *  Outlook desktop, and most other clients open it natively. */
export function buildIcsContent(ev: CalendarEvent): string {
  const uid = `${Date.now()}-${Math.random().toString(36).slice(2)}@fokuskreativez.com`
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Fokus Kreativez//Capture Form//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${formatStamp(new Date().toISOString())}`,
    `DTSTART:${formatStamp(ev.startIso)}`,
    `DTEND:${formatStamp(ev.endIso)}`,
    `SUMMARY:${escapeIcs(ev.title)}`,
  ]
  if (ev.description) lines.push(`DESCRIPTION:${escapeIcs(ev.description)}`)
  if (ev.location) lines.push(`LOCATION:${escapeIcs(ev.location)}`)
  if (ev.organizer?.email) {
    const name = ev.organizer.name || ev.organizer.email
    lines.push(`ORGANIZER;CN=${escapeIcs(name)}:mailto:${ev.organizer.email}`)
  }
  if (ev.attendee?.email) {
    const name = ev.attendee.name || ev.attendee.email
    lines.push(
      `ATTENDEE;CN=${escapeIcs(name)};RSVP=TRUE;PARTSTAT=NEEDS-ACTION:mailto:${ev.attendee.email}`,
    )
  }
  lines.push('END:VEVENT', 'END:VCALENDAR')
  return lines.join('\r\n')
}

export interface CalendarMeta {
  startIso: string
  endIso: string
  title: string
  description: string
  location: string | null
  googleUrl: string
  outlookUrl: string
  office365Url: string
  yahooUrl: string
  /** Full ICS file content - Apps Script attaches this as a blob. */
  ics: string
}

/** One-stop builder for the payload field the email handlers consume. */
export function buildCalendarMeta(ev: CalendarEvent): CalendarMeta {
  return {
    startIso: ev.startIso,
    endIso: ev.endIso,
    title: ev.title,
    description: ev.description || '',
    location: ev.location || null,
    googleUrl: googleCalendarLink(ev),
    outlookUrl: outlookCalendarLink(ev),
    office365Url: office365CalendarLink(ev),
    yahooUrl: yahooCalendarLink(ev),
    ics: buildIcsContent(ev),
  }
}
