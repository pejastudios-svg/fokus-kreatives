import { NextRequest, NextResponse } from 'next/server'
import {
  reviewAdmin,
  loadApprovalByShareToken,
  readReviewSessionFromRequest,
} from '@/lib/reviewSession'

export const dynamic = 'force-dynamic'

/**
 * Public: toggle a single asset's status. Body: { token, itemId, approved }.
 * Requires a verified review session cookie for the matching approval.
 *
 * Triggers /api/approvals/recompute so ClickUp + status notifications still
 * fire exactly the same way they would from the agency UI.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { token?: string; itemId?: string; approved?: boolean }
    const token = (body.token || '').trim()
    const itemId = (body.itemId || '').trim()
    if (!token || !itemId || typeof body.approved !== 'boolean') {
      return NextResponse.json({ success: false, error: 'Missing token, itemId, or approved' }, { status: 400 })
    }

    const approval = await loadApprovalByShareToken(token)
    if (!approval) {
      return NextResponse.json({ success: false, error: 'Invalid link' }, { status: 404 })
    }

    const session = await readReviewSessionFromRequest(approval.id)
    if (!session) {
      return NextResponse.json({ success: false, error: 'Not signed in' }, { status: 401 })
    }

    // Item must belong to this approval.
    const { data: item } = await reviewAdmin
      .from('approval_items')
      .select('id, approval_id')
      .eq('id', itemId)
      .maybeSingle()
    if (!item || item.approval_id !== approval.id) {
      return NextResponse.json({ success: false, error: 'Item not found' }, { status: 404 })
    }

    const nextStatus = body.approved ? 'approved' : 'pending'
    const { error: updErr } = await reviewAdmin
      .from('approval_items')
      .update({ status: nextStatus, updated_at: new Date().toISOString() })
      .eq('id', itemId)
    if (updErr) {
      console.error('review approve update error:', updErr)
      return NextResponse.json({ success: false, error: 'Update failed' }, { status: 500 })
    }

    // Reuse the existing recompute path (rolls up approval status + ClickUp +
    // notifications). Not awaiting - fire-and-forget keeps the response fast.
    try {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin
      void fetch(`${appUrl}/api/approvals/recompute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approvalId: approval.id, actorId: null }),
      }).catch((e) => console.error('review approve recompute error:', e))
    } catch (e) {
      console.error('review approve recompute trigger error:', e)
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('review/approve error:', err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
