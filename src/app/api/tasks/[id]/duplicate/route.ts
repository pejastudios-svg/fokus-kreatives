import { NextRequest, NextResponse } from 'next/server'
import { assertTaskAccess, taskAdmin } from '@/lib/tasksAuth'
import { cloneTaskTree } from '@/lib/taskCloning'

export const dynamic = 'force-dynamic'

export async function POST(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const access = await assertTaskAccess(id)
  if (!access.ok) return NextResponse.json({ success: false, error: access.error }, { status: access.status })

  // Pull placement details so the clone sits next to the original.
  const { data: source } = await taskAdmin
    .from('tasks')
    .select('folder_id, parent_task_id, name')
    .eq('id', id)
    .maybeSingle()

  const cloned = await cloneTaskTree(id, {
    targetClientId: access.task.client_id,
    targetFolderId: source?.folder_id ?? null,
    parentTaskId: source?.parent_task_id ?? null,
    nameOverride: source?.name ? `${source.name} (copy)` : undefined,
    actorId: access.auth.user.id,
  })
  if (!cloned) {
    return NextResponse.json({ success: false, error: 'Failed to duplicate task' }, { status: 500 })
  }
  return NextResponse.json({ success: true, taskId: cloned.newId })
}
