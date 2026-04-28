import { taskAdmin } from '@/lib/tasksAuth'

interface ClonedTask {
  newId: string
}

/**
 * Deep-clone a task and everything underneath it (subtasks, checklists,
 * checklist items, custom fields with paired-field IDs remapped to the new
 * field IDs). Returns the new top-level task id.
 */
export async function cloneTaskTree(
  sourceTaskId: string,
  opts: {
    targetClientId: string
    targetFolderId?: string | null
    parentTaskId?: string | null
    nameOverride?: string
    actorId: string
  },
): Promise<ClonedTask | null> {
  const { data: source } = await taskAdmin
    .from('tasks')
    .select('name, description, status, priority, start_at, due_at')
    .eq('id', sourceTaskId)
    .maybeSingle()
  if (!source) return null

  const { data: created, error } = await taskAdmin
    .from('tasks')
    .insert({
      client_id: opts.targetClientId,
      folder_id: opts.targetFolderId ?? null,
      parent_task_id: opts.parentTaskId ?? null,
      name: opts.nameOverride || source.name,
      description: source.description,
      status: source.status,
      priority: source.priority,
      start_at: source.start_at,
      due_at: source.due_at,
      created_by: opts.actorId,
    })
    .select('id, status')
    .single()

  if (error || !created) {
    console.error('clone insert task error:', error)
    return null
  }

  // Initial status log entry, mirroring how /api/tasks creates one.
  await taskAdmin.from('task_status_log').insert({
    task_id: created.id,
    from_status: null,
    to_status: created.status,
    changed_by: opts.actorId,
  })

  // Assignees.
  const { data: assignees } = await taskAdmin
    .from('task_assignees')
    .select('user_id')
    .eq('task_id', sourceTaskId)
  if (assignees && assignees.length > 0) {
    await taskAdmin.from('task_assignees').insert(
      assignees.map((a) => ({ task_id: created.id, user_id: a.user_id })),
    )
  }

  // Checklists + items.
  const { data: lists } = await taskAdmin
    .from('task_checklists')
    .select('id, name, position')
    .eq('task_id', sourceTaskId)
    .order('position', { ascending: true })

  for (const list of lists || []) {
    const { data: newList } = await taskAdmin
      .from('task_checklists')
      .insert({ task_id: created.id, name: list.name, position: list.position })
      .select('id')
      .single()
    if (!newList) continue
    const { data: items } = await taskAdmin
      .from('task_checklist_items')
      .select('label, position')
      .eq('checklist_id', list.id)
      .order('position', { ascending: true })
    if (items && items.length > 0) {
      await taskAdmin.from('task_checklist_items').insert(
        items.map((it) => ({
          checklist_id: newList.id,
          label: it.label,
          position: it.position,
        })),
      )
    }
  }

  // Custom fields. We need to remap parent_field_id from old IDs to new IDs.
  const { data: fields } = await taskAdmin
    .from('task_custom_fields')
    .select('id, name, type, role, value, parent_field_id, position')
    .eq('task_id', sourceTaskId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })

  if (fields && fields.length > 0) {
    // First pass: insert all fields without parent_field_id, capture old → new.
    const idMap = new Map<string, string>()
    for (const f of fields) {
      const { data: newField } = await taskAdmin
        .from('task_custom_fields')
        .insert({
          task_id: created.id,
          name: f.name,
          type: f.type,
          role: f.role,
          value: f.value,
          position: f.position,
        })
        .select('id')
        .single()
      if (newField) idMap.set(f.id, newField.id)
    }
    // Second pass: patch parent_field_id with the remapped IDs.
    for (const f of fields) {
      if (!f.parent_field_id) continue
      const newId = idMap.get(f.id)
      const newParent = idMap.get(f.parent_field_id)
      if (!newId || !newParent) continue
      await taskAdmin
        .from('task_custom_fields')
        .update({ parent_field_id: newParent })
        .eq('id', newId)
    }
  }

  // Recurse into subtasks.
  const { data: subs } = await taskAdmin
    .from('tasks')
    .select('id')
    .eq('parent_task_id', sourceTaskId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })

  for (const s of subs || []) {
    await cloneTaskTree(s.id, {
      targetClientId: opts.targetClientId,
      targetFolderId: opts.targetFolderId ?? null,
      parentTaskId: created.id,
      actorId: opts.actorId,
    })
  }

  return { newId: created.id }
}
