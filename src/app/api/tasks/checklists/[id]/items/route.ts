import { NextRequest, NextResponse } from 'next/server'
import { authorizeTaskRequest, canAccessClient, taskAdmin } from '@/lib/tasksAuth'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeTaskRequest()
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })

  const { id } = await context.params

  // Resolve the parent task's client to gate access.
  const { data: ctx } = await taskAdmin
    .from('task_checklists')
    .select('id, tasks:task_id (client_id)')
    .eq('id', id)
    .maybeSingle()
  if (!ctx) return NextResponse.json({ success: false, error: 'Checklist not found' }, { status: 404 })
  const tasksField = (ctx as unknown as { tasks: unknown }).tasks
  const task = Array.isArray(tasksField) ? tasksField[0] : tasksField
  const clientId = (task as { client_id?: string } | null)?.client_id
  if (!clientId) return NextResponse.json({ success: false, error: 'Checklist not found' }, { status: 404 })
  if (!canAccessClient(auth, clientId)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
  }

  const body = (await req.json()) as { label?: string }
  const label = (body.label || '').trim()
  if (!label) return NextResponse.json({ success: false, error: 'Missing label' }, { status: 400 })

  const { data, error } = await taskAdmin
    .from('task_checklist_items')
    .insert({ checklist_id: id, label })
    .select('id, checklist_id, label, done, position, done_at, done_by')
    .single()

  if (error || !data) {
    console.error('create item error:', error)
    return NextResponse.json({ success: false, error: 'Failed to add item' }, { status: 500 })
  }
  return NextResponse.json({ success: true, item: data })
}
