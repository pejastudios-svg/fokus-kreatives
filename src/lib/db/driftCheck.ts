// Schema drift detection.
//
// Lists tables + columns the app expects to exist. On dev-server start
// we hit information_schema and log loud warnings for anything missing.
// Catches the class of bug where a migration file is committed but the
// database hasn't been migrated yet ("column X.Y does not exist" at
// request time).
//
// This is non-fatal - the server still boots if a check fails. Goal is
// to put a clear marker in the terminal so you spot the problem before
// you hit it in the UI.

import { createClient } from '@supabase/supabase-js'

// Tables + columns this app touches. Update when adding new ones.
// Keep this lean: only list columns that an outage of would cause an
// immediate, hard-to-diagnose error. RPCs are checked separately.
const EXPECTED_COLUMNS: Record<string, string[]> = {
  content_plan_slots: [
    'id',
    'client_id',
    'stream',
    'scheduled_date',
    'status',
    'generation_lock_at',
    'generation_lock_token',
  ],
  campaigns: [
    'id',
    'client_id',
    'name',
    'status',
    'clickup_task_id',
    'tier_at_creation',
  ],
  clients: [
    'id',
    'name',
    'business_name',
    'package_tier',
    'clickup_folder_id',
    'clickup_list_id',
  ],
}

// RPCs that must exist (PGRST202 if they don't). Listed as
// schema.fn(arg1_type, arg2_type, ...) so we can compare against
// pg_proc / information_schema.routines.
const EXPECTED_RPCS = [
  'acquire_slot_generation_lock',
  'release_slot_generation_lock',
]

export async function runDriftCheck(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.warn('[drift-check] Supabase env vars not set; skipping schema drift check.')
    return
  }

  const supabase = createClient(url, key)

  // 1. Columns: select information_schema.columns for the tables we know
  //    about. Compare against EXPECTED_COLUMNS, log anything missing.
  try {
    const tables = Object.keys(EXPECTED_COLUMNS)
    const { data: rows, error } = await supabase
      .schema('information_schema')
      .from('columns')
      .select('table_name, column_name')
      .in('table_name', tables)
      .eq('table_schema', 'public')
    if (error) {
      console.warn('[drift-check] could not query information_schema:', error.message)
      return
    }
    const present = new Map<string, Set<string>>()
    for (const r of rows ?? []) {
      const t = (r as { table_name: string }).table_name
      const c = (r as { column_name: string }).column_name
      if (!present.has(t)) present.set(t, new Set())
      present.get(t)!.add(c)
    }
    const missing: string[] = []
    for (const [table, cols] of Object.entries(EXPECTED_COLUMNS)) {
      const have = present.get(table)
      if (!have) {
        missing.push(`${table}: TABLE MISSING`)
        continue
      }
      for (const c of cols) {
        if (!have.has(c)) missing.push(`${table}.${c}`)
      }
    }
    if (missing.length > 0) {
      console.warn('')
      console.warn('=================================================================')
      console.warn('[drift-check] SCHEMA DRIFT DETECTED')
      console.warn('  Expected columns missing from your DB:')
      for (const m of missing) console.warn(`    - ${m}`)
      console.warn('  Run `npm run db:migrate:status` to see pending migrations,')
      console.warn('  then `npm run db:migrate` to apply them.')
      console.warn('=================================================================')
      console.warn('')
    } else {
      console.log('[drift-check] schema: ok')
    }
  } catch (err) {
    console.warn('[drift-check] columns check failed:', err instanceof Error ? err.message : err)
  }

  // 2. RPCs: call each with a zero-UUID and inspect the error code.
  //    PGRST202 = function doesn't exist. Any other error (or success)
  //    means the function is installed.
  const missingRpcs: string[] = []
  for (const fn of EXPECTED_RPCS) {
    try {
      const { error } = await supabase.rpc(fn, {
        p_slot_id: '00000000-0000-0000-0000-000000000000',
        p_token: 'drift-check',
      })
      if (error && (error.code === 'PGRST202' || /function .* does not exist/i.test(error.message))) {
        missingRpcs.push(fn)
      }
    } catch {
      // ignore - any non-PGRST202 outcome means the function exists
    }
  }
  if (missingRpcs.length > 0) {
    console.warn('')
    console.warn('=================================================================')
    console.warn('[drift-check] MISSING RPCs')
    for (const fn of missingRpcs) console.warn(`    - ${fn}`)
    console.warn('  Run `npm run db:migrate` to apply pending migrations.')
    console.warn('=================================================================')
    console.warn('')
  }
}
