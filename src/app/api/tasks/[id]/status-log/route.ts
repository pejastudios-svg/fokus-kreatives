import { NextRequest, NextResponse } from 'next/server'
import { authorizeTaskRequest, canAccessClient, taskAdmin } from '@/lib/tasksAuth'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await authorizeTaskRequest()
    if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })

    const { id } = await context.params
    if (!id) return NextResponse.json({ success: false, error: 'Missing id' }, { status: 400 })

    const { data: task } = await taskAdmin
      .from('tasks')
      .select('client_id')
      .eq('id', id)
      .maybeSingle()
    if (!task) return NextResponse.json({ success: false, error: 'Task not found' }, { status: 404 })
    if (!canAccessClient(auth, task.client_id)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }

    const { data, error } = await taskAdmin
      .from('task_status_log')
      .select('id, from_status, to_status, changed_by, changed_at, users:changed_by (id, name, email)')
      .eq('task_id', id)
      .order('changed_at', { ascending: false })

    if (error) {
      console.error('status log fetch error:', error)
      return NextResponse.json({ success: false, error: 'Failed to load history' }, { status: 500 })
    }

    return NextResponse.json({ success: true, log: data || [] })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
