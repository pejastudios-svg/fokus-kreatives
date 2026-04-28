import { NextRequest, NextResponse } from 'next/server'
import { authorizeTaskRequest, canAccessClient, taskAdmin } from '@/lib/tasksAuth'

export const dynamic = 'force-dynamic'

const VALID_TYPES = ['text', 'url', 'file', 'folder'] as const
const VALID_ROLES = ['main_deliverable', 'captions', 'thumbnail', 'cover', 'generic'] as const

async function loadFieldContext(fieldId: string) {
  const { data } = await taskAdmin
    .from('task_custom_fields')
    .select('id, task_id, tasks:task_id (client_id)')
    .eq('id', fieldId)
    .maybeSingle()
  if (!data) return null
  const tField = (data as unknown as { tasks: unknown }).tasks
  const task = Array.isArray(tField) ? tField[0] : tField
  const clientId = (task as { client_id?: string } | null)?.client_id
  if (!clientId) return null
  return { fieldId: data.id as string, taskId: data.task_id as string, clientId }
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeTaskRequest()
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })

  const { id } = await context.params
  const ctx = await loadFieldContext(id)
  if (!ctx) return NextResponse.json({ success: false, error: 'Field not found' }, { status: 404 })
  if (!canAccessClient(auth, ctx.clientId)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
  }

  const body = (await req.json()) as {
    name?: string
    type?: string
    role?: string
    value?: string | null
    parentFieldId?: string | null
  }

  const update: Record<string, unknown> = {}
  if (typeof body.name === 'string') update.name = body.name.trim()
  if (body.type && (VALID_TYPES as readonly string[]).includes(body.type)) {
    update.type = body.type
  }
  if (body.role && (VALID_ROLES as readonly string[]).includes(body.role)) {
    update.role = body.role
  }
  if (body.value !== undefined) update.value = body.value
  if (body.parentFieldId !== undefined) {
    if (body.parentFieldId) {
      if (body.parentFieldId === id) {
        return NextResponse.json({ success: false, error: 'Cannot pair a field with itself' }, { status: 400 })
      }
      const { data: parent } = await taskAdmin
        .from('task_custom_fields')
        .select('task_id')
        .eq('id', body.parentFieldId)
        .maybeSingle()
      if (!parent || parent.task_id !== ctx.taskId) {
        return NextResponse.json({ success: false, error: 'Pair target must be on the same task' }, { status: 400 })
      }
    }
    update.parent_field_id = body.parentFieldId
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ success: true })
  }

  const { error } = await taskAdmin.from('task_custom_fields').update(update).eq('id', id)
  if (error) {
    console.error('update field error:', error)
    return NextResponse.json({ success: false, error: 'Failed to update field' }, { status: 500 })
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
  const ctx = await loadFieldContext(id)
  if (!ctx) return NextResponse.json({ success: false, error: 'Field not found' }, { status: 404 })
  if (!canAccessClient(auth, ctx.clientId)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
  }

  const { error } = await taskAdmin.from('task_custom_fields').delete().eq('id', id)
  if (error) {
    console.error('delete field error:', error)
    return NextResponse.json({ success: false, error: 'Failed to delete field' }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
