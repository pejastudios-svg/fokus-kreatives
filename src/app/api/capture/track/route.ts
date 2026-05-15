// POST /api/capture/track
//
// Public endpoint. The capture page calls this on:
//   - mount: { event: 'start', slug, visitorId } → returns sessionId
//   - field interaction: { event: 'field', sessionId, fieldId }
//   - page exit (sendBeacon): { event: 'unload', sessionId, durationSeconds }
//
// Service role for inserts so RLS doesn't block public visitors.
// We do NOT trust slug as a CRM identifier - the visitor knows it
// because they reached the page, and that's the only fact we need.

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { isBotUserAgent } from '@/lib/botDetection'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const admin = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

interface TrackBody {
  event: 'start' | 'field' | 'unload'
  slug?: string
  sessionId?: string
  visitorId?: string
  fieldId?: string
  durationSeconds?: number
  referrer?: string | null
  userAgent?: string | null
}

export async function POST(req: NextRequest) {
  let body: TrackBody
  try {
    body = (await req.json()) as TrackBody
  } catch {
    return NextResponse.json({ success: false, error: 'Bad JSON' }, { status: 400 })
  }

  try {
    if (body.event === 'start') {
      if (!body.slug || !body.visitorId) {
        return NextResponse.json(
          { success: false, error: 'Missing slug or visitorId' },
          { status: 400 },
        )
      }
      // Bot filter: don't create sessions for crawlers, link
      // previewers, or headless browsers. Their visits would inflate
      // the funnel without representing a real conversion opportunity.
      // We use both the client-sent UA (in case they spoofed it
      // through fetch) AND the request's actual UA header. Either
      // looking bot-y is enough to skip.
      const clientUa = body.userAgent || ''
      const requestUa = req.headers.get('user-agent') || ''
      if (isBotUserAgent(clientUa) || isBotUserAgent(requestUa)) {
        return NextResponse.json({ success: true, sessionId: null, bot: true })
      }
      // Resolve slug → capture_page.id once. If the page doesn't
      // exist we just no-op (visitor probably hit a stale URL).
      const { data: page } = await admin
        .from('capture_pages')
        .select('id')
        .eq('slug', body.slug)
        .maybeSingle()
      if (!page) {
        return NextResponse.json({ success: true, sessionId: null })
      }
      const { data: row, error } = await admin
        .from('capture_sessions')
        .insert({
          capture_page_id: page.id,
          visitor_id: body.visitorId,
          referrer: body.referrer ?? null,
          user_agent: body.userAgent ?? null,
        })
        .select('id')
        .single()
      if (error || !row) {
        console.error('[capture/track] start insert failed:', error)
        return NextResponse.json(
          { success: false, error: 'Insert failed' },
          { status: 500 },
        )
      }
      return NextResponse.json({ success: true, sessionId: row.id })
    }

    if (body.event === 'field') {
      if (!body.sessionId || !body.fieldId) {
        return NextResponse.json(
          { success: false, error: 'Missing sessionId or fieldId' },
          { status: 400 },
        )
      }
      // Only update last_field_id - we don't track every focus event
      // as its own row, just the most recent one. That's all the
      // drop-off query needs.
      await admin
        .from('capture_sessions')
        .update({ last_field_id: body.fieldId })
        .eq('id', body.sessionId)
      return NextResponse.json({ success: true })
    }

    if (body.event === 'unload') {
      if (!body.sessionId) {
        return NextResponse.json(
          { success: false, error: 'Missing sessionId' },
          { status: 400 },
        )
      }
      const duration =
        typeof body.durationSeconds === 'number' && body.durationSeconds > 0
          ? Math.min(body.durationSeconds, 60 * 60 * 4) // cap at 4h to ignore zombie tabs
          : null
      await admin
        .from('capture_sessions')
        .update({
          ended_at: new Date().toISOString(),
          duration_seconds: duration,
        })
        .eq('id', body.sessionId)
      return NextResponse.json({ success: true })
    }

    return NextResponse.json(
      { success: false, error: 'Unknown event' },
      { status: 400 },
    )
  } catch (err) {
    console.error('[capture/track] error:', err)
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Server error' },
      { status: 500 },
    )
  }
}
