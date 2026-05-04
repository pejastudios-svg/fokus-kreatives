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

interface TaskRow {
  id: string
  client_id: string
  folder_id: string | null
  parent_task_id: string | null
  name: string
  description: string | null
  status: (typeof VALID_STATUSES)[number]
  priority: (typeof VALID_PRIORITIES)[number]
  start_at: string | null
  due_at: string | null
  position: number
  created_at: string
  updated_at: string
}

export async function GET(req: NextRequest) {
  try {
    const auth = await authorizeTaskRequest()
    if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })

    const { searchParams } = new URL(req.url)
    const clientId = searchParams.get('clientId') || ''
    const folderId = searchParams.get('folderId') // '' / 'root' / actual id
    const parentTaskId = searchParams.get('parentTaskId') // for fetching subtasks

    let query = taskAdmin
      .from('tasks')
      .select(
        'id, client_id, folder_id, parent_task_id, name, description, status, priority, start_at, due_at, position, created_at, updated_at',
      )
      .order('position', { ascending: true })
      .order('created_at', { ascending: false })

    if (clientId) {
      if (!canAccessClient(auth, clientId)) {
        return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
      }
      query = query.eq('client_id', clientId)
    } else if (!auth.isAdminOrManager) {
      const ids = Array.from(auth.clientIds)
      if (ids.length === 0) return NextResponse.json({ success: true, tasks: [] })
      query = query.in('client_id', ids)
    }

    if (parentTaskId) {
      query = query.eq('parent_task_id', parentTaskId)
    } else if (folderId === 'root') {
      query = query.is('folder_id', null).is('parent_task_id', null)
    } else if (folderId) {
      query = query.eq('folder_id', folderId).is('parent_task_id', null)
    } else {
      // No folder filter - only return top-level tasks (no subtasks) by default.
      query = query.is('parent_task_id', null)
    }

    const { data, error } = await query
    if (error) {
      console.error('list tasks error:', error)
      return NextResponse.json({ success: false, error: 'Failed to load tasks' }, { status: 500 })
    }

    // Pull assignees in one round-trip and attach to each task.
    const taskIds = (data || []).map((t: TaskRow) => t.id)
    const assigneesMap = new Map<string, string[]>()
    if (taskIds.length) {
      const { data: assignees } = await taskAdmin
        .from('task_assignees')
        .select('task_id, user_id')
        .in('task_id', taskIds)
      for (const a of assignees || []) {
        const arr = assigneesMap.get(a.task_id) || []
        arr.push(a.user_id)
        assigneesMap.set(a.task_id, arr)
      }
    }

    const tasks = (data || []).map((t: TaskRow) => ({
      ...t,
      assignee_ids: assigneesMap.get(t.id) || [],
    }))

    return NextResponse.json({ success: true, tasks })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await authorizeTaskRequest()
    if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })

    const body = (await req.json()) as {
      clientId?: string
      folderId?: string | null
      parentTaskId?: string | null
      name?: string
      description?: string | null
      status?: string
      priority?: string
      startAt?: string | null
      dueAt?: string | null
      assigneeIds?: string[]
    }

    const clientId = body.clientId?.trim()
    const name = (body.name || '').trim()
    if (!clientId) return NextResponse.json({ success: false, error: 'Missing clientId' }, { status: 400 })
    if (!name) return NextResponse.json({ success: false, error: 'Missing name' }, { status: 400 })
    if (!canAccessClient(auth, clientId)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }

    const status = body.status && (VALID_STATUSES as readonly string[]).includes(body.status)
      ? (body.status as (typeof VALID_STATUSES)[number])
      : 'new'
    const priority = body.priority && (VALID_PRIORITIES as readonly string[]).includes(body.priority)
      ? (body.priority as (typeof VALID_PRIORITIES)[number])
      : 'medium'

    if (body.folderId) {
      const { data: folder } = await taskAdmin
        .from('task_folders')
        .select('client_id')
        .eq('id', body.folderId)
        .maybeSingle()
      if (!folder || folder.client_id !== clientId) {
        return NextResponse.json({ success: false, error: 'Folder must belong to the same client' }, { status: 400 })
      }
    }
    if (body.parentTaskId) {
      const { data: parent } = await taskAdmin
        .from('tasks')
        .select('client_id')
        .eq('id', body.parentTaskId)
        .maybeSingle()
      if (!parent || parent.client_id !== clientId) {
        return NextResponse.json({ success: false, error: 'Parent task must belong to the same client' }, { status: 400 })
      }
    }

    const { data: created, error } = await taskAdmin
      .from('tasks')
      .insert({
        client_id: clientId,
        folder_id: body.folderId ?? null,
        parent_task_id: body.parentTaskId ?? null,
        name,
        description: body.description ?? null,
        status,
        priority,
        start_at: body.startAt ?? null,
        due_at: body.dueAt ?? null,
        created_by: auth.user.id,
      })
      .select('id, client_id, folder_id, parent_task_id, name, description, status, priority, start_at, due_at, position, created_at, updated_at')
      .single()

    if (error || !created) {
      console.error('create task error:', error)
      return NextResponse.json({ success: false, error: 'Failed to create task' }, { status: 500 })
    }

    // Initial status log entry - keeps the audit trail consistent with status flips.
    await taskAdmin.from('task_status_log').insert({
      task_id: created.id,
      from_status: null,
      to_status: created.status,
      changed_by: auth.user.id,
    })

    if (body.assigneeIds?.length) {
      const rows = Array.from(new Set(body.assigneeIds)).map((uid) => ({
        task_id: created.id,
        user_id: uid,
      }))
      const { error: assignErr } = await taskAdmin.from('task_assignees').insert(rows)
      if (assignErr) console.error('assign on create error:', assignErr)
    }

    return NextResponse.json({
      success: true,
      task: {
        ...created,
        assignee_ids: body.assigneeIds || [],
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
