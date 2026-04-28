import { NextRequest, NextResponse } from 'next/server'
import { authorizeTaskRequest, canAccessClient, taskAdmin } from '@/lib/tasksAuth'
import { cloneTaskTree } from '@/lib/taskCloning'

export const dynamic = 'force-dynamic'

interface FolderRow {
  id: string
  client_id: string
  parent_folder_id: string | null
  name: string
}

/**
 * Recursively clone a folder + all of its descendants (nested folders + tasks
 * + task trees). The new top-level folder gets "(copy)" appended to its name.
 */
async function cloneFolderTree(
  sourceFolderId: string,
  targetParentFolderId: string | null,
  nameOverride: string | null,
  actorId: string,
): Promise<{ newId: string } | null> {
  const { data: source } = await taskAdmin
    .from('task_folders')
    .select('client_id, name')
    .eq('id', sourceFolderId)
    .maybeSingle()
  if (!source) return null

  const { data: created, error } = await taskAdmin
    .from('task_folders')
    .insert({
      client_id: source.client_id,
      parent_folder_id: targetParentFolderId,
      name: nameOverride ?? source.name,
      created_by: actorId,
    })
    .select('id')
    .single()
  if (error || !created) {
    console.error('clone folder error:', error)
    return null
  }

  // Clone direct child tasks (and their subtasks via cloneTaskTree).
  const { data: tasks } = await taskAdmin
    .from('tasks')
    .select('id')
    .eq('folder_id', sourceFolderId)
    .is('parent_task_id', null)

  for (const t of tasks || []) {
    await cloneTaskTree(t.id, {
      targetClientId: source.client_id,
      targetFolderId: created.id,
      parentTaskId: null,
      actorId,
    })
  }

  // Recurse into subfolders.
  const { data: subs } = await taskAdmin
    .from('task_folders')
    .select('id')
    .eq('parent_folder_id', sourceFolderId)

  for (const s of subs || []) {
    await cloneFolderTree(s.id, created.id, null, actorId)
  }

  return { newId: created.id }
}

export async function POST(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeTaskRequest()
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })

  const { id } = await context.params

  const { data: source } = await taskAdmin
    .from('task_folders')
    .select('id, client_id, parent_folder_id, name')
    .eq('id', id)
    .maybeSingle<FolderRow>()
  if (!source) return NextResponse.json({ success: false, error: 'Folder not found' }, { status: 404 })
  if (!canAccessClient(auth, source.client_id)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
  }

  const cloned = await cloneFolderTree(
    source.id,
    source.parent_folder_id,
    `${source.name} (copy)`,
    auth.user.id,
  )
  if (!cloned) {
    return NextResponse.json({ success: false, error: 'Failed to duplicate folder' }, { status: 500 })
  }
  return NextResponse.json({ success: true, folderId: cloned.newId })
}
