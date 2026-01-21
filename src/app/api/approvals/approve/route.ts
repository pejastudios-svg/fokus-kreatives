import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { updateClickUpStatus } from '@/app/api/clickup/helpers'

// Types for Supabase responses
interface ClientRef {
  name: string | null
  business_name: string | null
}

interface AssigneeRow {
  user_id: string
}

interface UserRow {
  id: string
  email: string | null
  role: string
}

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
    // Cast approval to a shape that includes the clients relation
    const relClients = (approval as unknown as { clients: ClientRef | ClientRef[] }).clients

    if (Array.isArray(relClients) && relClients.length > 0) {
      clientDisplayName =
        relClients[0].business_name || relClients[0].name || 'Client'
    } else if (relClients && !Array.isArray(relClients)) {
      clientDisplayName =
        (relClients as ClientRef).business_name || (relClients as ClientRef).name || 'Client'
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

            const watcherIds = (assigneesRows || []).map((r: AssigneeRow) => r.user_id).filter(Boolean)
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
  const secret = process.env.APPS_SCRIPT_SECRET
  if (secret && uniqueWatcherIds.length > 0) {
    const { data: watcherUsers } = await supabase
      .from('users')
      .select('id, email, role')
      .in('id', uniqueWatcherIds)

    const clientEmails = (watcherUsers || [])
      .filter((u: UserRow) => u.role === 'client')
      .map((u: UserRow) => u.email)
      .filter((e: string | null) => !!e)

    const teamEmails = (watcherUsers || [])
      .filter((u: UserRow) => u.role !== 'client')
      .map((u: UserRow) => u.email)
      .filter((e: string | null) => !!e)

    const portalUrl = `${process.env.NEXT_PUBLIC_APP_URL}/portal/approvals/${approvalId}`
    const agencyUrl = `${process.env.NEXT_PUBLIC_APP_URL}/approvals/${approvalId}`

    if (clientEmails.length > 0) {
      await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/notify-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'approval_approved',
          payload: {
            secret,
            to: clientEmails,
            clientName: clientDisplayName,
            approvalTitle: approval.title,
            approvalId,
            url: portalUrl,
          },
        }),
      })
    }

    if (teamEmails.length > 0) {
      await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/notify-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'approval_approved',
          payload: {
            secret,
            to: teamEmails,
            clientName: clientDisplayName,
            approvalTitle: approval.title,
            approvalId,
            url: agencyUrl,
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
  } catch (err: unknown) {
    console.error('Approval approve error:', err)
    const errorMessage = err instanceof Error ? err.message : 'Server error'
    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    )
  }
}