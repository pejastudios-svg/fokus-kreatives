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
      .from('task_messages')
      .select('id, body, created_at, user_id, users:user_id (id, name, email, profile_picture_url)')
      .eq('task_id', id)
      .order('created_at', { ascending: true })
      .limit(200)

    if (error) {
      console.error('list messages error:', error)
      return NextResponse.json({ success: false, error: 'Failed to load messages' }, { status: 500 })
    }

    return NextResponse.json({ success: true, messages: data || [] })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await authorizeTaskRequest()
    if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })

    const { id } = await context.params
    if (!id) return NextResponse.json({ success: false, error: 'Missing id' }, { status: 400 })

    const body = (await req.json()) as { body?: string }
    const text = (body.body || '').trim()
    if (!text) return NextResponse.json({ success: false, error: 'Empty message' }, { status: 400 })
    if (text.length > 4000) {
      return NextResponse.json({ success: false, error: 'Message too long' }, { status: 400 })
    }

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
      .from('task_messages')
      .insert({ task_id: id, user_id: auth.user.id, body: text })
      .select('id, body, created_at, user_id, users:user_id (id, name, email, profile_picture_url)')
      .single()

    if (error || !data) {
      console.error('post message error:', error)
      return NextResponse.json({ success: false, error: 'Failed to post message' }, { status: 500 })
    }

    return NextResponse.json({ success: true, message: data })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
