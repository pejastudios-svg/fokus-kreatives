import { NextRequest, NextResponse } from 'next/server'
import { authorizeTaskRequest, taskAdmin } from '@/lib/tasksAuth'

export const dynamic = 'force-dynamic'

interface TaskTemplateNode {
  name: string
  description: string | null
  status: string
  priority: string
  start_at: string | null
  due_at: string | null
  checklists: { name: string; items: { label: string }[] }[]
  custom_fields: {
    tempId: string
    name: string
    type: string
    role: string
    value: string | null
    parent_temp_id: string | null
  }[]
  subtasks: TaskTemplateNode[]
}

async function snapshotTask(taskId: string): Promise<TaskTemplateNode | null> {
  const { data: t } = await taskAdmin
    .from('tasks')
    .select('name, description, status, priority, start_at, due_at')
    .eq('id', taskId)
    .maybeSingle()
  if (!t) return null

  const [checksRes, fieldsRes, subsRes] = await Promise.all([
    taskAdmin
      .from('task_checklists')
      .select('id, name, position, items:task_checklist_items(label, position)')
      .eq('task_id', taskId)
      .order('position', { ascending: true }),
    taskAdmin
      .from('task_custom_fields')
      .select('id, name, type, role, value, parent_field_id, position')
      .eq('task_id', taskId)
      .order('position', { ascending: true }),
    taskAdmin
      .from('tasks')
      .select('id')
      .eq('parent_task_id', taskId)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true }),
  ])

  const checklists = ((checksRes.data || []) as Array<{
    name: string
    items: { label: string; position: number }[] | null
  }>).map((cl) => ({
    name: cl.name,
    items: (cl.items || []).map((it) => ({ label: it.label })),
  }))

  // Map old field IDs → temp IDs so we can preserve pairing.
  const fieldsRaw = (fieldsRes.data || []) as Array<{
    id: string
    name: string
    type: string
    role: string
    value: string | null
    parent_field_id: string | null
  }>
  const tempIdMap = new Map<string, string>()
  fieldsRaw.forEach((f, i) => tempIdMap.set(f.id, `field-${i}`))

  const custom_fields = fieldsRaw.map((f) => ({
    tempId: tempIdMap.get(f.id) || '',
    name: f.name,
    type: f.type,
    role: f.role,
    value: f.value,
    parent_temp_id: f.parent_field_id ? tempIdMap.get(f.parent_field_id) || null : null,
  }))

  const subtasks: TaskTemplateNode[] = []
  for (const s of subsRes.data || []) {
    const sub = await snapshotTask(s.id)
    if (sub) subtasks.push(sub)
  }

  return {
    name: t.name,
    description: t.description,
    status: t.status,
    priority: t.priority,
    start_at: t.start_at,
    due_at: t.due_at,
    checklists,
    custom_fields,
    subtasks,
  }
}

export async function GET() {
  const auth = await authorizeTaskRequest()
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })

  // RLS handles visibility (shared OR owned OR admin/manager).
  const { data, error } = await taskAdmin
    .from('task_templates')
    .select('id, name, description, owner_id, is_shared, created_at')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('list templates error:', error)
    return NextResponse.json({ success: false, error: 'Failed to load templates' }, { status: 500 })
  }
  return NextResponse.json({ success: true, templates: data || [] })
}

export async function POST(req: NextRequest) {
  const auth = await authorizeTaskRequest()
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })

  const body = (await req.json()) as {
    sourceTaskId?: string
    name?: string
    description?: string | null
    isShared?: boolean
  }

  const sourceTaskId = body.sourceTaskId?.trim()
  const name = (body.name || '').trim()
  if (!sourceTaskId) return NextResponse.json({ success: false, error: 'Missing sourceTaskId' }, { status: 400 })
  if (!name) return NextResponse.json({ success: false, error: 'Missing name' }, { status: 400 })

  // Make sure the actor can read the source task.
  const { data: src } = await taskAdmin
    .from('tasks')
    .select('client_id')
    .eq('id', sourceTaskId)
    .maybeSingle()
  if (!src) return NextResponse.json({ success: false, error: 'Source task not found' }, { status: 404 })
  if (!auth.isAdminOrManager && !auth.clientIds.has(src.client_id)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
  }

  const root = await snapshotTask(sourceTaskId)
  if (!root) {
    return NextResponse.json({ success: false, error: 'Failed to snapshot task' }, { status: 500 })
  }

  const { data, error } = await taskAdmin
    .from('task_templates')
    .insert({
      name,
      description: body.description ?? null,
      owner_id: auth.user.id,
      is_shared: body.isShared !== false, // default true
      payload: { root },
    })
    .select('id, name, description, owner_id, is_shared, created_at')
    .single()

  if (error || !data) {
    console.error('save template error:', error)
    return NextResponse.json({ success: false, error: 'Failed to save template' }, { status: 500 })
  }
  return NextResponse.json({ success: true, template: data })
}
