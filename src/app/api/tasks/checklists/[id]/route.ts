import { NextRequest, NextResponse } from 'next/server'
import { authorizeTaskRequest, canAccessClient, taskAdmin } from '@/lib/tasksAuth'

export const dynamic = 'force-dynamic'

async function loadChecklistContext(checklistId: string) {
  const { data } = await taskAdmin
    .from('task_checklists')
    .select('id, task_id, tasks:task_id (client_id)')
    .eq('id', checklistId)
    .maybeSingle()
  if (!data) return null
  const tasksField = (data as unknown as { tasks: unknown }).tasks
  const task = Array.isArray(tasksField) ? tasksField[0] : tasksField
  const clientId = (task as { client_id?: string } | null)?.client_id
  if (!clientId) return null
  return { checklistId: data.id as string, taskId: data.task_id as string, clientId }
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeTaskRequest()
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })

  const { id } = await context.params
  const ctx = await loadChecklistContext(id)
  if (!ctx) return NextResponse.json({ success: false, error: 'Checklist not found' }, { status: 404 })
  if (!canAccessClient(auth, ctx.clientId)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
  }

  const body = (await req.json()) as { name?: string }
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return NextResponse.json({ success: false, error: 'Missing name' }, { status: 400 })

  const { error } = await taskAdmin.from('task_checklists').update({ name }).eq('id', id)
  if (error) {
    console.error('rename checklist error:', error)
    return NextResponse.json({ success: false, error: 'Failed to rename checklist' }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeTaskRequest()
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })

  const { id } = await context.params
  const ctx = await loadChecklistContext(id)
  if (!ctx) return NextResponse.json({ success: false, error: 'Checklist not found' }, { status: 404 })
  if (!canAccessClient(auth, ctx.clientId)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
  }

  const { error } = await taskAdmin.from('task_checklists').delete().eq('id', id)
  if (error) {
    console.error('delete checklist error:', error)
    return NextResponse.json({ success: false, error: 'Failed to delete checklist' }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
