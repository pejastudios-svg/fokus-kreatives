import { NextRequest, NextResponse } from 'next/server'
import { authorizeTaskRequest, canAccessClient, taskAdmin } from '@/lib/tasksAuth'

export const dynamic = 'force-dynamic'

const VALID_STATUSES = [
  'new',
  'in_progress',
  'waiting_for_footage',
  'discontinued',
  'ready_for_review',
  'ready_for_approval',
  'approved',
  'complete',
] as const

const VALID_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await authorizeTaskRequest()
    if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })

    const { id } = await context.params
    if (!id) return NextResponse.json({ success: false, error: 'Missing id' }, { status: 400 })

    const { data: task, error } = await taskAdmin
      .from('tasks')
      .select('id, client_id, folder_id, parent_task_id, name, description, status, priority, start_at, due_at, position, created_at, updated_at')
      .eq('id', id)
      .maybeSingle()

    if (error) {
      console.error('get task error:', error)
      return NextResponse.json({ success: false, error: 'Failed to load task' }, { status: 500 })
    }
    if (!task) return NextResponse.json({ success: false, error: 'Task not found' }, { status: 404 })
    if (!canAccessClient(auth, task.client_id)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }

    const { data: assignees } = await taskAdmin
      .from('task_assignees')
      .select('user_id')
      .eq('task_id', id)

    return NextResponse.json({
      success: true,
      task: {
        ...task,
        assignee_ids: (assignees || []).map((a: { user_id: string }) => a.user_id),
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await authorizeTaskRequest()
    if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })

    const { id } = await context.params
    if (!id) return NextResponse.json({ success: false, error: 'Missing id' }, { status: 400 })

    const body = (await req.json()) as {
      name?: string
      description?: string | null
      status?: string
      priority?: string
      startAt?: string | null
      dueAt?: string | null
      folderId?: string | null
      assigneeIds?: string[]
    }

    const { data: existing } = await taskAdmin
      .from('tasks')
      .select('id, client_id, folder_id, status')
      .eq('id', id)
      .maybeSingle()
    if (!existing) return NextResponse.json({ success: false, error: 'Task not found' }, { status: 404 })
    if (!canAccessClient(auth, existing.client_id)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }

    const update: Record<string, unknown> = {}
    if (typeof body.name === 'string') update.name = body.name.trim()
    if (body.description !== undefined) update.description = body.description
    if (body.status && (VALID_STATUSES as readonly string[]).includes(body.status)) {
      update.status = body.status
    }
    if (body.priority && (VALID_PRIORITIES as readonly string[]).includes(body.priority)) {
      update.priority = body.priority
    }
    if (body.startAt !== undefined) update.start_at = body.startAt
    if (body.dueAt !== undefined) update.due_at = body.dueAt

    if (body.folderId !== undefined) {
      if (body.folderId) {
        const { data: folder } = await taskAdmin
          .from('task_folders')
          .select('client_id')
          .eq('id', body.folderId)
          .maybeSingle()
        if (!folder || folder.client_id !== existing.client_id) {
          return NextResponse.json({ success: false, error: 'Folder must belong to the same client' }, { status: 400 })
        }
      }
      update.folder_id = body.folderId
    }

    const statusChanged =
      typeof update.status === 'string' && update.status !== existing.status

    if (Object.keys(update).length > 0) {
      const { error: updErr } = await taskAdmin.from('tasks').update(update).eq('id', id)
      if (updErr) {
        console.error('update task error:', updErr)
        return NextResponse.json({ success: false, error: 'Failed to update task' }, { status: 500 })
      }
    }

    if (statusChanged) {
      const newStatus = update.status as string
      await taskAdmin.from('task_status_log').insert({
        task_id: id,
        from_status: existing.status,
        to_status: newStatus,
        changed_by: auth.user.id,
      })

      // Notify all assignees (in-app + email). Skip the actor - they made the change.
      void notifyStatusChange({
        req,
        taskId: id,
        clientId: existing.client_id,
        actorId: auth.user.id,
        fromStatus: existing.status,
        toStatus: newStatus,
      })
    }

    if (body.assigneeIds) {
      const next = Array.from(new Set(body.assigneeIds))
      const { data: current } = await taskAdmin
        .from('task_assignees')
        .select('user_id')
        .eq('task_id', id)
      const currentIds = new Set((current || []).map((c: { user_id: string }) => c.user_id))
      const nextIds = new Set(next)

      const toRemove = [...currentIds].filter((u) => !nextIds.has(u))
      const toAdd = [...nextIds].filter((u) => !currentIds.has(u))

      if (toRemove.length) {
        const { error: rmErr } = await taskAdmin
          .from('task_assignees')
          .delete()
          .eq('task_id', id)
          .in('user_id', toRemove)
        if (rmErr) console.error('remove assignees error:', rmErr)
      }
      if (toAdd.length) {
        const rows = toAdd.map((uid) => ({ task_id: id, user_id: uid }))
        const { error: addErr } = await taskAdmin.from('task_assignees').insert(rows)
        if (addErr) console.error('add assignees error:', addErr)
      }
    }

    const { data: refreshed } = await taskAdmin
      .from('tasks')
      .select('id, client_id, folder_id, parent_task_id, name, description, status, priority, start_at, due_at, position, created_at, updated_at')
      .eq('id', id)
      .maybeSingle()
    const { data: assignees } = await taskAdmin
      .from('task_assignees')
      .select('user_id')
      .eq('task_id', id)

    return NextResponse.json({
      success: true,
      task: refreshed
        ? { ...refreshed, assignee_ids: (assignees || []).map((a: { user_id: string }) => a.user_id) }
        : null,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await authorizeTaskRequest()
    if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })

    const { id } = await context.params
    if (!id) return NextResponse.json({ success: false, error: 'Missing id' }, { status: 400 })

    const { data: existing } = await taskAdmin
      .from('tasks')
      .select('id, client_id')
      .eq('id', id)
      .maybeSingle()
    if (!existing) return NextResponse.json({ success: false, error: 'Task not found' }, { status: 404 })
    if (!canAccessClient(auth, existing.client_id)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }

    const { error } = await taskAdmin.from('tasks').delete().eq('id', id)
    if (error) {
      console.error('delete task error:', error)
      return NextResponse.json({ success: false, error: 'Failed to delete task' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}

const STATUS_LABEL: Record<string, string> = {
  new: 'New',
  in_progress: 'In progress',
  waiting_for_footage: 'Waiting for footage',
  discontinued: 'Discontinued',
  ready_for_review: 'Ready for review',
  ready_for_approval: 'Ready for approval',
  approved: 'Approved',
  complete: 'Complete',
}

/**
 * Fan out a status-change notification to all task assignees (excluding the
 * person who made the change). Posts both in-app rows and email pings via the
 * existing /api/notifications/create + /api/notify-email infrastructure.
 */
async function notifyStatusChange(input: {
  req: NextRequest
  taskId: string
  clientId: string
  actorId: string
  fromStatus: string
  toStatus: string
}) {
  try {
    const { req, taskId, clientId, actorId, fromStatus, toStatus } = input
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin

    const [taskRes, assigneesRes, clientRes] = await Promise.all([
      taskAdmin.from('tasks').select('name').eq('id', taskId).maybeSingle(),
      taskAdmin.from('task_assignees').select('user_id').eq('task_id', taskId),
      taskAdmin.from('clients').select('name, business_name').eq('id', clientId).maybeSingle(),
    ])

    const taskName = (taskRes.data?.name as string) || 'A task'
    const clientName =
      (clientRes.data?.business_name as string) || (clientRes.data?.name as string) || ''

    const assigneeIds = (assigneesRes.data || [])
      .map((a: { user_id: string }) => a.user_id)
      .filter((uid) => uid && uid !== actorId)

    if (assigneeIds.length === 0) return

    await fetch(`${appUrl}/api/notifications/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userIds: assigneeIds,
        type: 'task_status_changed',
        data: {
          taskId,
          title: taskName,
          status: STATUS_LABEL[toStatus] || toStatus,
          fromStatus: STATUS_LABEL[fromStatus] || fromStatus,
          clientName,
          url: `${appUrl}/tasks/${taskId}`,
        },
      }),
    }).catch((e) => console.error('task notify in-app error:', e))

    const secret = process.env.APPS_SCRIPT_SECRET
    if (!secret) return

    const { data: users } = await taskAdmin
      .from('users')
      .select('email')
      .in('id', assigneeIds)
    const emails = (users || [])
      .map((u: { email: string | null }) => u.email)
      .filter((e): e is string => Boolean(e))

    if (emails.length === 0) return

    await fetch(`${appUrl}/api/notify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'task_status_changed',
        payload: {
          secret,
          to: emails,
          taskName,
          clientName,
          fromStatus: STATUS_LABEL[fromStatus] || fromStatus,
          toStatus: STATUS_LABEL[toStatus] || toStatus,
          url: `${appUrl}/tasks/${taskId}`,
        },
      }),
    }).catch((e) => console.error('task notify email error:', e))
  } catch (err) {
    console.error('notifyStatusChange failed:', err)
  }
}
