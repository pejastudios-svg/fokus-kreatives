import { NextRequest, NextResponse } from 'next/server'
import { authorizeTaskRequest, canAccessClient, taskAdmin } from '@/lib/tasksAuth'

export const dynamic = 'force-dynamic'

interface TemplateNode {
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
  subtasks: TemplateNode[]
}

/**
 * Materialize a template node into a real task tree under the given client +
 * folder + parent. Returns the new top-level task id (or null on failure).
 */
async function instantiateNode(
  node: TemplateNode,
  ctx: { clientId: string; folderId: string | null; parentTaskId: string | null; actorId: string },
): Promise<string | null> {
  const { data: created, error } = await taskAdmin
    .from('tasks')
    .insert({
      client_id: ctx.clientId,
      folder_id: ctx.folderId,
      parent_task_id: ctx.parentTaskId,
      name: node.name,
      description: node.description,
      status: node.status,
      priority: node.priority,
      start_at: node.start_at,
      due_at: node.due_at,
      created_by: ctx.actorId,
    })
    .select('id, status')
    .single()
  if (error || !created) {
    console.error('apply template insert error:', error)
    return null
  }

  await taskAdmin.from('task_status_log').insert({
    task_id: created.id,
    from_status: null,
    to_status: created.status,
    changed_by: ctx.actorId,
  })

  // Checklists.
  for (const cl of node.checklists || []) {
    const { data: list } = await taskAdmin
      .from('task_checklists')
      .insert({ task_id: created.id, name: cl.name })
      .select('id')
      .single()
    if (!list) continue
    if (cl.items?.length) {
      await taskAdmin.from('task_checklist_items').insert(
        cl.items.map((it) => ({ checklist_id: list.id, label: it.label })),
      )
    }
  }

  // Custom fields with tempId → real ID remapping for parent_field_id.
  if (node.custom_fields?.length) {
    const idMap = new Map<string, string>()
    for (const f of node.custom_fields) {
      const { data: newField } = await taskAdmin
        .from('task_custom_fields')
        .insert({
          task_id: created.id,
          name: f.name,
          type: f.type,
          role: f.role,
          value: f.value,
        })
        .select('id')
        .single()
      if (newField) idMap.set(f.tempId, newField.id)
    }
    for (const f of node.custom_fields) {
      if (!f.parent_temp_id) continue
      const newId = idMap.get(f.tempId)
      const newParent = idMap.get(f.parent_temp_id)
      if (!newId || !newParent) continue
      await taskAdmin
        .from('task_custom_fields')
        .update({ parent_field_id: newParent })
        .eq('id', newId)
    }
  }

  // Subtasks (recursive).
  for (const sub of node.subtasks || []) {
    await instantiateNode(sub, {
      clientId: ctx.clientId,
      folderId: ctx.folderId,
      parentTaskId: created.id,
      actorId: ctx.actorId,
    })
  }

  return created.id
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeTaskRequest()
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })

  const { id } = await context.params
  const body = (await req.json()) as { clientId?: string; folderId?: string | null }
  const clientId = body.clientId?.trim()
  const folderId = body.folderId ?? null

  if (!clientId) return NextResponse.json({ success: false, error: 'Missing clientId' }, { status: 400 })
  if (!canAccessClient(auth, clientId)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
  }

  if (folderId) {
    const { data: folder } = await taskAdmin
      .from('task_folders')
      .select('client_id')
      .eq('id', folderId)
      .maybeSingle()
    if (!folder || folder.client_id !== clientId) {
      return NextResponse.json({ success: false, error: 'Folder must belong to the same client' }, { status: 400 })
    }
  }

  const { data: template } = await taskAdmin
    .from('task_templates')
    .select('id, payload, is_shared, owner_id')
    .eq('id', id)
    .maybeSingle()
  if (!template) return NextResponse.json({ success: false, error: 'Template not found' }, { status: 404 })

  if (!template.is_shared && template.owner_id !== auth.user.id && !auth.isAdminOrManager) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
  }

  const root = (template.payload as { root?: TemplateNode } | null)?.root
  if (!root) {
    return NextResponse.json({ success: false, error: 'Template payload is empty' }, { status: 400 })
  }

  const newId = await instantiateNode(root, {
    clientId,
    folderId,
    parentTaskId: null,
    actorId: auth.user.id,
  })
  if (!newId) {
    return NextResponse.json({ success: false, error: 'Failed to apply template' }, { status: 500 })
  }
  return NextResponse.json({ success: true, taskId: newId })
}
