// POST /api/planner/slot/[id]/generate-script
//
// Generates a full script for the planner slot and stores it in
// generation_meta.script + generation_meta.checklist. Flips the slot's
// status to 'drafted' on success. Returns the script + checklist so the
// UI can render immediately without re-fetching the slot.
//
// 'approved' slots are immutable - the underlying generator throws.
//
// Two layers of concurrency guarding:
//   - Per-slot lock (inside generateScriptForSlot): prevents the same
//     slot from being generated twice simultaneously. Returns 409 +
//     GENERATION_IN_FLIGHT.
//   - Per-client concurrency cap (this route): prevents too many
//     DIFFERENT slot generations from running in parallel for the same
//     client. Cap is MAX_CONCURRENT_PER_CLIENT (currently 4). Returns
//     429 + CONCURRENCY_LIMIT. The bulk-campaign dispatcher throttles
//     to this number client-side so legitimate bulk work never trips it.

import { NextRequest, NextResponse } from 'next/server'
import { generateScriptForSlot, GenerationLockedError } from '@/lib/planner/generateScript'
import {
  withClientConcurrency,
  ConcurrencyLimitError,
} from '@/lib/ai/concurrency'
import { plannerAdmin } from '@/lib/planner/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Script generation chains several model calls (draft + person check +
// polish + grammar + caption/hashtag repairs + retries). Pin the duration
// so a slow-but-recoverable run isn't killed by the platform default.
export const maxDuration = 300

export async function POST(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params
    if (!id) {
      return NextResponse.json({ success: false, error: 'Missing slot id' }, { status: 400 })
    }

    // Look up the slot's client_id so the concurrency cap is per-client.
    // Cheap single-row query. Done before the per-slot lock acquire so
    // a hot client can be rejected without burning a lock slot.
    const supabase = plannerAdmin()
    const { data: slotRow, error: slotErr } = await supabase
      .from('content_plan_slots')
      .select('client_id')
      .eq('id', id)
      .maybeSingle()
    if (slotErr || !slotRow) {
      return NextResponse.json(
        { success: false, error: 'Slot not found' },
        { status: 404 },
      )
    }
    const clientId = slotRow.client_id as string

    const result = await withClientConcurrency(clientId, () =>
      generateScriptForSlot(id),
    )
    return NextResponse.json({
      success: true,
      script: result.scriptText,
      checklist: result.checklist,
      polish: result.polish ?? null,
    })
  } catch (err) {
    if (err instanceof GenerationLockedError) {
      return NextResponse.json(
        { success: false, error: err.message, code: 'GENERATION_IN_FLIGHT' },
        { status: 409 },
      )
    }
    if (err instanceof ConcurrencyLimitError) {
      return NextResponse.json(
        { success: false, error: err.message, code: 'CONCURRENCY_LIMIT' },
        { status: 429 },
      )
    }
    const msg = err instanceof Error ? err.message : String(err)
    console.error('planner/slot/generate-script error:', err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
