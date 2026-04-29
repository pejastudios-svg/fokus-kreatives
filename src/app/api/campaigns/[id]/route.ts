import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { clickupConfigured, deleteClickUpTask } from '@/app/api/clickup/helpers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const admin = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

/**
 * Delete a campaign. Two modes via the ?clickup=… query param:
 *   - clickup=delete  → also deletes the matching ClickUp task (which
 *                       cascades to its subtasks)
 *   - anything else   → deletes only the row in our DB; the ClickUp task
 *                       stays put so the agency can keep working it there
 */
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params
    if (!id) {
      return NextResponse.json({ success: false, error: 'Missing id' }, { status: 400 })
    }

    const url = new URL(req.url)
    const alsoDeleteClickup = url.searchParams.get('clickup') === 'delete'

    const sb = admin()

    // Look up the row first so we know the clickup_task_id (if we're going
    // to delete it from ClickUp too) before we drop the row.
    const { data: row, error: loadErr } = await sb
      .from('campaigns')
      .select('id, clickup_task_id')
      .eq('id', id)
      .maybeSingle()
    if (loadErr) {
      console.error('campaign load error:', loadErr)
      return NextResponse.json(
        { success: false, error: loadErr.message },
        { status: 500 },
      )
    }
    if (!row) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 })
    }

    let clickupError: string | null = null
    if (alsoDeleteClickup && row.clickup_task_id && clickupConfigured()) {
      const res = await deleteClickUpTask(row.clickup_task_id as string)
      if (!res.ok) clickupError = res.error || 'ClickUp delete failed'
    }

    const { error: delErr } = await sb.from('campaigns').delete().eq('id', id)
    if (delErr) {
      console.error('campaign delete error:', delErr)
      return NextResponse.json(
        { success: false, error: delErr.message },
        { status: 500 },
      )
    }

    return NextResponse.json({ success: true, clickupError })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('DELETE /api/campaigns/[id] exception:', err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
