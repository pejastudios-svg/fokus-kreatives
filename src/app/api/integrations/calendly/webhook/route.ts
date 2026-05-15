// POST /api/integrations/calendly/webhook
//
// Calendly posts here when a visitor books (invitee.created) or
// cancels (invitee.canceled). We verify the signature against the
// signing_key stored at connect time, then upsert into the meetings
// table.
//
// The endpoint is PUBLIC (no auth header) - we authenticate the
// payload via the Calendly-Webhook-Signature header instead.
//
// Idempotency: external_id is the invitee URI which is unique per
// booking. The UNIQUE INDEX (integration_provider, external_id)
// means a re-fired webhook turns into a no-op.

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import {
  verifyCalendlySignature,
  mapCalendlyLocationType,
  type CalendlyInviteeCreatedPayload,
} from '@/lib/integrations/calendly'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const admin = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

interface IntegrationRow {
  client_id: string
  user_id: string
  metadata: { webhook_signing_key?: string; calendly_user_uri?: string } | null
}

export async function POST(req: NextRequest) {
  // Read raw body BEFORE JSON parsing - signature verification needs
  // the exact string Calendly signed.
  const rawBody = await req.text()
  const signatureHeader = req.headers.get('calendly-webhook-signature')

  let payload: CalendlyInviteeCreatedPayload
  try {
    payload = JSON.parse(rawBody) as CalendlyInviteeCreatedPayload
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 })
  }

  // Find the integration row that issued this webhook. Calendly
  // doesn't include our internal client_id in the payload, so we
  // look it up by the booked event's owner URI (organizer's user URI
  // is in the scheduled_event's event_memberships in the full payload,
  // but for the basic invitee.created we have the invitee + event).
  //
  // Strategy: list connected Calendly integrations and try each
  // signing key. The first one that verifies is the owner. This is
  // O(N integrations across the whole system) but in practice N is
  // small (one per CRM) and a webhook fires ~once per booking.
  const { data: rows } = await admin
    .from('user_integrations')
    .select('client_id, user_id, metadata')
    .eq('provider', 'calendly')
    .eq('status', 'connected')

  const integrations = (rows ?? []) as IntegrationRow[]

  let matched: IntegrationRow | null = null
  for (const row of integrations) {
    const key = row.metadata?.webhook_signing_key
    if (!key) continue
    // eslint-disable-next-line no-await-in-loop
    const ok = await verifyCalendlySignature(rawBody, signatureHeader, key)
    if (ok) {
      matched = row
      break
    }
  }

  if (!matched) {
    // Either the signature is forged or we have no integration that
    // matches. Don't leak which.
    console.warn('[calendly/webhook] no matching integration for signature')
    return NextResponse.json(
      { success: false, error: 'Signature verification failed' },
      { status: 401 },
    )
  }

  // Handle the event.
  if (payload.event === 'invitee.created') {
    const inv = payload.payload
    const scheduled = inv.scheduled_event
    const joinUrl = scheduled.location?.join_url || null
    const startMs = Date.parse(scheduled.start_time)
    const endMs = Date.parse(scheduled.end_time)
    const durationMin = Math.max(15, Math.round((endMs - startMs) / 60000))

    const { error } = await admin.from('meetings').insert({
      client_id: matched.client_id,
      created_by: matched.user_id,
      title: scheduled.name,
      description: null,
      date_time: scheduled.start_time,
      duration_minutes: durationMin,
      status: 'scheduled',
      location_type: mapCalendlyLocationType(scheduled.location?.type),
      location_url: joinUrl,
      integration_provider: 'calendly',
      external_id: inv.uri,
      attendee_name: inv.name,
      attendee_email: inv.email,
    })

    if (error) {
      // Unique-constraint violation on (integration_provider,
      // external_id) means we already recorded this booking. That's
      // not an error - Calendly retries webhooks on 500s.
      if (error.code === '23505') {
        return NextResponse.json({ success: true, deduped: true })
      }
      console.error('[calendly/webhook] insert meeting failed:', error)
      return NextResponse.json(
        { success: false, error: 'Could not save meeting' },
        { status: 500 },
      )
    }

    return NextResponse.json({ success: true })
  }

  if (payload.event === 'invitee.canceled') {
    const inv = payload.payload
    const { error } = await admin
      .from('meetings')
      .update({ status: 'cancelled' })
      .eq('integration_provider', 'calendly')
      .eq('external_id', inv.uri)
    if (error) {
      console.error('[calendly/webhook] cancel update failed:', error)
    }
    return NextResponse.json({ success: true })
  }

  // Unknown event - acknowledge so Calendly stops retrying.
  return NextResponse.json({ success: true, ignored: payload.event })
}
