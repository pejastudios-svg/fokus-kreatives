import { createClient as createServiceClient } from '@supabase/supabase-js'

/**
 * Durable email outbox - replaces the old fetch('/api/notify-email')
 * fire-and-forget pattern. Routes enqueue rows here; a cron worker drains
 * the table with retry/backoff so a transient Apps Script blip can't lose
 * a notification.
 *
 * Idempotency: callers pass a stable `idempotencyKey` (e.g.
 * `comment:<id>:broadcast`). A unique index on the column collapses
 * duplicate enqueues at the DB layer, so a retried POST never double-sends.
 */

/**
 * Build a fresh service-role client per call. Module-scope caching
 * breaks intermittently in Vercel serverless reuse - the cached client's
 * auth state can drift across warm-lambda invocations and the SELECT path
 * returns empty without erroring. Per-call construction is cheap (the
 * client is just a config wrapper) and fixes it deterministically.
 *
 * No auth options - default `persistSession: true` is fine in serverless
 * (no localStorage to persist into) and matches what the rest of the
 * codebase uses, so we don't trip any edge case the diagnostic probe
 * already proved works.
 */
export function admin() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export interface EmailEnqueueArgs {
  /** Apps Script email type: 'approval_comment', 'approval_mention', etc. */
  type: string
  /** Whatever the Apps Script template needs - to, urls, snippets, etc. */
  payload: Record<string, unknown>
  /** Stable de-dup key. Same key twice in a row is a no-op. */
  idempotencyKey?: string
}

const MAX_ATTEMPTS = 5

/**
 * Enqueue an email. Returns true if a new row was inserted, false if the
 * idempotency key collided (already enqueued in a previous request).
 *
 * Errors during enqueue are logged but do NOT throw - the caller's primary
 * write (the comment, the approval) shouldn't fail just because the email
 * couldn't be queued. The cron worker will eventually catch up if the row
 * does land; this is purely a "couldn't even insert" guard.
 */
export async function enqueueEmail(args: EmailEnqueueArgs): Promise<boolean> {
  try {
    const insert = await admin()
      .from('email_outbox')
      .insert({
        type: args.type,
        payload: args.payload,
        idempotency_key: args.idempotencyKey ?? null,
      })
      .select('id')
      .maybeSingle()

    if (insert.error) {
      // Unique-violation on idempotency_key is expected when a request is
      // retried - silently swallow. Anything else is a real failure.
      const code = (insert.error as { code?: string }).code
      if (code === '23505') return false
      console.error('email_outbox enqueue error:', insert.error)
      return false
    }
    return Boolean(insert.data)
  } catch (err) {
    console.error('email_outbox enqueue exception:', err)
    return false
  }
}

interface OutboxRow {
  id: string
  type: string
  payload: Record<string, unknown>
  attempts: number
}

/**
 * Atomically claim up to `limit` due rows. Sets status='sending' so a
 * concurrent worker tick can't grab the same row.
 *
 * We can't use `FOR UPDATE SKIP LOCKED` through the REST client, so the
 * claim is "set status='sending' WHERE id IN (SELECT ... pending due)" and
 * we trust the worker to only run on one schedule at a time. If two
 * workers race the same row, one of them just no-ops on the second update.
 */
/**
 * Read-only helper: returns the IDs of pending due rows. Exposed separately
 * so the cron route can probe the SELECT step in isolation when diagnosing.
 */
export async function selectDueEmailIds(limit = 25): Promise<string[]> {
  const nowIso = new Date().toISOString()
  const { data, error } = await admin()
    .from('email_outbox')
    .select('id')
    .eq('status', 'pending')
    .lte('next_attempt_at', nowIso)
    .order('next_attempt_at', { ascending: true })
    .limit(limit)
  if (error) {
    console.error('email_outbox due-select error:', error)
    throw error
  }
  return (data || []).map((r) => r.id as string)
}

export async function claimDueEmails(limit = 25): Promise<OutboxRow[]> {
  const ids = await selectDueEmailIds(limit)
  if (ids.length === 0) return []

  // Flip the rows to 'sending', then SELECT them as a separate call. The
  // chained `.update(...).in(...).select(...)` pattern returned empty data
  // in production despite the WHERE actually matching - sidestep that
  // entirely by doing the two operations independently.
  //
  // Throw on errors instead of returning [] so the cron route surfaces the
  // exact PostgREST message - silent empty arrays mask CHECK-constraint
  // violations and other "shouldn't happen" failures.
  const { error: updateErr } = await admin()
    .from('email_outbox')
    .update({ status: 'sending' })
    .in('id', ids)
  if (updateErr) {
    console.error('email_outbox claim update error:', updateErr)
    throw new Error(`claim update: ${updateErr.message || JSON.stringify(updateErr)}`)
  }

  const { data: rows, error: selectErr } = await admin()
    .from('email_outbox')
    .select('id, type, payload, attempts')
    .in('id', ids)
  if (selectErr) {
    console.error('email_outbox claim select error:', selectErr)
    throw new Error(`claim select: ${selectErr.message || JSON.stringify(selectErr)}`)
  }
  return (rows || []) as OutboxRow[]
}

export async function markSent(id: string): Promise<void> {
  await admin()
    .from('email_outbox')
    .update({ status: 'sent', sent_at: new Date().toISOString(), last_error: null })
    .eq('id', id)
}

/**
 * On failure: bump attempts, schedule the next retry with exponential
 * backoff (2^attempts minutes, capped). After MAX_ATTEMPTS hand it off to
 * `dead` so it stops cycling - a human can inspect the row.
 */
export async function markFailed(id: string, attempts: number, err: unknown): Promise<void> {
  const nextAttempts = attempts + 1
  const errMsg = err instanceof Error ? err.message : String(err)
  if (nextAttempts >= MAX_ATTEMPTS) {
    await admin()
      .from('email_outbox')
      .update({
        status: 'dead',
        attempts: nextAttempts,
        last_error: errMsg.slice(0, 1000),
      })
      .eq('id', id)
    return
  }
  // 2^n minutes: 2, 4, 8, 16, 32. Cap at 60.
  const backoffMs = Math.min(60, 2 ** nextAttempts) * 60 * 1000
  await admin()
    .from('email_outbox')
    .update({
      status: 'pending',
      attempts: nextAttempts,
      next_attempt_at: new Date(Date.now() + backoffMs).toISOString(),
      last_error: errMsg.slice(0, 1000),
    })
    .eq('id', id)
}

/**
 * Send a single outbox row by calling Apps Script directly. Used by the
 * cron worker. Throws on failure so the caller can run markFailed.
 */
export async function deliverEmail(row: OutboxRow): Promise<void> {
  const scriptUrl = process.env.APPS_SCRIPT_WEBHOOK_URL
  const secret = process.env.APPS_SCRIPT_SECRET
  if (!scriptUrl || !secret) {
    throw new Error('Apps Script not configured')
  }

  const res = await fetch(scriptUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      secret,
      type: row.type,
      payload: row.payload,
    }),
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`Apps Script ${res.status}: ${text.slice(0, 500)}`)
  }
}
