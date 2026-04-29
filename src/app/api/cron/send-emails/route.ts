import { NextRequest, NextResponse } from 'next/server'
import { claimDueEmails, deliverEmail, markFailed, markSent } from '@/lib/emailOutbox'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Drain the email_outbox. Each tick claims up to N due rows, calls Apps
 * Script for each one, and marks the row sent or failed (with backoff).
 *
 * Schedule (Vercel Cron): every minute. The route is also safe to hit
 * manually via the dashboard or curl when debugging.
 *
 * Auth: same pattern as the other cron routes - `?secret=<CRON_SECRET>`.
 */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const secret = url.searchParams.get('secret')
    const envSecret = process.env.CRON_SECRET
    if (envSecret && secret !== envSecret) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }

    const claimed = await claimDueEmails(25)
    let sent = 0
    let failed = 0

    // Send sequentially - Apps Script doesn't appreciate parallel hammering
    // and the volume is low enough that latency-stacking 25 sends per minute
    // is fine. If volume grows we can move to a small Promise.all batch.
    for (const row of claimed) {
      try {
        await deliverEmail(row)
        await markSent(row.id)
        sent++
      } catch (err) {
        await markFailed(row.id, row.attempts, err)
        failed++
      }
    }

    return NextResponse.json({ success: true, claimed: claimed.length, sent, failed })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('cron/send-emails error:', err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
