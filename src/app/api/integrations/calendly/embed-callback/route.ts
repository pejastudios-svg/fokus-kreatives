// POST /api/integrations/calendly/embed-callback
//
// Body: { slug: string, eventUri: string, inviteeUri: string }
//
// PUBLIC endpoint (no auth header) - called from the embedded Calendly
// widget on the public capture page when a visitor finishes booking.
//
// Why this exists: Calendly's webhooks require a Standard+ plan, so
// free-tier accounts can't get server-pushed booking notifications.
// The inline-embed widget emits a postMessage on the visitor's
// browser which the widget component forwards here. We then verify
// the URIs against Calendly's API (using the host's stored PAT) and
// insert into the meetings table. This is identical in outcome to
// the webhook path - just initiated client-side.
//
// Security: we DO NOT trust the URIs blindly. A hostile caller could
// POST garbage. By fetching the event + invitee from Calendly with
// the host's PAT before inserting, we prove the booking actually
// exists in the host's Calendly account. Combined with the strict
// URI regex check below, the worst a hostile caller can do is hit
// Calendly with junk URIs - which Calendly rejects.
//
// Idempotency: UNIQUE INDEX on (integration_provider, external_id)
// where external_id = invitee URI. Multiple fires of the same
// event_scheduled message turn into no-ops.

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { mapCalendlyLocationType } from '@/lib/integrations/calendly'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const admin = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

interface CalendlyEventResource {
  name: string
  start_time: string
  end_time: string
  location?: { join_url?: string | null; type?: string | null } | null
}

interface CalendlyInviteeResource {
  name: string
  email: string
}

export async function POST(req: NextRequest) {
  try {
    const { slug, eventUri, inviteeUri } = (await req.json()) as {
      slug?: string
      eventUri?: string
      inviteeUri?: string
    }

    if (!slug || !eventUri || !inviteeUri) {
      return NextResponse.json(
        { success: false, error: 'Missing slug / eventUri / inviteeUri' },
        { status: 400 },
      )
    }

    // Strict URI shape check. Calendly resource URIs are always
    // https://api.calendly.com/scheduled_events/<uuid>[/invitees/<uuid>].
    // Anything else is treated as hostile input.
    const eventOk =
      /^https:\/\/api\.calendly\.com\/scheduled_events\/[A-Za-z0-9-]+$/.test(eventUri)
    const inviteeOk =
      /^https:\/\/api\.calendly\.com\/scheduled_events\/[A-Za-z0-9-]+\/invitees\/[A-Za-z0-9-]+$/.test(
        inviteeUri,
      )
    if (!eventOk || !inviteeOk) {
      return NextResponse.json(
        { success: false, error: 'Invalid Calendly URIs' },
        { status: 400 },
      )
    }

    // slug → capture page → client_id → connected Calendly integration.
    // We require the page to actually have meeting_integration='calendly'
    // so callers can't pivot through an unrelated CRM.
    const { data: page } = await admin
      .from('capture_pages')
      .select('client_id, meeting_integration')
      .eq('slug', slug)
      .maybeSingle()

    if (!page || page.meeting_integration !== 'calendly') {
      return NextResponse.json(
        { success: false, error: 'No Calendly integration on this page' },
        { status: 404 },
      )
    }

    const { data: integration } = await admin
      .from('user_integrations')
      .select('access_token, user_id')
      .eq('client_id', page.client_id)
      .eq('provider', 'calendly')
      .eq('status', 'connected')
      .maybeSingle()

    const stored = integration?.access_token
    if (!stored) {
      return NextResponse.json(
        { success: false, error: 'Calendly not connected' },
        { status: 404 },
      )
    }
    const { openSecret } = await import('@/lib/crypto/secretBox')
    const token = openSecret(stored)

    // Fetch event + invitee in parallel. The host's PAT proves we
    // own the booking; the fetch failing means either the URI is
    // forged or the booking was already canceled.
    const [eventRes, inviteeRes] = await Promise.all([
      fetch(eventUri, { headers: { Authorization: `Bearer ${token}` } }),
      fetch(inviteeUri, { headers: { Authorization: `Bearer ${token}` } }),
    ])

    if (!eventRes.ok || !inviteeRes.ok) {
      console.error(
        '[calendly/embed-callback] verify failed',
        eventRes.status,
        inviteeRes.status,
      )
      return NextResponse.json(
        { success: false, error: 'Could not verify booking with Calendly' },
        { status: 502 },
      )
    }

    const eventJson = (await eventRes.json()) as { resource: CalendlyEventResource }
    const inviteeJson = (await inviteeRes.json()) as { resource: CalendlyInviteeResource }
    const event = eventJson.resource
    const invitee = inviteeJson.resource

    const joinUrl = event.location?.join_url || null
    const startMs = Date.parse(event.start_time)
    const endMs = Date.parse(event.end_time)
    const durationMin = Math.max(15, Math.round((endMs - startMs) / 60000))

    const { error: insertErr } = await admin.from('meetings').insert({
      client_id: page.client_id,
      created_by: integration.user_id,
      title: event.name,
      description: null,
      date_time: event.start_time,
      duration_minutes: durationMin,
      status: 'scheduled',
      location_type: mapCalendlyLocationType(event.location?.type),
      location_url: joinUrl,
      integration_provider: 'calendly',
      external_id: inviteeUri,
      attendee_name: invitee.name,
      attendee_email: invitee.email,
    })

    if (insertErr) {
      // Unique-constraint violation = we already logged this booking
      // (the visitor's browser fired event_scheduled twice, or they
      // re-navigated to the page). Not an error.
      if (insertErr.code === '23505') {
        return NextResponse.json({ success: true, deduped: true })
      }
      console.error('[calendly/embed-callback] insert error:', insertErr)
      return NextResponse.json(
        { success: false, error: 'Could not save meeting' },
        { status: 500 },
      )
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[calendly/embed-callback] error:', err)
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Server error' },
      { status: 500 },
    )
  }
}
