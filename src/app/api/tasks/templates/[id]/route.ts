import { NextRequest, NextResponse } from 'next/server'
import { authorizeTaskRequest, taskAdmin } from '@/lib/tasksAuth'

export const dynamic = 'force-dynamic'

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeTaskRequest()
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })

  const { id } = await context.params

  const { data: existing } = await taskAdmin
    .from('task_templates')
    .select('id, owner_id')
    .eq('id', id)
    .maybeSingle()
  if (!existing) return NextResponse.json({ success: false, error: 'Template not found' }, { status: 404 })

  if (!auth.isAdminOrManager && existing.owner_id !== auth.user.id) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
  }

  const { error } = await taskAdmin.from('task_templates').delete().eq('id', id)
  if (error) {
    console.error('delete template error:', error)
    return NextResponse.json({ success: false, error: 'Failed to delete template' }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
