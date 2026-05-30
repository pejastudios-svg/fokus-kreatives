import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { getConnectedGoogleIntegration } from '@/lib/integrations/googleTokenStore'
import { getConnectedZoomIntegration } from '@/lib/integrations/zoomTokenStore'
import { cancelGoogleCalendarEvent } from '@/lib/integrations/google'
import { cancelZoomMeeting } from '@/lib/integrations/zoom'
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
    .select('id, client_id, status, integration_provider, external_id')
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
      const token = (row as { access_token: string | null } | null)?.access_token
      if (!token) return { cancelled: false, error: 'Calendly not connected' }
      await cancelCalendlyEvent(token, externalId)
    } else {
      return { cancelled: false }
    }
    return { cancelled: true }
  } catch (err) {
    console.error('[crm/meetings] platform cancel failed:', err)
    return { cancelled: false, error: err instanceof Error ? err.message : 'Platform cancel failed' }
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

    const body = (await req.json().catch(() => ({}))) as { status?: string }
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
