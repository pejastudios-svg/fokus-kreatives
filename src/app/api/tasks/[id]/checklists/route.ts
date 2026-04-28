import { NextRequest, NextResponse } from 'next/server'
import { assertTaskAccess, taskAdmin } from '@/lib/tasksAuth'

export const dynamic = 'force-dynamic'

interface ChecklistItem {
  id: string
  checklist_id: string
  label: string
  done: boolean
  position: number
  done_at: string | null
  done_by: string | null
}

interface ChecklistRow {
  id: string
  task_id: string
  name: string
  position: number
  created_at: string
  items: ChecklistItem[]
}

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const access = await assertTaskAccess(id)
  if (!access.ok) return NextResponse.json({ success: false, error: access.error }, { status: access.status })

  const { data: lists, error } = await taskAdmin
    .from('task_checklists')
    .select('id, task_id, name, position, created_at')
    .eq('task_id', id)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) {
    console.error('list checklists error:', error)
    return NextResponse.json({ success: false, error: 'Failed to load checklists' }, { status: 500 })
  }

  const listIds = (lists || []).map((l) => l.id)
  const itemsMap = new Map<string, ChecklistItem[]>()
  if (listIds.length) {
    const { data: items } = await taskAdmin
      .from('task_checklist_items')
      .select('id, checklist_id, label, done, position, done_at, done_by')
      .in('checklist_id', listIds)
      .order('position', { ascending: true })
    for (const item of items || []) {
      const arr = itemsMap.get(item.checklist_id) || []
      arr.push(item as ChecklistItem)
      itemsMap.set(item.checklist_id, arr)
    }
  }

  const checklists: ChecklistRow[] = (lists || []).map((l) => ({
    ...(l as Omit<ChecklistRow, 'items'>),
    items: itemsMap.get(l.id) || [],
  }))

  return NextResponse.json({ success: true, checklists })
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const access = await assertTaskAccess(id)
  if (!access.ok) return NextResponse.json({ success: false, error: access.error }, { status: access.status })

  const body = (await req.json()) as { name?: string }
  const name = (body.name || 'Checklist').trim()

  const { data, error } = await taskAdmin
    .from('task_checklists')
    .insert({ task_id: id, name })
    .select('id, task_id, name, position, created_at')
    .single()

  if (error || !data) {
    console.error('create checklist error:', error)
    return NextResponse.json({ success: false, error: 'Failed to create checklist' }, { status: 500 })
  }

  return NextResponse.json({ success: true, checklist: { ...data, items: [] } })
}
