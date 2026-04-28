import { NextRequest, NextResponse } from 'next/server'
import {
  reviewAdmin,
  loadApprovalByShareToken,
  readReviewSessionFromRequest,
} from '@/lib/reviewSession'

export const dynamic = 'force-dynamic'

/**
 * Public-facing read of an approval. Takes ?token=<share_token>. The page
 * uses this both pre-verify (to know what approval the user is reviewing)
 * and post-verify (to render the assets).
 *
 * Pre-verify: returns approval title + client name + booleans about session
 *             state. Never returns asset URLs or comments without a valid
 *             session cookie.
 * Post-verify: returns full asset list + comments.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const token = (searchParams.get('token') || '').trim()
    if (!token) {
      return NextResponse.json({ success: false, error: 'Missing token' }, { status: 400 })
    }

    const approval = await loadApprovalByShareToken(token)
    if (!approval) {
      return NextResponse.json({ success: false, error: 'Invalid link' }, { status: 404 })
    }

    const session = await readReviewSessionFromRequest(approval.id)

    const clientsField = (approval as unknown as { clients: unknown }).clients
    const clientObj = Array.isArray(clientsField) ? clientsField[0] : clientsField
    const clientName =
      (clientObj as { business_name?: string; name?: string } | null)?.business_name ||
      (clientObj as { name?: string } | null)?.name ||
      'Client'
    const clientPicture = (clientObj as { profile_picture_url?: string | null } | null)
      ?.profile_picture_url || null

    const summary = {
      approvalId: approval.id as string,
      title: approval.title as string,
      description: (approval.description as string | null) ?? null,
      status: approval.status as string,
      clientName,
      clientPicture,
    }

    if (!session) {
      return NextResponse.json({
        success: true,
        authed: false,
        approval: summary,
      })
    }

    // Authed — load items + comments + the team assignees the reviewer can
    // @-mention. Clients themselves are excluded so the picker doesn't show
    // the reviewer their own row.
    const [itemsRes, commentsRes, assigneesRes] = await Promise.all([
      reviewAdmin
        .from('approval_items')
        .select('id, title, url, initial_comment, status, position, attachments, is_carousel, kind')
        .eq('approval_id', approval.id)
        .order('position', { ascending: true }),
      reviewAdmin
        .from('approval_comments')
        .select(
          'id, approval_item_id, content, created_at, user_id, reviewer_email, attachments, file_url, file_name, users:user_id (name, email, profile_picture_url)',
        )
        .eq('approval_id', approval.id)
        .order('created_at', { ascending: true }),
      reviewAdmin
        .from('approval_assignees')
        .select('user_id, users:user_id (id, name, email, role, profile_picture_url)')
        .eq('approval_id', approval.id),
    ])

    type AssigneeRow = {
      user_id: string
      users:
        | {
            id: string
            name: string | null
            email: string | null
            role: string | null
            profile_picture_url: string | null
          }
        | null
        | {
            id: string
            name: string | null
            email: string | null
            role: string | null
            profile_picture_url: string | null
          }[]
    }

    // Dedupe by user_id — a single user can have multiple `approval_assignees`
    // rows (e.g. assigned in two roles), and React doesn't tolerate duplicate
    // keys in the mention picker.
    const assigneesById = new Map<
      string,
      { id: string; name: string; profile_picture_url: string | null }
    >()
    for (const row of (assigneesRes.data || []) as AssigneeRow[]) {
      const u = Array.isArray(row.users) ? row.users[0] : row.users
      if (!u || u.role === 'client') continue
      if (assigneesById.has(u.id)) continue
      assigneesById.set(u.id, {
        id: u.id,
        name: u.name || u.email || 'User',
        profile_picture_url: u.profile_picture_url || null,
      })
    }
    const assignees = Array.from(assigneesById.values())

    return NextResponse.json({
      success: true,
      authed: true,
      email: session.email,
      approval: summary,
      items: itemsRes.data || [],
      comments: commentsRes.data || [],
      assignees,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('review/state error:', err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
