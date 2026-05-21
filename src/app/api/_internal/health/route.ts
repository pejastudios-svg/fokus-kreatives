// GET /api/_internal/health
//
// Post-deploy smoke check. Exercises the moving parts that have failed
// silently in the past:
//   - Supabase reachability + service-role auth (SELECT now())
//   - Generation-lock RPCs are installed (acquire / release a no-op lock
//     against a UUID that won't match any real slot - we want PGRST202
//     "function does not exist" to be the failure mode that surfaces if
//     the migration didn't apply)
//   - Expected lock columns exist on content_plan_slots (catches the
//     specific class of bug we hit on 2026-05-21)
//   - ClickUp env vars are present (we don't actually hit ClickUp's API
//     here - just confirm the integration is configured)
//
// Each check returns { ok, ms, detail }. Top-level `ok` is the AND of
// all checks. Returns 200 either way - the consumer decides what to do
// with a failed check. Cheap to call; safe to ping from a cron.

import { NextResponse } from 'next/server'
import { adminDb } from '@/lib/admin/db'
import { clickupConfigured } from '@/app/api/clickup/helpers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface CheckResult {
  ok: boolean
  ms: number
  detail?: string
}

async function timed<T>(fn: () => Promise<T>): Promise<{ value?: T; error?: string; ms: number }> {
  const started = Date.now()
  try {
    const value = await fn()
    return { value, ms: Date.now() - started }
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : String(err),
      ms: Date.now() - started,
    }
  }
}

// A UUID that we expect will never match a real slot. The RPC returns
// NULL when no row matches, which is the success signal for "function
// exists and is callable". If the function isn't installed we'd get
// PGRST202 / "function does not exist" instead.
const NEVER_MATCHES_UUID = '00000000-0000-0000-0000-000000000000'

export async function GET() {
  const supabase = adminDb()
  const checks: Record<string, CheckResult> = {}

  // 1. DB reachability + service-role auth
  {
    const { value, error, ms } = await timed(async () => {
      const { data, error: e } = await supabase.rpc('acquire_slot_generation_lock', {
        p_slot_id: NEVER_MATCHES_UUID,
        p_token: 'health-check',
      })
      if (e) throw new Error(`${e.code ?? ''} ${e.message}`.trim())
      return data
    })
    checks.db_rpc_acquire_lock = {
      ok: error === undefined && value === null,
      ms,
      detail: error ?? (value === null ? 'returned null (expected for no-match UUID)' : `unexpected return: ${String(value)}`),
    }
  }

  // 2. Release-lock RPC is callable (void return, so we just check it
  //    doesn't error). Same no-match UUID so it's a guaranteed no-op.
  {
    const { error, ms } = await timed(async () => {
      const { error: e } = await supabase.rpc('release_slot_generation_lock', {
        p_slot_id: NEVER_MATCHES_UUID,
        p_token: 'health-check',
      })
      if (e) throw new Error(`${e.code ?? ''} ${e.message}`.trim())
    })
    checks.db_rpc_release_lock = {
      ok: error === undefined,
      ms,
      detail: error ?? 'callable',
    }
  }

  // 3. Lock columns exist on content_plan_slots. Direct information_schema
  //    query via rpc would be heavier - instead we select the columns and
  //    expect "no rows" or rows back, not a 42703 column-missing error.
  {
    const { error, ms } = await timed(async () => {
      const { error: e } = await supabase
        .from('content_plan_slots')
        .select('id, generation_lock_at, generation_lock_token')
        .limit(1)
      if (e) throw new Error(`${e.code ?? ''} ${e.message}`.trim())
    })
    checks.db_columns_lock = {
      ok: error === undefined,
      ms,
      detail: error ?? 'generation_lock_at + generation_lock_token both present',
    }
  }

  // 4. ClickUp env configured. We don't hit ClickUp's API here - the
  //    campaigns route's self-heal will catch a stale list at use time.
  //    This just confirms the env vars are loaded.
  {
    const started = Date.now()
    const ok = clickupConfigured()
    checks.clickup_configured = {
      ok,
      ms: Date.now() - started,
      detail: ok
        ? 'CLICKUP_API_TOKEN + CLICKUP_SPACE_ID both set'
        : 'one or both of CLICKUP_API_TOKEN / CLICKUP_SPACE_ID is missing',
    }
  }

  const ok = Object.values(checks).every((c) => c.ok)
  return NextResponse.json(
    {
      ok,
      checked_at: new Date().toISOString(),
      checks,
    },
    { status: 200 },
  )
}
