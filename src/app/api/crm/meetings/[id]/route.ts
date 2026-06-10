import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { getConnectedGoogleIntegration } from '@/lib/integrations/googleTokenStore'
import { getConnectedZoomIntegration } from '@/lib/integrations/zoomTokenStore'
import { cancelGoogleCalendarEvent, updateGoogleCalendarEventTime } from '@/lib/integrations/google'
import { cancelZoomMeeting, updateZoomMeeting } from '@/lib/integrations/zoom'
import { cancelCalendlyEvent } from '@/lib/integrations/calendly'

export const dynamic = 'force-dynamic'

// Service-role client, used ONLY for reading the Calendly PAT out of
// user_integrations (the token stores for Google/Zoom already manage
// their own admin client + refresh internally). Never used to bypass
// the membership check below - that always goes through the caller's
// RLS-scoped client.
const admin = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

type Provider = 'calendly' | 'google_meet' | 'zoom' | null

interface MeetingRow {
  id: string
  client_id: string
  status: string
  integration_provider: Provider
  external_id: string | null
  duration_minutes: number
}

type AuthResult =
  | { error: string; status: 401 | 404 }
  | {
      supabase: Awaited<ReturnType<typeof createServerClient>>
      meeting: MeetingRow
    }

// Loads the meeting through the caller's RLS-scoped client so we only
// proceed for meetings whose CRM the user belongs to. If RLS hides the
// row (not a member) it reads as "not found" - same as a bad id.
async function loadAuthorizedMeeting(id: string): Promise<AuthResult> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated', status: 401 }

  const { data, error } = await supabase
    .from('meetings')
    .select('id, client_id, status, integration_provider, external_id, duration_minutes')
    .eq('id', id)
    .maybeSingle()

  if (error || !data) return { error: 'Meeting not found', status: 404 }
  return { supabase, meeting: data as MeetingRow }
}

// Cancels the meeting on whichever external platform created it. Meetings
// added manually from the CRM (no integration_provider / external_id)
// have nothing to cancel and return { cancelled: false } cleanly. All
// failures are caught and surfaced as a soft `error` so the local DB
// mutation can still proceed - we never block deleting our own record
// because a third-party API hiccuped.
async function cancelOnPlatform(
  meeting: MeetingRow,
): Promise<{ cancelled: boolean; error?: string }> {
  const { integration_provider: provider, external_id: externalId, client_id: clientId } = meeting
  // Nothing tracked to cancel (manual meeting, or a Google/Zoom link with no
  // event we created). Logged so "cancel did nothing" cases are explainable.
  if (!provider || !externalId) {
    console.log('[crm/meetings] no tracked platform event to cancel:', { provider, externalId })
    return { cancelled: false }
  }

  try {
    if (provider === 'google_meet') {
      const integ = await getConnectedGoogleIntegration(clientId)
      if (!integ) return { cancelled: false, error: 'Google Calendar not connected' }
      console.log('[crm/meetings] cancelling google event:', externalId, 'host:', integ.hostEmail)
      await cancelGoogleCalendarEvent(integ.accessToken, externalId)
      console.log('[crm/meetings] google event delete request completed:', externalId)
    } else if (provider === 'zoom') {
      const integ = await getConnectedZoomIntegration(clientId)
      if (!integ) return { cancelled: false, error: 'Zoom not connected' }
      await cancelZoomMeeting(integ.accessToken, externalId)
    } else if (provider === 'calendly') {
      const { data: row } = await admin
        .from('user_integrations')
        .select('access_token')
        .eq('client_id', clientId)
        .eq('provider', 'calendly')
        .eq('status', 'connected')
        .maybeSingle()
      const stored = (row as { access_token: string | null } | null)?.access_token
      if (!stored) return { cancelled: false, error: 'Calendly not connected' }
      const { openSecret } = await import('@/lib/crypto/secretBox')
      await cancelCalendlyEvent(openSecret(stored), externalId)
    } else {
      return { cancelled: false }
    }
    return { cancelled: true }
  } catch (err) {
    console.error('[crm/meetings] platform cancel failed:', err)
    return { cancelled: false, error: err instanceof Error ? err.message : 'Platform cancel failed' }
  }
}

// Moves the meeting to a new time on whichever platform created it, so the
// provider sends its own update to attendees. Google patches the event time
// (sendUpdates=all emails attendees); Zoom patches start_time + duration.
// Calendly bookings are owned by the invitee and can't be moved via API, so
// they're a soft no-op. Failures are surfaced softly - our DB time + our own
// email already went out.
async function rescheduleOnPlatform(
  meeting: MeetingRow,
  startIso: string,
  durationMinutes: number,
): Promise<{ updated: boolean; error?: string }> {
  const { integration_provider: provider, external_id: externalId, client_id: clientId } = meeting
  if (!provider || !externalId) return { updated: false }

  try {
    if (provider === 'google_meet') {
      const integ = await getConnectedGoogleIntegration(clientId)
      if (!integ) return { updated: false, error: 'Google Calendar not connected' }
      const endIso = new Date(new Date(startIso).getTime() + durationMinutes * 60000).toISOString()
      await updateGoogleCalendarEventTime(integ.accessToken, externalId, startIso, endIso)
    } else if (provider === 'zoom') {
      const integ = await getConnectedZoomIntegration(clientId)
      if (!integ) return { updated: false, error: 'Zoom not connected' }
      await updateZoomMeeting(integ.accessToken, externalId, startIso, durationMinutes)
    } else {
      // Calendly (or anything else): nothing we can move from our side.
      return { updated: false }
    }
    return { updated: true }
  } catch (err) {
    console.error('[crm/meetings] platform reschedule failed:', err)
    return { updated: false, error: err instanceof Error ? err.message : 'Platform reschedule failed' }
  }
}

// PATCH = status change. When the new status is 'cancelled' we also
// cancel the meeting on the external platform. 'completed' / 'scheduled'
// only touch our DB.
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params
    const auth = await loadAuthorizedMeeting(id)
    if ('error' in auth) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
    }
    const { supabase, meeting } = auth

    const body = (await req.json().catch(() => ({}))) as {
      status?: string
      dateTimeIso?: string
      durationMinutes?: number
    }

    // Reschedule path: update the meeting's date/time (+ optional duration).
    // The page sends the attendee + in-app notifications after this succeeds
    // (client-side, so the time formats in the user's timezone).
    if (body.dateTimeIso) {
      const when = new Date(body.dateTimeIso)
      if (Number.isNaN(when.getTime())) {
        return NextResponse.json({ success: false, error: 'Invalid date/time' }, { status: 400 })
      }
      const newDuration =
        typeof body.durationMinutes === 'number' && body.durationMinutes > 0
          ? body.durationMinutes
          : meeting.duration_minutes || 30
      const patch: Record<string, unknown> = {
        date_time: when.toISOString(),
        duration_minutes: newDuration,
      }
      const { error } = await supabase.from('meetings').update(patch).eq('id', id)
      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 })
      }

      // Move the event on the connected platform so it sends its own update.
      const platform = await rescheduleOnPlatform(meeting, when.toISOString(), newDuration)

      return NextResponse.json({
        success: true,
        rescheduled: true,
        platformUpdated: platform.updated,
        platformError: platform.error ?? null,
      })
    }

    const status = body.status
    if (status !== 'scheduled' && status !== 'completed' && status !== 'cancelled') {
      return NextResponse.json({ success: false, error: 'Invalid status' }, { status: 400 })
    }

    let platform: { cancelled: boolean; error?: string } = { cancelled: false }
    if (status === 'cancelled') {
      platform = await cancelOnPlatform(meeting)
    }

    const { error } = await supabase.from('meetings').update({ status }).eq('id', id)
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      platformCancelled: platform.cancelled,
      platformError: platform.error ?? null,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}

// DELETE = remove the meeting from our records AND cancel it on the
// external platform first (best-effort). We cancel before deleting so
// the row's external_id is still available; a platform failure does not
// block the local delete.
export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params
    const auth = await loadAuthorizedMeeting(id)
    if ('error' in auth) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
    }
    const { supabase, meeting } = auth

    const platform = await cancelOnPlatform(meeting)

    const { error } = await supabase.from('meetings').delete().eq('id', id)
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      platformCancelled: platform.cancelled,
      platformError: platform.error ?? null,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
