import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { updateClickUpStatus } from '@/app/api/clickup/helpers'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const secret = url.searchParams.get('secret')
  const envSecret = process.env.CRON_SECRET
  const vercelCron = req.headers.get('x-vercel-cron')

  if (envSecret && !vercelCron && secret !== envSecret) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const nowIso = new Date().toISOString()

  const { data: approvals, error } = await supabase
    .from('approvals')
    .select('id, clickup_task_id, title, client_id, clients(name, business_name)')
    .eq('status', 'pending')
    .not('auto_approve_at', 'is', null)
    .lte('auto_approve_at', nowIso)

  if (error) {
    console.error('auto-approve load approvals error', error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  let processed = 0

  for (const a of approvals || []) {
    const approvalId = a.id as string

    // Approve all items
    await supabase
      .from('approval_items')
      .update({ status: 'approved', updated_at: nowIso })
      .eq('approval_id', approvalId)

    // Approve approval
    await supabase
      .from('approvals')
      .update({ status: 'approved', updated_at: nowIso })
      .eq('id', approvalId)

    // ClickUp approved
    if (a.clickup_task_id) {
      await updateClickUpStatus(a.clickup_task_id as string, 'approved')
    }

    // Notify assignees (in-app + email)
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

      // emails
      const { data: users } = await supabase.from('users').select('id, email').in('id', userIds)
      const emails = (users || []).map((u: any) => u.email).filter(Boolean)

      if (emails.length > 0) {
        await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/notify-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'approval_approved',
            payload: { to: emails, clientName, approvalTitle: a.title, approvalId },
          }),
        })
      }
    }

    processed++
  }

  return NextResponse.json({ success: true, processed })
}