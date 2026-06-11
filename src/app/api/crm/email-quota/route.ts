// GET /api/crm/email-quota?clientId=...
//
// Quota readout for the two email channels, shown in CRM Settings:
//   - smtp: the client's connected Gmail. No remaining-quota API exists, so
//     we count our own sends (email_send_log) in a rolling 24h window against
//     Gmail's ~500/day cap. resetsAt = when the oldest send in the window
//     falls out of it.
//   - appsScript: the shared agency sender. Apps Script DOES expose the live
//     remaining quota (MailApp.getRemainingDailyQuota) - fetched through the
//     webhook's 'quota' handler. Null when the deployed script predates it.

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const admin = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// Gmail's documented sending cap for regular accounts via SMTP.
const GMAIL_SMTP_DAILY_LIMIT = 500

export async function GET(req: NextRequest) {
  const clientId = new URL(req.url).searchParams.get('clientId')
  if (!clientId) {
    return NextResponse.json({ success: false, error: 'Missing clientId' }, { status: 400 })
  }
  const { authorizeForClient } = await import('@/lib/crm/teamAuth')
  const auth = await authorizeForClient(clientId, { level: 'member' })
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  // --- SMTP (client's Gmail) ------------------------------------------------
  let smtp: {
    connected: boolean
    address?: string
    used?: number
    limit?: number
    remaining?: number
    resetsAt?: string | null
  } = { connected: false }

  const { data: integ } = await admin
    .from('user_integrations')
    .select('metadata, status')
    .eq('client_id', clientId)
    .eq('provider', 'gmail_smtp')
    .maybeSingle()

  if (integ?.status === 'connected') {
    const address =
      ((integ.metadata as { gmail_address?: string } | null) || {}).gmail_address || ''
    const { data: sends } = await admin
      .from('email_send_log')
      .select('created_at')
      .eq('client_id', clientId)
      .eq('channel', 'smtp')
      .gte('created_at', since)
      .order('created_at', { ascending: true })

    const used = sends?.length ?? 0
    const oldest = sends?.[0]?.created_at as string | undefined
    smtp = {
      connected: true,
      address,
      used,
      limit: GMAIL_SMTP_DAILY_LIMIT,
      remaining: Math.max(0, GMAIL_SMTP_DAILY_LIMIT - used),
      // The window rolls: capacity frees up as the oldest send ages out.
      resetsAt: oldest
        ? new Date(new Date(oldest).getTime() + 24 * 60 * 60 * 1000).toISOString()
        : null,
    }
  }

  // --- Apps Script (shared sender) ------------------------------------------
  // `used` is OUR ledger (email_send_log, one row per recipient) and is the
  // number to trust for "what did this email cost": it moves by exactly the
  // recipient count of each send. Google's `remaining` is shown too, but it
  // updates lazily (often minutes behind) and is drained by everything the
  // agency account sends - script crons, other CRMs - so it can move in
  // jumps that have nothing to do with the email you just sent.
  const { count: scriptUsed } = await admin
    .from('email_send_log')
    .select('id', { count: 'exact', head: true })
    .eq('channel', 'apps_script')
    .gte('created_at', since)

  const { data: oldestRow } = await admin
    .from('email_send_log')
    .select('created_at')
    .eq('channel', 'apps_script')
    .gte('created_at', since)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  const appsScript: { used: number; remaining: number | null; resetsAt: string | null } = {
    used: scriptUsed ?? 0,
    remaining: null,
    // The window rolls: capacity frees up as the oldest send ages out.
    resetsAt: oldestRow?.created_at
      ? new Date(
          new Date(oldestRow.created_at as string).getTime() + 24 * 60 * 60 * 1000,
        ).toISOString()
      : null,
  }

  try {
    const scriptUrl = process.env.APPS_SCRIPT_WEBHOOK_URL
    const secret = process.env.APPS_SCRIPT_SECRET
    if (scriptUrl && secret) {
      const res = await fetch(scriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret, type: 'quota', payload: {} }),
        signal: AbortSignal.timeout(8000),
      })
      const text = await res.text()
      const parsed = JSON.parse(text) as { remaining?: number }
      if (typeof parsed.remaining === 'number') {
        appsScript.remaining = parsed.remaining
      }
    }
  } catch {
    // Old script deployment (no 'quota' case) or network blip - the UI shows
    // our own counter and skips the live-remaining line.
  }

  return NextResponse.json({ success: true, smtp, appsScript })
}
