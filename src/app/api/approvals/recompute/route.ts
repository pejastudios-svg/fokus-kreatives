import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { updateClickUpStatus } from '@/app/api/clickup/helpers'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  try {
    const { approvalId, actorId } = await req.json()

    if (!approvalId) {
      return NextResponse.json({ success: false, error: 'Missing approvalId' }, { status: 400 })
    }

    const { data: approval, error: apprErr } = await supabase
      .from('approvals')
      .select('id, status, clickup_task_id, title, client_id, clients(name, business_name)')
      .eq('id', approvalId)
      .single()

    if (apprErr || !approval) {
      return NextResponse.json({ success: false, error: 'Approval not found' }, { status: 404 })
    }

    const { data: items, error: itemsErr } = await supabase
      .from('approval_items')
      .select('status')
      .eq('approval_id', approvalId)

    if (itemsErr) {
      return NextResponse.json({ success: false, error: 'Failed to load items' }, { status: 500 })
    }

    const allApproved = (items || []).length > 0 && (items || []).every((i: any) => i.status === 'approved')
    const newStatus = allApproved ? 'approved' : 'pending'

    // Only write if changed
    if (approval.status !== newStatus) {
      await supabase
        .from('approvals')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', approvalId)
    }

    if (approval.clickup_task_id) {
      await updateClickUpStatus(
        approval.clickup_task_id as string,
        allApproved ? 'approved' : 'waiting'
      )
    }

    // Notify ONLY when it transitions to approved
    if (approval.status !== 'approved' && newStatus === 'approved') {
      // Load assignees
      const { data: assigneesRows } = await supabase
        .from('approval_assignees')
        .select('user_id')
        .eq('approval_id', approvalId)

      const watcherIds = (assigneesRows || []).map((r: any) => r.user_id).filter(Boolean)
      const uniqueIds = Array.from(new Set(watcherIds)).filter((id) => id !== actorId)

      const relClients: any = (approval as any).clients
      const clientName =
        (Array.isArray(relClients) ? relClients[0]?.business_name || relClients[0]?.name : relClients?.business_name || relClients?.name) || 'Client'

      if (uniqueIds.length > 0) {
        await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/notifications/create`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userIds: uniqueIds,
            type: 'approval_approved',
            data: {
              approvalId,
              title: approval.title,
               clientName: clientDisplayName,
              actorId: actorId || null,
            },
          }),
        })

        // Email
        await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/notify-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'approval_approved',
            payload: {
              to: uniqueIds, // if your Apps Script expects emails, change this to emails; otherwise keep IDs if it maps
              clientName,
              approvalTitle: approval.title,
            },
          }),
        })
      }
    }

    return NextResponse.json({ success: true, status: newStatus })
  } catch (err: any) {
    console.error('Recompute approval status error:', err)
    return NextResponse.json(
      { success: false, error: err?.message || 'Server error' },
      { status: 500 }
    )
  }
}