import { NextRequest, NextResponse } from 'next/server'
import { authorizeTaskRequest, canAccessClient, taskAdmin } from '@/lib/tasksAuth'

export const dynamic = 'force-dynamic'

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await authorizeTaskRequest()
    if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })

    const { id } = await context.params
    if (!id) return NextResponse.json({ success: false, error: 'Missing id' }, { status: 400 })

    const body = (await req.json()) as {
      name?: string
      parentFolderId?: string | null
      position?: number
    }

    const { data: existing } = await taskAdmin
      .from('task_folders')
      .select('id, client_id')
      .eq('id', id)
      .maybeSingle()
    if (!existing) return NextResponse.json({ success: false, error: 'Folder not found' }, { status: 404 })
    if (!canAccessClient(auth, existing.client_id)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }

    const update: Record<string, unknown> = {}
    if (typeof body.name === 'string') update.name = body.name.trim()
    if (body.parentFolderId !== undefined) {
      // null clears the parent (move to root); otherwise validate the new parent
      // is in the same client and isn't this folder itself.
      if (body.parentFolderId === id) {
        return NextResponse.json({ success: false, error: 'Cannot nest a folder under itself' }, { status: 400 })
      }
      if (body.parentFolderId) {
        const { data: parent } = await taskAdmin
          .from('task_folders')
          .select('client_id')
          .eq('id', body.parentFolderId)
          .maybeSingle()
        if (!parent || parent.client_id !== existing.client_id) {
          return NextResponse.json({ success: false, error: 'Parent must belong to the same client' }, { status: 400 })
        }
      }
      update.parent_folder_id = body.parentFolderId
    }
    if (typeof body.position === 'number') update.position = body.position

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ success: true, folder: existing })
    }

    const { data, error } = await taskAdmin
      .from('task_folders')
      .update(update)
      .eq('id', id)
      .select('id, client_id, parent_folder_id, name, position, updated_at')
      .single()
    if (error || !data) {
      console.error('update folder error:', error)
      return NextResponse.json({ success: false, error: 'Failed to update folder' }, { status: 500 })
    }
    return NextResponse.json({ success: true, folder: data })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await authorizeTaskRequest()
    if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })

    const { id } = await context.params
    if (!id) return NextResponse.json({ success: false, error: 'Missing id' }, { status: 400 })

    const { data: existing } = await taskAdmin
      .from('task_folders')
      .select('id, client_id')
      .eq('id', id)
      .maybeSingle()
    if (!existing) return NextResponse.json({ success: false, error: 'Folder not found' }, { status: 404 })
    if (!canAccessClient(auth, existing.client_id)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }

    const { error } = await taskAdmin.from('task_folders').delete().eq('id', id)
    if (error) {
      console.error('delete folder error:', error)
      return NextResponse.json({ success: false, error: 'Failed to delete folder' }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
