// src/app/api/approvals/create/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { fetchClickUpTaskName, updateClickUpStatus } from '@/app/api/clickup/helpers'

interface AssigneeInsert {
  approval_id: string
  user_id: string
  role: 'creator' | 'assignee' | 'client'
}

interface UserRow {
  id: string
  email: string | null
  role: string
}

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

type CreateApprovalBody = {
  creatorId: string
  clientId: string
  title: string
  description?: string | null
  clickupTaskId?: string | null
  autoApproveMinutes?: number | null
  assigneeIds?: string[]
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
      creatorId,
      clientId,
      title,
      description,
      clickupTaskId,
      autoApproveMinutes,
      assigneeIds = [],
      items,
    } = body

    if (!creatorId || !clientId || !title || !items || items.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Missing creatorId, clientId, title, or items' },
        { status: 400 }
      )
    }

    // Client info
    const { data: clientRow, error: clientError } = await supabase
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

    // ClickUp name + set task to WAITING
    let clickupTaskName: string | null = null
    if (clickupTaskId) {
      clickupTaskName = await fetchClickUpTaskName(clickupTaskId)
      await updateClickUpStatus(clickupTaskId, 'waiting')
    }

    // Auto approve timestamp
    let autoApproveAt: string | null = null
    if (autoApproveMinutes && autoApproveMinutes > 0) {
      const now = new Date()
      now.setMinutes(now.getMinutes() + autoApproveMinutes)
      autoApproveAt = now.toISOString()
    }

    // 1) Insert approval
    const { data: approvalRow, error: approvalError } = await supabase
      .from('approvals')
      .insert({
        client_id: clientId,
        created_by: creatorId,
        title,
        description: description || null,
        clickup_task_id: clickupTaskId || null,
        clickup_task_name: clickupTaskName || null,
        status: 'pending',
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

    const { error: itemsError } = await supabase
      .from('approval_items')
      .insert(itemsToInsert)

    if (itemsError) console.error('Approval items insert error:', itemsError)

    // 3) Assignees
    const assigneeRows: AssigneeInsert[] = []

    // creator
    assigneeRows.push({ approval_id: approvalId, user_id: creatorId, role: 'creator' })

    // internal assignees
    for (const uid of assigneeIds) {
      if (!uid) continue
      assigneeRows.push({ approval_id: approvalId, user_id: uid, role: 'assignee' })
    }

    // client portal users
    const { data: clientUsers } = await supabase
      .from('users')
      .select('id')
      .eq('client_id', clientId)
      .eq('role', 'client')

    for (const cu of clientUsers || []) {
      assigneeRows.push({ approval_id: approvalId, user_id: cu.id, role: 'client' })
    }

    if (assigneeRows.length > 0) {
      const { error: assigneesError } = await supabase
        .from('approval_assignees')
        .insert(assigneeRows)

      if (assigneesError) console.error('Approval assignees insert error:', assigneesError)
    }

    // 4) In-app notifications
    try {
      const watcherIds = [
        creatorId,
        ...assigneeIds,
        ...(clientUsers || []).map((u: { id: string }) => u.id),
      ].filter(Boolean)

      const uniqueWatcherIds = Array.from(new Set(watcherIds))

      if (uniqueWatcherIds.length > 0) {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin

        await fetch(`${appUrl}/api/notifications/create`, {
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
      console.error('Approval created in-app notification error:', notifyErr)
    }

    // 5) Email notifications via Apps Script (/api/notify-email)
    try {
      const secret = process.env.APPS_SCRIPT_SECRET
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin

      if (secret) {
        const watcherIds = assigneeRows.map((r) => r.user_id)
        const { data: watcherUsers } = await supabase
          .from('users')
          .select('id, email, role')
          .in('id', watcherIds)

        const clientEmails = (watcherUsers || [])
          .filter((u: UserRow) => u.role === 'client')
          .map((u: UserRow) => u.email)
          .filter(Boolean)

        const teamEmails = (watcherUsers || [])
          .filter((u: UserRow) => u.role !== 'client')
          .map((u: UserRow) => u.email)
          .filter(Boolean)

        const portalUrl = `${appUrl}/portal/approvals/${approvalId}`
        const agencyUrl = `${appUrl}/approvals/${approvalId}`

        if (clientEmails.length > 0) {
          await fetch(`${appUrl}/api/notify-email`, {
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
          await fetch(`${appUrl}/api/notify-email`, {
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
      }
    } catch (emailErr) {
      console.error('Approval created email notification error:', emailErr)
    }

    return NextResponse.json({ success: true, approvalId })
  } catch (err: unknown) {
    console.error('Create approval error:', err)
    const errorMessage = err instanceof Error ? err.message : 'Server error'
    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    )
  }
}