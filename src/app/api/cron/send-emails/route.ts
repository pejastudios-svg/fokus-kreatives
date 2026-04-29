import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  admin as outboxAdmin,
  claimDueEmails,
  deliverEmail,
  markFailed,
  markSent,
  selectDueEmailIds,
} from '@/lib/emailOutbox'

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

    // Raw probe: build a fresh client at request time (no module-scope
    // cache) and run progressively narrower queries. The first one that
    // returns 0 rows is the filter that's breaking.
    let probe: Record<string, unknown> = {}
    try {
      const fresh = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
      )
      const nowIso = new Date().toISOString()
      const all = await fresh
        .from('email_outbox')
        .select('id, status, next_attempt_at', { count: 'exact', head: false })
      const pendingOnly = await fresh
        .from('email_outbox')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending')
      const dueOnly = await fresh
        .from('email_outbox')
        .select('id', { count: 'exact', head: true })
        .lte('next_attempt_at', nowIso)
      const fullClaim = await fresh
        .from('email_outbox')
        .select('id')
        .eq('status', 'pending')
        .lte('next_attempt_at', nowIso)
        .order('next_attempt_at', { ascending: true })
        .limit(25)
      // Read-only sanity check via the lib's exported admin() so the probe
      // confirms the lib's client construction is sound. We deliberately do
      // NOT call claimDueEmails here - that would consume rows the main
      // flow then tries to send.
      const viaLibClient = outboxAdmin()
      const viaLib = await viaLibClient
        .from('email_outbox')
        .select('id')
        .eq('status', 'pending')
        .lte('next_attempt_at', nowIso)
        .order('next_attempt_at', { ascending: true })
        .limit(25)

      // Read-only call to the lib's SELECT step. If this is 3 but the
      // main flow's claimed.length is 0, the bug is purely in the UPDATE
      // path of claimDueEmails - not in the SELECT. (Doesn't consume rows.)
      let selectFnCount: number | null = null
      let selectFnError: string | null = null
      try {
        const ids = await selectDueEmailIds(25)
        selectFnCount = ids.length
      } catch (e) {
        selectFnError = e instanceof Error ? e.message : String(e)
      }

      probe = {
        nowIso,
        allCount: all.count,
        pendingCount: pendingOnly.count,
        dueCount: dueOnly.count,
        fullClaimCount: fullClaim.data?.length ?? null,
        fullClaimError: fullClaim.error?.message ?? null,
        viaLibCount: viaLib.data?.length ?? null,
        viaLibError: viaLib.error?.message ?? null,
        selectFnCount,
        selectFnError,
        sampleRow: all.data?.[0] ?? null,
      }
    } catch (e) {
      probe = { probeException: e instanceof Error ? e.message : String(e) }
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

    return NextResponse.json({ success: true, claimed: claimed.length, sent, failed, env, probe })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('cron/send-emails error:', err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
