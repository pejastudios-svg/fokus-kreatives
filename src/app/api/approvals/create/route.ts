// src/app/api/approvals/create/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { fetchClickUpTaskName, updateClickUpStatus } from '@/app/api/clickup/helpers'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Shape of the request body we expect from the frontend
type CreateApprovalBody = {
  clientId: string
  title: string
  description?: string
  clickupTaskId?: string
  autoApproveMinutes?: number | null
  assigneeIds?: string[]         // agency user IDs
  items: {
    title: string
    url: string
    initialComment?: string
  }[]
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as CreateApprovalBody

    const {
      clientId,
      title,
      description,
      clickupTaskId,
      autoApproveMinutes,
      assigneeIds = [],
      items,
    } = body

    if (!clientId || !title || !items || items.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Missing clientId, title, or items' },
        { status: 400 }
      )
    }

    // Get current user (creator)
    const supaAdmin = supabase // using service client, but we need auth user from header if you want
    // In app/api with service key you don't have auth context,
    // so pass creatorId from frontend instead (safer).
    // For now, assume frontend sends creatorId in body (we'll adapt).
    const creatorId = (body as any).creatorId as string | undefined
    if (!creatorId) {
      return NextResponse.json(
        { success: false, error: 'Missing creatorId' },
        { status: 400 }
      )
    }

    // Fetch client info (for notifications)
    const { data: clientRow, error: clientError } = await supaAdmin
      .from('clients')
      .select('id, name, business_name')
      .eq('id', clientId)
      .single()

    if (clientError || !clientRow) {
      return NextResponse.json(
        { success: false, error: 'Client not found' },
        { status: 404 }
      )
    }

    const clientDisplayName = clientRow.business_name || clientRow.name || 'Client'

    // If ClickUp task ID provided, fetch name and set status to WAITING
    let clickupTaskName: string | null = null
    if (clickupTaskId) {
      clickupTaskName = await fetchClickUpTaskName(clickupTaskId)
      await updateClickUpStatus(clickupTaskId, 'waiting')
    }

    // Calculate auto-approve timestamp if provided
    let autoApproveAt: string | null = null
    if (autoApproveMinutes && autoApproveMinutes > 0) {
      const now = new Date()
      now.setMinutes(now.getMinutes() + autoApproveMinutes)
      autoApproveAt = now.toISOString()
    }

    // 1) Insert approval
    const { data: approvalRow, error: approvalError } = await supaAdmin
      .from('approvals')
      .insert({
        client_id: clientId,
        created_by: creatorId,
        title,
        description: description || null,
        clickup_task_id: clickupTaskId || null,
        clickup_task_name: clickupTaskName || null,
        status: 'pending', // initial internal status; externally "WAITING FOR FEEDBACK"
        auto_approve_at: autoApproveAt,
        auto_approve_minutes: autoApproveMinutes || null,
      })
      .select()
      .single()

    if (approvalError || !approvalRow) {
      console.error('Approval insert error:', approvalError)
      return NextResponse.json(
        { success: false, error: 'Failed to create approval' },
        { status: 500 }
      )
    }

    const approvalId = approvalRow.id as string

    // 2) Insert items
    const itemsToInsert = items.map((item, index) => ({
      approval_id: approvalId,
      title: item.title || `Asset ${index + 1}`,
      url: item.url,
      initial_comment: item.initialComment || null,
      status: 'pending',
      position: index,
    }))

    const { error: itemsError } = await supaAdmin
      .from('approval_items')
      .insert(itemsToInsert)

    if (itemsError) {
      console.error('Approval items insert error:', itemsError)
    }

    // 3) Insert assignees (creator, internal assignees, client user)
    const assigneeRows: any[] = []

    // Creator
    assigneeRows.push({
      approval_id: approvalId,
      user_id: creatorId,
      role: 'creator',
    })

    // Internal assignees
    for (const uid of assigneeIds) {
      if (!uid) continue
      assigneeRows.push({
        approval_id: approvalId,
        user_id: uid,
        role: 'assignee',
      })
    }

    // Client portal user(s) - role 'client'
    const { data: clientUsers } = await supaAdmin
      .from('users')
      .select('id')
      .eq('client_id', clientId)
      .eq('role', 'client')

    for (const cu of clientUsers || []) {
      assigneeRows.push({
        approval_id: approvalId,
        user_id: cu.id,
        role: 'client',
      })
    }

    if (assigneeRows.length > 0) {
      const { error: assigneesError } = await supaAdmin
        .from('approval_assignees')
        .insert(assigneeRows)

      if (assigneesError) {
        console.error('Approval assignees insert error:', assigneesError)
      }
    }

    // 4) In-app notifications
    try {
      const watcherIds = [
        creatorId,
        ...assigneeIds,
        ...(clientUsers || []).map((u: any) => u.id),
      ].filter(Boolean)

      const uniqueWatcherIds = Array.from(new Set(watcherIds))

      if (uniqueWatcherIds.length > 0) {
        await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/notifications/create`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userIds: uniqueWatcherIds,
            type: 'approval_created',
            data: {
              approvalId,
              title,
              clientName: clientDisplayName,
            },
          }),
        })
      }
    } catch (notifyErr) {
      console.error('Approval in-app notification error:', notifyErr)
    }

    // 5) Email notifications via Apps Script
try {
  const scriptUrl = process.env.APPS_SCRIPT_WEBHOOK_URL
  const secret = process.env.APPS_SCRIPT_SECRET

  if (scriptUrl && secret) {
    const { data: watcherUsers } = await supaAdmin
      .from('users')
      .select('id, email, role')
      .in('id', assigneeRows.map((r) => r.user_id))

    const clientEmails = (watcherUsers || [])
      .filter((u: any) => u.role === 'client')
      .map((u: any) => u.email)
      .filter((e: string | null) => !!e)

    const teamEmails = (watcherUsers || [])
      .filter((u: any) => u.role !== 'client')
      .map((u: any) => u.email)
      .filter((e: string | null) => !!e)

    const portalUrl = `${process.env.NEXT_PUBLIC_APP_URL}/portal/approvals/${approvalId}`
    const agencyUrl = `${process.env.NEXT_PUBLIC_APP_URL}/approvals/${approvalId}`

    if (clientEmails.length > 0) {
      await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/notify-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'approval_created',
          payload: {
            secret,
            to: clientEmails,
            clientName: clientDisplayName,
            approvalTitle: title,
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
          type: 'approval_created',
          payload: {
            secret,
            to: teamEmails,
            clientName: clientDisplayName,
            approvalTitle: title,
            approvalId,
            url: agencyUrl,
          },
        }),
      })
    }
  } else {
    console.warn('Apps Script not configured for approval emails')
  }
} catch (emailErr) {
  console.error('Approval email notification error:', emailErr)
}

    return NextResponse.json({
      success: true,
      approvalId,
    })
  } catch (err: any) {
    console.error('Create approval error:', err)
    return NextResponse.json(
      { success: false, error: err?.message || 'Server error' },
      { status: 500 }
    )
  }
}