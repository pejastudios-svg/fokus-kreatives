// src/app/api/approvals/approve/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { updateClickUpStatus } from '@/app/api/clickup/helpers'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const approvalId = body.approvalId as string
    const actorId = body.actorId as string
    const approved = body.approved !== false  // default true

    if (!approvalId || !actorId) {
      return NextResponse.json(
        { success: false, error: 'Missing approvalId or actorId' },
        { status: 400 }
      )
    }

    // 1) Load approval and client info
    const { data: approval, error: approvalError } = await supabase
      .from('approvals')
      .select(
        'id, client_id, title, clickup_task_id, status, client_id, clients(name, business_name)'
      )
      .eq('id', approvalId)
      .single()

    if (approvalError || !approval) {
      return NextResponse.json(
        { success: false, error: 'Approval not found' },
        { status: 404 }
      )
    }

    // Safely extract client display name from joined clients relation
    let clientDisplayName = 'Client'
    const relClients: any = (approval as any).clients

    if (Array.isArray(relClients) && relClients.length > 0) {
      clientDisplayName =
        relClients[0].business_name || relClients[0].name || 'Client'
    } else if (relClients) {
      clientDisplayName =
        relClients.business_name || relClients.name || 'Client'
    }

    if (approved && approval.status === 'approved') {
      return NextResponse.json({ success: true, alreadyApproved: true })
    }

    const nowIso = new Date().toISOString()
    const newStatus = approved ? 'approved' : 'pending'

    // 2) Update approval_items
    const { error: itemsError } = await supabase
      .from('approval_items')
      .update({ status: newStatus, updated_at: nowIso })
      .eq('approval_id', approvalId)

    if (itemsError) {
      console.error('Approval items update error:', itemsError)
    }

    // 3) Update approvals
    const { error: approvalUpdateError } = await supabase
      .from('approvals')
      .update({
        status: newStatus,
        updated_at: nowIso,
      })
      .eq('id', approvalId)

    if (approvalUpdateError) {
      console.error('Approval status update error:', approvalUpdateError)
      return NextResponse.json(
        { success: false, error: 'Failed to update approval' },
        { status: 500 }
      )
    }

        // 4) Sync ClickUp status
    if (approval.clickup_task_id) {
      if (approved) {
        await updateClickUpStatus(approval.clickup_task_id as string, 'approved')
      } else {
        await updateClickUpStatus(approval.clickup_task_id as string, 'waiting')
      }
    }

        if (approved) {
      // 5) Load watchers (assignees) for notifications
      const { data: assigneesRows } = await supabase
        .from('approval_assignees')
        .select('user_id')
        .eq('approval_id', approvalId)

      const watcherIds = (assigneesRows || []).map((r: any) => r.user_id).filter(Boolean)
      const uniqueWatcherIds = Array.from(new Set(watcherIds))

      // 6) In-app notifications
      try {
        if (uniqueWatcherIds.length > 0) {
          await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/notifications/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userIds: uniqueWatcherIds,
              type: 'approval_approved',
              data: {
                approvalId,
                title: approval.title,
                clientName: clientDisplayName,
                actorId,
              },
            }),
          })
        }
      } catch (notifyErr) {
        console.error('Approval approved in-app notification error:', notifyErr)
      }

      // 7) Email notifications via Apps Script
      try {
        const scriptUrl = process.env.APPS_SCRIPT_WEBHOOK_URL
        const secret = process.env.APPS_SCRIPT_SECRET

        if (scriptUrl && secret && uniqueWatcherIds.length > 0) {
          const { data: watcherUsers } = await supabase
            .from('users')
            .select('id, email')
            .in('id', uniqueWatcherIds)

          const emails = (watcherUsers || [])
            .map((u: any) => u.email)
            .filter((e: string | null) => !!e)

          if (emails.length > 0) {
            await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/notify-email`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                type: 'approval_approved',
                payload: {
                  secret,
                  to: emails,
                  clientName: clientDisplayName,
                  approvalTitle: approval.title,
                },
              }),
            })
          }
        }
      } catch (emailErr) {
        console.error('Approval approved email notification error:', emailErr)
      }
    }

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('Approval approve error:', err)
    return NextResponse.json(
      { success: false, error: err?.message || 'Server error' },
      { status: 500 }
    )
  }
}