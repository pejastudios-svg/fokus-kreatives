import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { updateClickUpStatus } from '@/app/api/clickup/helpers'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  // Optional simple protection
  const auth = req.headers.get('authorization') || ''
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date().toISOString()

  const { data: approvals, error } = await supabase
    .from('approvals')
    .select('id, clickup_task_id, title, client_id, clients(name, business_name)')
    .eq('status', 'pending')
    .not('auto_approve_at', 'is', null)
    .lte('auto_approve_at', now)

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  for (const a of approvals || []) {
    const approvalId = a.id as string

    // approve all items
    await supabase
      .from('approval_items')
      .update({ status: 'approved', updated_at: now })
      .eq('approval_id', approvalId)

    // approve approval
    await supabase
      .from('approvals')
      .update({ status: 'approved', updated_at: now })
      .eq('id', approvalId)

    // clickup
    if (a.clickup_task_id) {
      await updateClickUpStatus(a.clickup_task_id as string, 'approved')
    }

    // notify assignees
    const { data: assignees } = await supabase
      .from('approval_assignees')
      .select('user_id')
      .eq('approval_id', approvalId)

    const userIds = Array.from(new Set((assignees || []).map((r: any) => r.user_id).filter(Boolean)))

    const relClients: any = (a as any).clients
    const clientName =
      (Array.isArray(relClients) ? relClients[0]?.business_name || relClients[0]?.name : relClients?.business_name || relClients?.name) || 'Client'

    if (userIds.length > 0) {
      await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/notifications/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userIds,
          type: 'approval_approved',
          data: { approvalId, title: a.title, clientName, actorId: null },
        }),
      })

      await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/notify-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'approval_approved',
          payload: { to: userIds, clientName, approvalTitle: a.title },
        }),
      })
    }
  }

  return NextResponse.json({ success: true, processed: (approvals || []).length })
}