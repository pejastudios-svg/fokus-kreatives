import { NextRequest, NextResponse } from 'next/server'
import { authorizeTaskRequest, canAccessClient, taskAdmin } from '@/lib/tasksAuth'

export const dynamic = 'force-dynamic'

interface FolderRow {
  id: string
  client_id: string
  parent_folder_id: string | null
  name: string
  position: number
  created_at: string
  updated_at: string
}

export async function GET(req: NextRequest) {
  try {
    const auth = await authorizeTaskRequest()
    if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })

    const { searchParams } = new URL(req.url)
    const clientId = searchParams.get('clientId') || ''

    let query = taskAdmin
      .from('task_folders')
      .select('id, client_id, parent_folder_id, name, position, created_at, updated_at')
      .order('position', { ascending: true })
      .order('name', { ascending: true })

    if (clientId) {
      if (!canAccessClient(auth, clientId)) {
        return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
      }
      query = query.eq('client_id', clientId)
    } else if (!auth.isAdminOrManager) {
      const ids = Array.from(auth.clientIds)
      if (ids.length === 0) return NextResponse.json({ success: true, folders: [] })
      query = query.in('client_id', ids)
    }

    const { data, error } = await query
    if (error) {
      console.error('list folders error:', error)
      return NextResponse.json({ success: false, error: 'Failed to load folders' }, { status: 500 })
    }
    return NextResponse.json({ success: true, folders: (data || []) as FolderRow[] })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await authorizeTaskRequest()
    if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })

    const body = (await req.json()) as {
      clientId?: string
      parentFolderId?: string | null
      name?: string
    }
    const clientId = body.clientId?.trim()
    const parentFolderId = body.parentFolderId || null
    const name = (body.name || '').trim()

    if (!clientId) return NextResponse.json({ success: false, error: 'Missing clientId' }, { status: 400 })
    if (!name) return NextResponse.json({ success: false, error: 'Missing name' }, { status: 400 })
    if (!canAccessClient(auth, clientId)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }

    if (parentFolderId) {
      const { data: parent } = await taskAdmin
        .from('task_folders')
        .select('client_id')
        .eq('id', parentFolderId)
        .maybeSingle()
      if (!parent || parent.client_id !== clientId) {
        return NextResponse.json({ success: false, error: 'Parent folder mismatch' }, { status: 400 })
      }
    }

    const { data, error } = await taskAdmin
      .from('task_folders')
      .insert({
        client_id: clientId,
        parent_folder_id: parentFolderId,
        name,
        created_by: auth.user.id,
      })
      .select('id, client_id, parent_folder_id, name, position, created_at, updated_at')
      .single()

    if (error || !data) {
      console.error('create folder error:', error)
      return NextResponse.json({ success: false, error: 'Failed to create folder' }, { status: 500 })
    }

    return NextResponse.json({ success: true, folder: data as FolderRow })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
