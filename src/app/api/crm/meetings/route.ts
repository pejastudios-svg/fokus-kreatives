import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { getConnectedGoogleIntegration } from '@/lib/integrations/googleTokenStore'
import { getConnectedZoomIntegration } from '@/lib/integrations/zoomTokenStore'
import { createGoogleCalendarEvent } from '@/lib/integrations/google'
import { createZoomMeeting } from '@/lib/integrations/zoom'

export const dynamic = 'force-dynamic'

// Insert happens via the service-role client so we can set created_by to
// the integration HOST (not the acting user) and write external_id. The
// caller's membership is verified first through their RLS-scoped client.
const admin = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

type LocationType = 'zoom' | 'google_meet' | 'jitsi' | 'custom'

interface Body {
  clientId: string
  title: string
  description?: string | null
  startIso: string
  durationMinutes: number
  locationType: LocationType
  locationUrl?: string | null
  attendeeEmails?: string[]
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// POST /api/crm/meetings - create a meeting and, for Google Meet / Zoom,
// actually provision it on the connected platform (real Meet link / Zoom
// meeting + invites). Jitsi and custom links are stored as-is.
export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
    }

    const body = (await req.json().catch(() => ({}))) as Partial<Body>
    const clientId = body.clientId
    const title = (body.title || '').trim()
    const startIso = body.startIso
    const durationMinutes = Number(body.durationMinutes) || 0
    const locationType = (body.locationType || 'custom') as LocationType

    if (!clientId || !title || !startIso || !durationMinutes) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields (title, date/time, duration).' },
        { status: 400 },
      )
    }
    const start = new Date(startIso)
    if (Number.isNaN(start.getTime())) {
      return NextResponse.json({ success: false, error: 'Invalid start time.' }, { status: 400 })
    }
    const end = new Date(start.getTime() + durationMinutes * 60_000)

    // Membership check through the caller's RLS scope: if they can't read
    // the client row, they're not a member.
    const { data: clientRow } = await supabase
      .from('clients')
      .select('id')
      .eq('id', clientId)
      .maybeSingle()
    if (!clientRow) {
      return NextResponse.json(
        { success: false, error: 'No access to this client.' },
        { status: 403 },
      )
    }

    // Validate + dedupe attendee emails.
    const emails = Array.from(
      new Set((body.attendeeEmails || []).map((e) => e.trim().toLowerCase()).filter(Boolean)),
    )
    const invalid = emails.filter((e) => !EMAIL_RE.test(e))
    if (invalid.length) {
      return NextResponse.json(
        { success: false, error: `Invalid email${invalid.length > 1 ? 's' : ''}: ${invalid.join(', ')}` },
        { status: 400 },
      )
    }

    // Block double-booking: reject if a scheduled meeting already occupies
    // this exact slot for the client. Checked before any platform call so we
    // don't create a Zoom/Google event that then gets rejected here.
    const { data: clashRows } = await admin
      .from('meetings')
      .select('id')
      .eq('client_id', clientId)
      .eq('status', 'scheduled')
      .eq('date_time', start.toISOString())
      .limit(1)
    if (clashRows && clashRows.length > 0) {
      return NextResponse.json(
        { success: false, error: 'A meeting is already scheduled at that date and time. Pick a different slot.' },
        { status: 409 },
      )
    }

    let locationUrl = body.locationUrl?.trim() || null
    let provider: 'google_meet' | 'zoom' | null = null
    let externalId: string | null = null
    // Default attribution is the acting user; integration meetings switch
    // it to the host so cancellation resolves the right tokens.
    let createdBy: string = user.id
    const warning: string | null = null

    if (locationType === 'google_meet') {
      const integ = await getConnectedGoogleIntegration(clientId)
      if (!integ) {
        return NextResponse.json(
          { success: false, error: "Google Calendar isn't connected (or the connection expired). Open Integrations to connect or reconnect it." },
          { status: 400 },
        )
      }
      if (emails.length === 0) {
        return NextResponse.json(
          { success: false, error: 'Add at least one attendee email to create a Google Meet invite.' },
          { status: 400 },
        )
      }
      const created = await createGoogleCalendarEvent({
        accessToken: integ.accessToken,
        summary: title,
        description: body.description || undefined,
        startIso: start.toISOString(),
        endIso: end.toISOString(),
        attendee: { email: emails[0] },
        extraAttendees: emails.slice(1).map((email) => ({ email })),
      })
      locationUrl = created.meetUrl || locationUrl
      externalId = created.id
      provider = 'google_meet'
      createdBy = integ.userId
    } else if (locationType === 'zoom') {
      const integ = await getConnectedZoomIntegration(clientId)
      if (!integ) {
        return NextResponse.json(
          { success: false, error: "Zoom isn't connected (or the connection expired). Open Integrations to connect or reconnect it." },
          { status: 400 },
        )
      }
      const created = await createZoomMeeting({
        accessToken: integ.accessToken,
        topic: title,
        agenda: body.description || undefined,
        startIso: start.toISOString(),
        durationMinutes,
        attendees: emails,
      })
      locationUrl = created.joinUrl
      externalId = String(created.id)
      provider = 'zoom'
      createdBy = integ.userId
    } else if (locationType === 'jitsi') {
      if (!locationUrl) {
        const safeTitle = title
          .toLowerCase()
          .replace(/\s+/g, '-')
          .replace(/[^a-z0-9-]/g, '')
        locationUrl = `https://meet.jit.si/fokus-${clientId}-${safeTitle}-${start.getTime()}`
      }
    }
    // 'custom' keeps whatever locationUrl was supplied.

    const { data: meetingRow, error: insertErr } = await admin
      .from('meetings')
      .insert({
        client_id: clientId,
        created_by: createdBy,
        title,
        description: body.description || null,
        date_time: start.toISOString(),
        duration_minutes: durationMinutes,
        status: 'scheduled',
        location_type: locationType,
        location_url: locationUrl,
        integration_provider: provider,
        external_id: externalId,
        attendee_email: emails[0] || null,
      })
      .select('*, creator:created_by(id, name, email, profile_picture_url)')
      .single()

    if (insertErr) {
      console.error('[crm/meetings POST] insert failed:', insertErr)
      return NextResponse.json({ success: false, error: insertErr.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, meeting: meetingRow, warning })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[crm/meetings POST] exception:', msg)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
