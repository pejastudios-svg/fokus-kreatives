import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { updateClickUpStatus } from '@/app/api/clickup/helpers'
import { enqueueEmail } from '@/lib/emailOutbox'

// Types for Supabase responses
interface ClientRef {
  name: string | null
  business_name: string | null
}

interface ApprovalItem {
  status: string
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
    const { approvalId, actorId } = await req.json()

    if (!approvalId) {
      return NextResponse.json({ success: false, error: 'Missing approvalId' }, { status: 400 })
    }

    const { data: approval, error: apprErr } = await supabase
      .from('approvals')
      .select('id, status, clickup_task_id, title, client_id, clients(name, business_name)')
      .eq('id', approvalId)
      .single()

    const approvalWithClients = approval as unknown as { clients: ClientRef | ClientRef[] | null }
    const relClients = approvalWithClients?.clients
    
    let clientDisplayName = 'Client'
    if (Array.isArray(relClients) && relClients.length > 0) {
      clientDisplayName = relClients[0]?.business_name || relClients[0]?.name || 'Client'
    } else if (relClients && !Array.isArray(relClients)) {
      const singleClient = relClients as ClientRef
      clientDisplayName = singleClient.business_name || singleClient.name || 'Client'
    }

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

        const allApproved = (items || []).length > 0 && (items || []).every((i: ApprovalItem) => i.status === 'approved')
    const newStatus = allApproved ? 'approved' : 'pending'
    const statusWas = approval.status

    // Only write if changed
    if (approval.status !== newStatus) {
      await supabase
        .from('approvals')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', approvalId)
    }

    // Notify + email when it transitions to approved
if (statusWas !== 'approved' && newStatus === 'approved') {
  // Load assignees
  const { data: assigneesRows } = await supabase
    .from('approval_assignees')
    .select('user_id')
    .eq('approval_id', approvalId)

  const assigneeIds = Array.from(
    new Set((assigneesRows || []).map((r: AssigneeRow) => r.user_id).filter(Boolean))
  ).filter((id) => id !== actorId)

  // In-app notification (drives popup + sound)
  if (assigneeIds.length > 0) {
    await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/notifications/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userIds: assigneeIds,
        type: 'approval_approved',
        data: {
          approvalId,
          title: approval.title,
          clientName: clientDisplayName,
        },
      }),
    })

    // Emails via Apps Script, split client/team URLs
    const { data: users } = await supabase
      .from('users')
      .select('id, email, role')
      .in('id', assigneeIds)

    const clientEmails = (users || [])
      .filter((u: UserRow) => u.role === 'client')
      .map((u: UserRow) => u.email)
      .filter(Boolean)

    const teamEmails = (users || [])
      .filter((u: UserRow) => u.role !== 'client')
      .map((u: UserRow) => u.email)
      .filter(Boolean)

    const portalUrl = `${process.env.NEXT_PUBLIC_APP_URL}/portal/approvals/${approvalId}`
    const agencyUrl = `${process.env.NEXT_PUBLIC_APP_URL}/approvals/${approvalId}`

    if (clientEmails.length > 0) {
      await enqueueEmail({
        type: 'approval_approved',
        payload: {
          to: clientEmails,
          clientName: clientDisplayName,
          approvalTitle: approval.title,
          approvalId,
          url: portalUrl,
        },
        idempotencyKey: `recompute-approve:${approvalId}:client`,
      })
    }

    if (teamEmails.length > 0) {
      await enqueueEmail({
        type: 'approval_approved',
        payload: {
          to: teamEmails,
          clientName: clientDisplayName,
          approvalTitle: approval.title,
          approvalId,
          url: agencyUrl,
        },
        idempotencyKey: `recompute-approve:${approvalId}:team`,
      })
    }
  }
}

    if (approval.clickup_task_id) {
      await updateClickUpStatus(
        approval.clickup_task_id as string,
        allApproved ? 'approved' : 'waiting'
      )
    }

    return NextResponse.json({ success: true, status: newStatus })
  } catch (err: unknown) {
    console.error('Recompute approval status error:', err)
    const errorMessage = err instanceof Error ? err.message : 'Server error'
    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    )
  }
}