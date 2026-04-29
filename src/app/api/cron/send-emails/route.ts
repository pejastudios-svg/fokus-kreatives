import { NextRequest, NextResponse } from 'next/server'
import { claimDueEmails, deliverEmail, markFailed, markSent } from '@/lib/emailOutbox'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Best-effort decode of a Supabase JWT to report its `role` claim. Used only
 * for diagnostics in the worker response - if this returns "anon" the wrong
 * key is wired into SUPABASE_SERVICE_ROLE_KEY. We don't verify the signature;
 * we only need the claim.
 */
function decodeJwtRole(jwt: string | undefined): string | null {
  if (!jwt) return null
  const parts = jwt.split('.')
  if (parts.length < 2) return null
  try {
    const payload = Buffer.from(parts[1], 'base64url').toString('utf8')
    const obj = JSON.parse(payload) as { role?: string }
    return obj.role || null
  } catch {
    return null
  }
}

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

    // Surface env-var presence in the response so Apps Script logs show it
    // immediately if a key is missing - saves a Vercel-logs round-trip when
    // diagnosing the cron worker.
    // Pull the project ref out of the URL so we can compare it against the
    // Supabase dashboard without leaking the full URL. Format:
    // https://<projectref>.supabase.co
    const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
    const projectRef = (() => {
      try {
        const host = new URL(supaUrl).hostname
        return host.split('.')[0] || null
      } catch {
        return null
      }
    })()
    // Also surface the JWT's `ref` claim (Supabase puts the project ref in
    // the JWT). If projectRef !== jwtRef, the URL and key are from
    // different projects.
    const jwtRef = (() => {
      const jwt = process.env.SUPABASE_SERVICE_ROLE_KEY
      if (!jwt) return null
      const parts = jwt.split('.')
      if (parts.length < 2) return null
      try {
        const payload = JSON.parse(
          Buffer.from(parts[1], 'base64url').toString('utf8'),
        ) as { ref?: string }
        return payload.ref || null
      } catch {
        return null
      }
    })()
    const env = {
      hasSupabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
      projectRef,
      hasServiceRole: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      serviceRoleClaim: decodeJwtRole(process.env.SUPABASE_SERVICE_ROLE_KEY),
      jwtRef,
      hasAppsScriptUrl: !!process.env.APPS_SCRIPT_WEBHOOK_URL,
      hasAppsScriptSecret: !!process.env.APPS_SCRIPT_SECRET,
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

    return NextResponse.json({ success: true, claimed: claimed.length, sent, failed, env })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('cron/send-emails error:', err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
