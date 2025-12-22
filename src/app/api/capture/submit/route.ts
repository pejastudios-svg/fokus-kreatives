import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

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
      notificationSettings: {} as any,
      emails: [] as string[],
    }
  }

  const clientDisplayName =
    client.business_name || client.name || 'Client'
  const notificationSettings = client.notification_settings || {}

  // 1) Workspace owners (main workspace) – client_id IS NULL, role admin/manager
  const { data: ownerUsers, error: ownerError } = await supabase
    .from('users')
    .select('email, role, client_id')
    .is('client_id', null)

  if (ownerError) {
    console.error('getNotificationTargets: owner users error', ownerError)
  }

  // 2) CRM team – users attached to this client, role client/admin/manager
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
  const hasCrmTeam = (clientUsers || []).some((u: any) =>
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
    } = await req.json()

    console.log('Capture submit: slug', slug)

    if (!slug) {
      return NextResponse.json(
        { success: false, error: 'Missing capture page slug' },
        { status: 400 }
      )
    }

    const origin = new URL(req.url).origin

    // 1) Find the capture page
    const { data: page, error: pageError } = await supabase
      .from('capture_pages')
      .select('id, client_id, name, slug, headline, description, lead_magnet_url, include_meeting, calendly_url, fields')
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

const fieldsArr = (page as any).fields
const fieldLabels: Record<string, string> = {}
if (Array.isArray(fieldsArr)) {
  for (const f of fieldsArr) {
    if (!f?.id) continue
    fieldLabels[String(f.id)] = String(f.label || f.id)
  }
}

    const { error: subError } = await supabase
      .from('capture_submissions')
      .insert({
  capture_page_id: page.id,
  client_id: clientId,
  name: submissionData.name,
  email: submissionData.email,
  phone: submissionData.phone,
  notes: submissionData.notes,
  data: submissionData,
})

    if (subError) {
      console.error('Capture submission error:', subError)
    }

    // 3) Insert into leads table
    const { data: existingLeads } = await supabase
      .from('leads')
      .select('position')
      .eq('client_id', clientId)

    const nextPosition = existingLeads ? existingLeads.length : 0
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

    const { error: leadError } = await supabase
      .from('leads')
      .insert({
        client_id: clientId,
        data: leadData,
        position: nextPosition,
      })

    if (leadError) {
      console.error('Lead creation error from capture:', leadError)
    }

    // 4) Optionally create a meeting if meeting fields are present
    let createdMeeting: any = null

    if (page.include_meeting && meeting_date && meeting_time) {
      try {
        const dateTime = new Date(`${meeting_date}T${meeting_time}:00`)

        const title =
          `Meeting with ${name || 'lead'} (from ${slug})` ||
          'Capture form meeting'

        const descriptionText =
          `Requested via capture page "${page.name || slug}".` +
          (notes ? `\n\nNotes:\n${notes}` : '')

        const { data: meetingRow, error: meetingError } = await supabase
          .from('meetings')
          .insert({
            client_id: clientId,
            title,
            description: descriptionText,
            date_time: dateTime.toISOString(),
            duration_minutes: 30,
            status: 'scheduled',
            location_type: 'custom',
            location_url: page.calendly_url || null,
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
        const ns = notificationSettings as any

        // 5a) Meeting created (from capture)
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

          await fetch(scriptUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              secret,
              type: 'meeting_created',
              payload: {
                to: emails,
                title: createdMeeting.title,
                when,
                link: createdMeeting.location_url,
                clientName: clientDisplayName,
              },
            }),
          })
        }

        // 5b) Capture submission email
        const captureEnabled = ns.capture_submissions !== false
        if (captureEnabled) {
          await fetch(scriptUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              secret,
              type: 'capture_submission',
              payload: {
                to: emails,
                pageName: page.name || slug,
                slug,
                formData: submissionData,
                fieldLabels,
                clientName: clientDisplayName,
              },
            }),
          })
        }

        // 5c) Lead created email
        const leadsEnabled = ns.leads !== false
        if (leadsEnabled) {
          const leadName = leadData.name || 'New Lead'

          await fetch(scriptUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              secret,
              type: 'lead_created',
              payload: {
                to: emails,
                leadName,
                source: `capture:${slug}`,
                clientName: clientDisplayName,
              },
            }),
          })
        }
      }
    } catch (notifyErr) {
      console.error('Capture notifications error:', notifyErr)
    }

    return NextResponse.json({
      success: true,
      lead_magnet_url: page.lead_magnet_url || null,
    })
  } catch (err: any) {
    console.error('Capture submit error:', err)
    return NextResponse.json(
      { success: false, error: err?.message || 'Server error' },
      { status: 500 }
    )
  }
}