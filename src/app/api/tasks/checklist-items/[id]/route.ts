import { NextRequest, NextResponse } from 'next/server'
import { authorizeTaskRequest, canAccessClient, taskAdmin } from '@/lib/tasksAuth'

export const dynamic = 'force-dynamic'

async function loadItemContext(itemId: string) {
  const { data } = await taskAdmin
    .from('task_checklist_items')
    .select('id, checklist_id, task_checklists:checklist_id (task_id, tasks:task_id (client_id))')
    .eq('id', itemId)
    .maybeSingle()
  if (!data) return null
  // The nested join shape varies by Supabase output — defensively unwrap.
  const cl = (data as unknown as { task_checklists: unknown }).task_checklists
  const checklist = Array.isArray(cl) ? cl[0] : cl
  const tField = (checklist as { tasks?: unknown } | null)?.tasks
  const task = Array.isArray(tField) ? tField[0] : tField
  const clientId = (task as { client_id?: string } | null)?.client_id
  if (!clientId) return null
  return { itemId: data.id as string, clientId }
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeTaskRequest()
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })

  const { id } = await context.params
  const ctx = await loadItemContext(id)
  if (!ctx) return NextResponse.json({ success: false, error: 'Item not found' }, { status: 404 })
  if (!canAccessClient(auth, ctx.clientId)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
  }

  const body = (await req.json()) as { label?: string; done?: boolean }
  const update: Record<string, unknown> = {}
  if (typeof body.label === 'string') update.label = body.label.trim()
  if (typeof body.done === 'boolean') {
    update.done = body.done
    update.done_at = body.done ? new Date().toISOString() : null
    update.done_by = body.done ? auth.user.id : null
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ success: true })
  }

  const { error } = await taskAdmin.from('task_checklist_items').update(update).eq('id', id)
  if (error) {
    console.error('update item error:', error)
    return NextResponse.json({ success: false, error: 'Failed to update item' }, { status: 500 })
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
  const ctx = await loadItemContext(id)
  if (!ctx) return NextResponse.json({ success: false, error: 'Item not found' }, { status: 404 })
  if (!canAccessClient(auth, ctx.clientId)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
  }

  const { error } = await taskAdmin.from('task_checklist_items').delete().eq('id', id)
  if (error) {
    console.error('delete item error:', error)
    return NextResponse.json({ success: false, error: 'Failed to delete item' }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
