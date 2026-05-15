// Bulk delete slots + stories in a date range. Two modes:
//   safe (default) - wipes status='planned' AND not locked slots, plus any
//                    pinned stories that haven't been used. Preserves
//                    drafted / approved / locked work.
//   purge          - wipes EVERY slot in the range regardless of state, AND
//                    every story (pinned in range OR consumed-but-not-pinned
//                    is left alone since those have no date). Plus all
//                    UN-pinned, UN-consumed stories in the queue (so the
//                    sidebar empties too - "purge" means truly clear the
//                    plan view).
//
// Approved slots track real publishable work; we don't drop those without
// the explicit purge flag.

import { NextRequest, NextResponse } from 'next/server'
import { plannerAdmin } from '@/lib/planner/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

interface Body {
  clientId?: string
  /** Inclusive YYYY-MM-DD start. */
  from?: string
  /** Inclusive YYYY-MM-DD end. */
  to?: string
  /** Default false. When true, also deletes drafted, approved, AND locked slots. */
  purge?: boolean
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body
    if (!body.clientId) {
      return NextResponse.json({ success: false, error: 'Missing clientId' }, { status: 400 })
    }
    if (!body.from || !DATE_RE.test(body.from) || !body.to || !DATE_RE.test(body.to)) {
      return NextResponse.json({ success: false, error: 'from and to must be yyyy-mm-dd' }, { status: 400 })
    }

    // Bump end by one day so the FK uses lt() (exclusive) but the user's
    // "to" param is inclusive.
    const end = new Date(`${body.to}T00:00:00Z`)
    end.setUTCDate(end.getUTCDate() + 1)
    const endExclusive = `${end.getUTCFullYear()}-${String(end.getUTCMonth() + 1).padStart(2, '0')}-${String(end.getUTCDate()).padStart(2, '0')}`

    const supabase = plannerAdmin()

    // 1. Slots in the range.
    let slotsQuery = supabase
      .from('content_plan_slots')
      .delete({ count: 'exact' })
      .eq('client_id', body.clientId)
      .gte('scheduled_date', body.from)
      .lt('scheduled_date', endExclusive)

    if (!body.purge) {
      slotsQuery = slotsQuery.eq('status', 'planned').eq('locked', false)
    }

    const { error: slotErr, count: slotCount } = await slotsQuery
    if (slotErr) {
      console.error('planner/delete slots error:', slotErr)
      return NextResponse.json({ success: false, error: slotErr.message }, { status: 500 })
    }

    // 2. Stories pinned to dates in the range. Safe mode also limits to
    //    un-consumed; purge wipes both consumed + un-consumed in range.
    let pinnedStoriesQuery = supabase
      .from('story_queue_items')
      .delete({ count: 'exact' })
      .eq('client_id', body.clientId)
      .gte('pinned_to_date', body.from)
      .lt('pinned_to_date', endExclusive)

    if (!body.purge) {
      pinnedStoriesQuery = pinnedStoriesQuery.is('consumed_at', null)
    }

    const { error: pinnedErr, count: pinnedCount } = await pinnedStoriesQuery
    if (pinnedErr) {
      console.error('planner/delete pinned stories error:', pinnedErr)
    }

    // 3. Purge mode also wipes the entire un-consumed queue (un-pinned
    //    stories sitting in the sidebar). This makes "purge" a true reset
    //    of the planner view, not just dated content.
    let queueCount = 0
    if (body.purge) {
      const { error: queueErr, count } = await supabase
        .from('story_queue_items')
        .delete({ count: 'exact' })
        .eq('client_id', body.clientId)
        .is('consumed_at', null)
        .is('pinned_to_date', null)
      if (queueErr) {
        console.error('planner/delete queue stories error:', queueErr)
      } else {
        queueCount = count ?? 0
      }
    }

    return NextResponse.json({
      success: true,
      deleted: slotCount ?? 0,
      storiesDeleted: (pinnedCount ?? 0) + queueCount,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
