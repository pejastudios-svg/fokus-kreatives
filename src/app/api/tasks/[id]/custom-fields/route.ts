import { NextRequest, NextResponse } from 'next/server'
import { assertTaskAccess, taskAdmin } from '@/lib/tasksAuth'

export const dynamic = 'force-dynamic'

const VALID_TYPES = ['text', 'url', 'file', 'folder'] as const
const VALID_ROLES = ['main_deliverable', 'captions', 'thumbnail', 'cover', 'generic'] as const

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const access = await assertTaskAccess(id)
  if (!access.ok) return NextResponse.json({ success: false, error: access.error }, { status: access.status })

  const { data, error } = await taskAdmin
    .from('task_custom_fields')
    .select('id, task_id, name, type, role, value, parent_field_id, position, created_at')
    .eq('task_id', id)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) {
    console.error('list custom fields error:', error)
    return NextResponse.json({ success: false, error: 'Failed to load fields' }, { status: 500 })
  }
  return NextResponse.json({ success: true, fields: data || [] })
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const access = await assertTaskAccess(id)
  if (!access.ok) return NextResponse.json({ success: false, error: access.error }, { status: access.status })

  const body = (await req.json()) as {
    name?: string
    type?: string
    role?: string
    value?: string | null
    parentFieldId?: string | null
  }

  const name = (body.name || '').trim()
  if (!name) return NextResponse.json({ success: false, error: 'Missing name' }, { status: 400 })

  const type = body.type && (VALID_TYPES as readonly string[]).includes(body.type)
    ? (body.type as (typeof VALID_TYPES)[number])
    : null
  if (!type) return NextResponse.json({ success: false, error: 'Invalid type' }, { status: 400 })

  const role = body.role && (VALID_ROLES as readonly string[]).includes(body.role)
    ? (body.role as (typeof VALID_ROLES)[number])
    : 'generic'

  // Pairing must reference a field on the same task.
  if (body.parentFieldId) {
    const { data: parent } = await taskAdmin
      .from('task_custom_fields')
      .select('task_id')
      .eq('id', body.parentFieldId)
      .maybeSingle()
    if (!parent || parent.task_id !== id) {
      return NextResponse.json({ success: false, error: 'Pair target must be on the same task' }, { status: 400 })
    }
  }

  const { data, error } = await taskAdmin
    .from('task_custom_fields')
    .insert({
      task_id: id,
      name,
      type,
      role,
      value: body.value ?? null,
      parent_field_id: body.parentFieldId ?? null,
    })
    .select('id, task_id, name, type, role, value, parent_field_id, position, created_at')
    .single()

  if (error || !data) {
    console.error('create custom field error:', error)
    return NextResponse.json({ success: false, error: 'Failed to create field' }, { status: 500 })
  }
  return NextResponse.json({ success: true, field: data })
}
