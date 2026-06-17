import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getConnectedGoogleIntegration } from '@/lib/integrations/googleTokenStore'
import { createGoogleCalendarEvent } from '@/lib/integrations/google'
import { getConnectedZoomIntegration } from '@/lib/integrations/zoomTokenStore'
import { createZoomMeeting } from '@/lib/integrations/zoom'
import { buildCalendarMeta } from '@/lib/calendarLinks'

interface NotificationSettings {
  meetings?: boolean
  capture_submissions?: boolean
  leads?: boolean
  [key: string]: boolean | undefined
}

interface UserRow {
  email: string | null
  role: string
  client_id: string | null
}

interface CaptureField {
  id: string
  label: string
}

interface MeetingRow {
  id: string
  title: string
  description: string | null
  date_time: string
  duration_minutes: number | null
  location_url: string | null
  attendee_name: string | null
  attendee_email: string | null
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Helper: load client info + notification settings + recipient emails
async function getNotificationTargets(clientId: string) {
  const { data: client, error: clientError } = await supabase
    .from('clients')
    .select('name, business_name, notification_settings')
    .eq('id', clientId)
    .single()

  if (clientError || !client) {
    console.error('getNotificationTargets: client error', clientError)
        return {
      clientDisplayName: 'Client',
      notificationSettings: {} as NotificationSettings,
      emails: [] as string[],
    }
  }

  const clientDisplayName =
    client.business_name || client.name || 'Client'
  const notificationSettings = client.notification_settings || {}

  // 1) Workspace owners (main workspace) - client_id IS NULL, role admin/manager
  const { data: ownerUsers, error: ownerError } = await supabase
    .from('users')
    .select('email, role, client_id')
    .is('client_id', null)

  if (ownerError) {
    console.error('getNotificationTargets: owner users error', ownerError)
  }

  // 2) CRM team - users attached to this client, role client/admin/manager
  const { data: clientUsers, error: clientUsersError } = await supabase
    .from('users')
    .select('email, role, client_id')
    .eq('client_id', clientId)

  if (clientUsersError) {
    console.error('getNotificationTargets: client users error', clientUsersError)
  }

  const emailSet = new Set<string>()
  const emails: string[] = []

  // Always include workspace owners (admin/manager with client_id null)
  for (const u of ownerUsers || []) {
    if (!u.email) continue
    if (!['admin', 'manager'].includes(u.role)) continue
    if (emailSet.has(u.email)) continue

    emailSet.add(u.email)
    emails.push(u.email)
  }

  // If CRM team exists, also include them (client/admin/manager for this client)
  const hasCrmTeam = (clientUsers || []).some((u: UserRow) =>
    ['client', 'admin', 'manager'].includes(u.role)
  )

  if (hasCrmTeam) {
    for (const u of clientUsers || []) {
      if (!u.email) continue
      if (!['client', 'admin', 'manager'].includes(u.role)) continue
      if (emailSet.has(u.email)) continue

      emailSet.add(u.email)
      emails.push(u.email)
    }
  }

  // Result:
  // - If CRM team exists → emails = workspace owners + CRM team
  // - If no CRM team → emails = workspace owners only
  return { clientDisplayName, notificationSettings, emails }
}

export async function POST(req: NextRequest) {
  try {
    const {
      slug,
      name,
      email,
      phone,
      notes,
      values,
      meeting_date,
      meeting_time,
      session_id,
    } = await req.json()

    console.log('Capture submit: slug', slug)

    if (!slug) {
      return NextResponse.json(
        { success: false, error: 'Missing capture page slug' },
        { status: 400 }
      )
    }


    // 1) Find the capture page
    const { data: page, error: pageError } = await supabase
      .from('capture_pages')
      .select('id, client_id, name, slug, headline, description, lead_magnet_url, include_meeting, calendly_url, meeting_integration, block_duplicate_emails, meeting_duration_minutes, fields')
      .eq('slug', slug)
      .eq('is_active', true)
      .single()

    if (pageError || !page) {
      return NextResponse.json(
        { success: false, error: 'Capture page not found or inactive' },
        { status: 404 }
      )
    }

    const clientId = page.client_id as string

    // Load targets (client display name, settings, recipient emails)
    const {
      clientDisplayName,
      notificationSettings,
      emails,
    } = await getNotificationTargets(clientId)

   const v = (values && typeof values === 'object') ? values : {}

    // 2) Insert into capture_submissions (store raw data as well)
const submissionData = {
  ...v, // store all dynamic fields
  name: (v.name ?? name) || null,
  email: (v.email ?? email) || null,
  phone: (v.phone ?? phone) || null,
  notes: (v.notes ?? notes) || null,
  meeting_date: page.include_meeting ? meeting_date || null : null,
  meeting_time: page.include_meeting ? meeting_time || null : null,
}

    // 2a) Duplicate-email gate. When the page has
    // block_duplicate_emails=true, reject a second submission from an
    // email that's already been captured on THIS page. Case-insensitive
    // match. Skipped when no email was provided (we have nothing to
    // dedupe by) or when the toggle is off.
    if (page.block_duplicate_emails && submissionData.email) {
      const lowered = String(submissionData.email).toLowerCase()
      const { data: prior } = await supabase
        .from('capture_submissions')
        .select('id')
        .eq('capture_page_id', page.id)
        .ilike('email', lowered)
        .limit(1)
      if (prior && prior.length > 0) {
        return NextResponse.json(
          {
            success: false,
            error:
              'It looks like you already submitted this form with this email. Reach out if you need to update your answers.',
            code: 'DUPLICATE_EMAIL',
          },
          { status: 409 },
        )
      }
    }

    const capturePage = page as unknown as { fields: CaptureField[] }
    const fieldsArr = capturePage.fields
    const fieldLabels: Record<string, string> = {}
    if (Array.isArray(fieldsArr)) {
      for (const f of fieldsArr) {
        if (!f?.id) continue
        fieldLabels[String(f.id)] = String(f.label || f.id)
      }
    }

    const { data: submissionInsert, error: subError } = await supabase
      .from('capture_submissions')
      .insert({
  capture_page_id: page.id,
  client_id: clientId,
  // Link to the visit that produced this submission so deleting it can
  // also remove that visit from the analytics funnel. Null when the
  // visitor had no session (e.g. localStorage disabled).
  session_id: session_id || null,
  name: submissionData.name,
  email: submissionData.email,
  phone: submissionData.phone,
  notes: submissionData.notes,
  data: submissionData,
  // Snapshot field labels at submission time so historical
  // submissions still render readable labels after the page's
  // fields are renamed or deleted. Without this, old submissions
  // would fall back to raw IDs (e.g. "field-1766430496663").
  field_labels: fieldLabels,
})
      .select('id')
      .single()
    const submissionId = (submissionInsert as { id?: string } | null)?.id ?? null

    if (subError) {
      console.error('Capture submission error:', subError)
    }

    // Mark the analytics session as submitted so the funnel
    // (visits → submissions) is accurate. Best-effort - if the
    // visitor disabled localStorage or the session row is gone,
    // we just skip.
    if (session_id) {
      await supabase
        .from('capture_sessions')
        .update({
          submitted: true,
          ended_at: new Date().toISOString(),
        })
        .eq('id', session_id)
    }

    // 3) Upsert into leads table.
    //
    // Default behaviour: if a lead with this email already exists for
    // this client, MERGE the new submission's data into the existing
    // lead instead of creating a duplicate. The capture_submissions
    // table keeps the full audit trail; the leads table stays clean.
    // Status is preserved on existing leads (we don't reset a 'won'
    // lead back to 'new' just because they re-submitted).
    //
    // When the email is missing we fall back to insert - we have no
    // dedupe key.
    const today = new Date().toISOString().split('T')[0]

    const leadData = {
      ...submissionData,
      name: submissionData.name || 'Unknown',
      email: submissionData.email || null,
      phone: submissionData.phone || null,
      status: 'new',
      source: `capture:${slug}`,
      date_added: today,
    }

    // Capture-to-lead field mapping: page fields flagged mapToLead write
    // their answer onto the lead under a readable key (slug of the label)
    // and get a matching custom_fields column ON FIRST USE, so the answer
    // shows up on the Leads table and is filterable in email groups.
    const pageFields = Array.isArray(page.fields)
      ? (page.fields as Array<Record<string, unknown>>)
      : []
    const mappedFields = pageFields.filter(
      (f) => f && f.mapToLead === true && f.type !== 'embed' && f.label,
    )
    if (mappedFields.length > 0) {
      const RESERVED_KEYS = new Set(['name', 'email', 'phone', 'status', 'source', 'date_added'])
      const slugify = (label: string) =>
        label.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '').slice(0, 60)

      const { data: existingFields } = await supabase
        .from('custom_fields')
        .select('field_key')
        .eq('client_id', clientId)
      const existingKeys = new Set((existingFields || []).map((f) => f.field_key as string))
      let nextPosition = existingKeys.size

      for (const f of mappedFields) {
        const key = slugify(String(f.label))
        if (!key || RESERVED_KEYS.has(key)) continue

        const raw = (v as Record<string, unknown>)[String(f.id)]
        const value = raw === null || raw === undefined ? '' : String(raw).trim()
        if (value) (leadData as Record<string, unknown>)[key] = value

        if (!existingKeys.has(key)) {
          existingKeys.add(key)
          const { error: cfError } = await supabase.from('custom_fields').insert({
            client_id: clientId,
            field_name: String(f.label),
            field_key: key,
            field_type: 'text',
            options: [],
            position: nextPosition++,
            is_default: false,
            is_required: false,
          })
          if (cfError) {
            console.error('capture mapToLead column create error:', cfError)
          }
        }
      }
    }

    // Look up an existing lead by email (case-insensitive). We need
    // to scan in JS because data->>email is a JSONB extraction and
    // Postgres can't case-insensitively index that without an extra
    // expression index - small fetch, fine to filter client-side.
    let existingLeadId: string | null = null
    // Populated only when we INSERT a new lead row. Used to deep-link
    // the in-app "new lead" notification to the exact row on the
    // Leads page (?focus=...). Dedup-merge case keeps it null.
    let newLeadId: string | null = null
    if (leadData.email) {
      const lowered = String(leadData.email).toLowerCase()
      const { data: candidates } = await supabase
        .from('leads')
        .select('id, data')
        .eq('client_id', clientId)
        .not('data->>email', 'is', null)
      const found = (candidates || []).find((row) => {
        const e = (row.data as { email?: string } | null)?.email
        return typeof e === 'string' && e.toLowerCase() === lowered
      })
      if (found) existingLeadId = found.id as string
    }

    if (existingLeadId) {
      // Merge policy: EXISTING answers win. A returning lead (same email)
      // fills in fields they never answered before, but a re-submission
      // never overwrites values already on the lead - curated data and
      // earlier answers stay intact. Status is covered by the same rule.
      const { data: existing } = await supabase
        .from('leads')
        .select('data')
        .eq('id', existingLeadId)
        .single()
      const prevData = (existing?.data as Record<string, unknown> | null) || {}
      const merged: Record<string, unknown> = { ...leadData }
      for (const [k, prevVal] of Object.entries(prevData)) {
        const hasPrev =
          prevVal !== null && prevVal !== undefined && String(prevVal).trim() !== ''
        if (hasPrev) merged[k] = prevVal
      }
      const { error: leadUpdateErr } = await supabase
        .from('leads')
        .update({ data: merged })
        .eq('id', existingLeadId)
      if (leadUpdateErr) {
        console.error('Lead merge error from capture:', leadUpdateErr)
      }
    } else {
      const { data: existingLeads } = await supabase
        .from('leads')
        .select('position')
        .eq('client_id', clientId)
      const nextPosition = existingLeads ? existingLeads.length : 0

      const { data: leadInsert, error: leadError } = await supabase
        .from('leads')
        .insert({
          client_id: clientId,
          data: leadData,
          position: nextPosition,
        })
        .select('id')
        .single()

      if (leadError) {
        console.error('Lead creation error from capture:', leadError)
      } else if (leadInsert?.id) {
        newLeadId = leadInsert.id as string
      }
    }

    // 4) Optionally create a meeting if meeting fields are present.
    //
    // Three paths:
    //   a) meeting_integration='google_meet' AND visitor email present:
    //      use the host's connected Google account to create a Calendar
    //      event with conferenceData (auto-generates a Meet link), let
    //      Google email the invite, then mirror the event into our
    //      meetings table. The Meet link lands in location_url so the
    //      meetings page shows a Join button.
    //   b) Default: insert a plain meeting row with the manual
    //      date/time (legacy behaviour).
    //   c) Calendly: handled separately by the embed-callback /
    //      webhook - the submit endpoint doesn't create a meeting at
    //      all for those, to avoid duplicates.
    let createdMeeting: MeetingRow | null = null

    const isCalendly = page.meeting_integration === 'calendly'
    const isGoogleMeet = page.meeting_integration === 'google_meet'
    const isZoom = page.meeting_integration === 'zoom'

    if (
      page.include_meeting &&
      meeting_date &&
      meeting_time &&
      !isCalendly // Calendly handles its own meeting insert
    ) {
      try {
        const dateTime = new Date(`${meeting_date}T${meeting_time}:00`)

        const title =
          `Meeting with ${name || 'lead'} (from ${slug})` ||
          'Capture form meeting'

        const descriptionText =
          `Requested via capture page "${page.name || slug}".` +
          (notes ? `\n\nNotes:\n${notes}` : '')

        let meetLink: string | null = null
        let externalEventId: string | null = null
        let createdBy: string | null = null
        // Per-page meeting duration (defaults to 30). Drives the
        // length of the meeting we create on Google Calendar / Zoom
        // and the duration_minutes stored on the meeting row.
        const durationMin =
          typeof page.meeting_duration_minutes === 'number'
            ? page.meeting_duration_minutes
            : 30

        if (isGoogleMeet) {
          const integration = await getConnectedGoogleIntegration(clientId)
          const attendeeEmail = (submissionData.email as string) || email
          if (integration && attendeeEmail) {
            try {
              const endIso = new Date(dateTime.getTime() + durationMin * 60_000).toISOString()
              const created = await createGoogleCalendarEvent({
                accessToken: integration.accessToken,
                summary: title,
                description: descriptionText,
                startIso: dateTime.toISOString(),
                endIso,
                attendee: {
                  email: attendeeEmail,
                  displayName: (submissionData.name as string) || name || undefined,
                },
              })
              meetLink = created.meetUrl
              externalEventId = created.id
              createdBy = integration.userId
            } catch (err) {
              console.error('[capture/submit] google event create failed:', err)
              // Fall through to a plain meeting row so we never lose
              // the booking even if Google's API hiccups.
            }
          } else if (!integration) {
            console.warn(
              '[capture/submit] page wired to google_meet but no connected integration found',
            )
          }
        } else if (isZoom) {
          const integration = await getConnectedZoomIntegration(clientId)
          if (integration) {
            try {
              const created = await createZoomMeeting({
                accessToken: integration.accessToken,
                topic: title,
                agenda: descriptionText,
                startIso: dateTime.toISOString(),
                durationMinutes: durationMin,
              })
              meetLink = created.joinUrl
              externalEventId = String(created.id)
              createdBy = integration.userId
            } catch (err) {
              console.error('[capture/submit] zoom meeting create failed:', err)
              // Fall through to plain row - never lose the booking
              // even if Zoom's API hiccups.
            }
          } else {
            console.warn(
              '[capture/submit] page wired to zoom but no connected integration found',
            )
          }
        }

        const { data: meetingRow, error: meetingError } = await supabase
          .from('meetings')
          .insert({
            client_id: clientId,
            created_by: createdBy,
            title,
            description: descriptionText,
            date_time: dateTime.toISOString(),
            duration_minutes: durationMin,
            status: 'scheduled',
            location_type: isGoogleMeet && meetLink
              ? 'google_meet'
              : isZoom && meetLink
              ? 'zoom'
              : 'custom',
            location_url: meetLink || page.calendly_url || null,
            integration_provider: isGoogleMeet
              ? 'google_meet'
              : isZoom
              ? 'zoom'
              : null,
            external_id: externalEventId,
            attendee_name: (submissionData.name as string) || name || null,
            attendee_email: (submissionData.email as string) || email || null,
          })
          .select()
          .single()

        if (meetingError) {
          console.error(
            'Meeting creation error from capture:',
            meetingError
          )
        } else {
          createdMeeting = meetingRow
        }
      } catch (err) {
        console.error('Error parsing meeting date/time:', err)
      }
    }

    // 5) Notifications & Emails (direct to Apps Script)
    try {
      const scriptUrl = process.env.APPS_SCRIPT_WEBHOOK_URL
      const secret = process.env.APPS_SCRIPT_SECRET

            console.log(
        'Capture notifications config:',
        'hasScriptUrl =', !!scriptUrl,
        'hasSecret =', !!secret
      )

      console.log('Capture notifications emails:', emails)
      console.log('Capture notifications settings:', notificationSettings)

      if (!scriptUrl || !secret) {
        console.error('Capture notifications: Apps Script not configured')
      } else if (emails.length > 0) {
        const ns = notificationSettings as NotificationSettings

        // Send via Apps Script and record it in email_send_log so the
        // Settings quota card counts this route's emails too. One log row
        // per recipient - that's how Google meters the daily quota.
        const sendScriptEmail = async (
          type: string,
          payload: Record<string, unknown>,
          recipients: number,
        ) => {
          const res = await fetch(scriptUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ secret, type, payload }),
          })
          const text = await res.text()
          if (!res.ok || text.startsWith('Error:') || text.startsWith('Unauthorized')) {
            console.error(`Capture ${type} email error:`, text.slice(0, 300))
            return
          }
          const { logEmailSend } = await import('@/lib/email/sendLog')
          void logEmailSend({ clientId, channel: 'apps_script', type, count: recipients })
        }

        // 5a) Meeting created (from capture). Two emails go out:
        //   - HOST email: existing meeting_created handler, now with
        //     `platform` so the email can say "via Zoom / Google Meet
        //     / Calendly".
        //   - VISITOR email: new meeting_invitee_confirmation handler,
        //     only sent for platforms that DON'T already email the
        //     attendee on their own. Zoom requires this (Zoom's API
        //     doesn't auto-notify). Manual/legacy flows also use it.
        //     Calendly + Google Meet skip it - Calendly sends its own
        //     booking email, Google Calendar sends the invite via
        //     sendUpdates='all' when we create the event.
        const meetingsEnabled = ns.meetings !== false
        if (meetingsEnabled && createdMeeting) {
          const dt = new Date(createdMeeting.date_time)
          const when = dt.toLocaleString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })

          const platform = isZoom
            ? 'Zoom'
            : isGoogleMeet
            ? 'Google Meet'
            : isCalendly
            ? 'Calendly'
            : null

          // Build the "add to calendar" payload (Google / Outlook /
          // Yahoo URLs + a full ICS file). Recipients can one-click
          // add the meeting to their calendar from any major
          // provider, so we don't have to send reminder emails - the
          // calendar handles those natively.
          const meetingDurMin =
            typeof createdMeeting.duration_minutes === 'number' && createdMeeting.duration_minutes > 0
              ? createdMeeting.duration_minutes
              : 30
          const calendarStartIso = createdMeeting.date_time
          const calendarEndIso = new Date(
            new Date(createdMeeting.date_time).getTime() + meetingDurMin * 60_000,
          ).toISOString()
          const calendar = buildCalendarMeta({
            title: createdMeeting.title,
            description: createdMeeting.description || '',
            startIso: calendarStartIso,
            endIso: calendarEndIso,
            location: createdMeeting.location_url || undefined,
            organizer: { name: clientDisplayName },
            attendee: createdMeeting.attendee_email
              ? {
                  email: createdMeeting.attendee_email,
                  name: createdMeeting.attendee_name || undefined,
                }
              : undefined,
          })

          await sendScriptEmail(
            'meeting_created',
            {
              to: emails,
              title: createdMeeting.title,
              when,
              link: createdMeeting.location_url,
              clientName: clientDisplayName,
              platform,
              attendeeName: createdMeeting.attendee_name ?? null,
              attendeeEmail: createdMeeting.attendee_email ?? null,
              calendar,
            },
            emails.length,
          )

          // Visitor confirmation. Zoom is the must-have case; manual
          // flow (no integration, no calendly_url) also benefits if
          // we have an attendee email.
          const attendeeEmail = createdMeeting.attendee_email
          const platformAutoEmails = isCalendly || isGoogleMeet
          if (attendeeEmail && !platformAutoEmails) {
            await sendScriptEmail(
              'meeting_invitee_confirmation',
              {
                to: [attendeeEmail],
                title: createdMeeting.title,
                when,
                link: createdMeeting.location_url,
                clientName: clientDisplayName,
                platform,
                attendeeName: createdMeeting.attendee_name ?? null,
                calendar,
              },
              1,
            )
          }
        }

        // 5b) Capture submission email
        const captureEnabled = ns.capture_submissions !== false
        if (captureEnabled) {
          await sendScriptEmail(
            'capture_submission',
            {
              to: emails,
              pageName: page.name || slug,
              slug,
              formData: submissionData,
              fieldLabels,
              clientName: clientDisplayName,
            },
            emails.length,
          )
        }

        // 5c) Lead created email. Skipped when we deduped into an
        // existing lead (existingLeadId set) - the host already got
        // a "new lead" notification on the first submission; the
        // second submission just merged data, so a second email
        // would be misleading.
        const leadsEnabled = ns.leads !== false
        if (leadsEnabled && !existingLeadId) {
          const leadName = leadData.name || 'New Lead'

          await sendScriptEmail(
            'lead_created',
            {
              to: emails,
              leadName,
              source: `capture:${slug}`,
              clientName: clientDisplayName,
            },
            emails.length,
          )
        }
      }
    } catch (notifyErr) {
      console.error('Capture notifications error:', notifyErr)
    }

    // 6) In-app notifications + web push fan-out.
    //
    // We AWAIT these now (used to be void/fire-and-forget). Reason:
    // on Vercel serverless, the function instance gets torn down the
    // moment we return the response, which kills any pending
    // promises. Fire-and-forget meant pushes either didn't reach the
    // device at all (PWA closed = no realtime channel to fall back
    // on) or arrived 30s late when the next request happened to
    // warm a function. Awaiting adds ~200-500ms but makes delivery
    // deterministic. Wrapped in Promise.allSettled so one failed
    // notification doesn't take down the others.
    try {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin

      const calls: Promise<Response>[] = []

      if (createdMeeting) {
        calls.push(
          fetch(`${appUrl}/api/notifications/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              clientId: page.client_id,
              type: 'meeting_created',
              data: {
                meetingTitle: createdMeeting.title,
                dateTime: createdMeeting.date_time,
                source: `capture:${slug}`,
                clientName: clientDisplayName,
                meetingId: createdMeeting.id,
              },
            }),
          }),
        )
      }

      // Skip when we deduped into an existing lead - host already
      // got a "new lead" notification the first time around.
      if (!existingLeadId) {
        const leadName = leadData.name || 'New Lead'
        calls.push(
          fetch(`${appUrl}/api/notifications/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              clientId: page.client_id,
              type: 'lead_created',
              data: {
                leadName,
                source: `capture:${slug}`,
                clientName: clientDisplayName,
                leadId: newLeadId,
              },
            }),
          }),
        )
      }

      if (submissionId) {
        calls.push(
          fetch(`${appUrl}/api/notifications/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              clientId: page.client_id,
              type: 'capture_submission',
              data: {
                pageName: page.name || slug,
                slug,
                clientName: clientDisplayName,
                submissionId,
                capturePageId: page.id,
              },
            }),
          }),
        )
      }

      const results = await Promise.allSettled(calls)
      for (const r of results) {
        if (r.status === 'rejected') {
          console.error('in-app notification call failed:', r.reason)
        }
      }
    } catch (inAppErr) {
      console.error('Capture in-app notifications error:', inAppErr)
    }

    return NextResponse.json({
      success: true,
      lead_magnet_url: page.lead_magnet_url || null,
        })
  } catch (err: unknown) {
    console.error('Capture submit error:', err)
    const errorMessage = err instanceof Error ? err.message : 'Server error'
    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    )
  }
}