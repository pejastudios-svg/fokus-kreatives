import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const slug = searchParams.get('slug')

  if (!slug) {
    return NextResponse.json(
      { success: false, error: 'Missing slug' },
      { status: 400 }
    )
  }

  // Don't filter by is_active in the query - we want to distinguish
  // "page doesn't exist" (genuine 404) from "page exists but the
  // owner toggled it off" so the public page can show an accurate
  // message in each case. Returning the same generic error for both
  // made the Active toggle feel broken: the user couldn't tell
  // whether the off state was actually taking effect.
  const { data, error } = await supabase
    .from('capture_pages')
    .select(
      'id, client_id, name, slug, headline, description, lead_magnet_url, is_active, logo_url, banner_url, include_meeting, calendly_url, meeting_integration, success_button_text, success_message, accent_color, fields, theme, layout_template',
    )
    .eq('slug', slug)
    .maybeSingle()

  if (error || !data) {
    if (error) console.error('[capture/info] select error:', error)
    return NextResponse.json(
      { success: false, error: 'Page not found', code: 'NOT_FOUND' },
      { status: 404 },
    )
  }

  if (!data.is_active) {
    return NextResponse.json(
      {
        success: false,
        error: 'This page is currently paused. Please check back later.',
        code: 'INACTIVE',
      },
      { status: 410 }, // 410 Gone - the page exists but isn't available
    )
  }

  // When the page is wired to a CRM-wide meeting integration, resolve
  // the provider's scheduling URL from user_integrations and overlay
  // it onto calendly_url so the public renderer (which already knows
  // how to embed a scheduler iframe) renders the integration's URL
  // without needing per-page configuration. Bookings auto-log into
  // the meetings table via the provider webhook, so the manual
  // date/time confirmation can be skipped.
  let resolvedCalendlyUrl: string | null = data.calendly_url
  let meetingAutoLogged = false
  if (data.include_meeting && data.meeting_integration === 'calendly') {
    const { data: intRow } = await supabase
      .from('user_integrations')
      .select('metadata, status')
      .eq('client_id', data.client_id)
      .eq('provider', 'calendly')
      .eq('status', 'connected')
      .maybeSingle()
    if (intRow) {
      const meta = (intRow.metadata ?? null) as
        | { scheduling_url?: string; webhook_registered?: boolean }
        | null
      // Per-page override (the picked event-type's scheduling URL,
      // stored in calendly_url) wins over the integration's main
      // scheduling page. Without an override visitors see the host
      // page that lists every event type. Either source produces a
      // valid embed URL.
      resolvedCalendlyUrl = data.calendly_url || meta?.scheduling_url || null
      // Auto-logging is gated on the integration being CONNECTED, not
      // on metadata having scheduling_url - the embed callback can log
      // bookings as long as the connection is alive, regardless of
      // which URL drives the embed. Both webhook-tier and free-tier
      // accounts auto-log this way.
      if (resolvedCalendlyUrl) {
        meetingAutoLogged = true
      }
    }
  }

  return NextResponse.json({
    success: true,
    page: {
      ...data,
      calendly_url: resolvedCalendlyUrl,
      meeting_auto_logged: meetingAutoLogged,
    },
  })
}