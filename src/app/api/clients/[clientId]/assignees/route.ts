import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const admin = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function authorize() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated', status: 401 as const }

  const { data: me } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (me?.role !== 'admin' && me?.role !== 'manager') {
    return { error: 'Admins or managers only', status: 403 as const }
  }
  return { user, me }
}

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ clientId: string }> },
) {
  try {
    const auth = await authorize()
    if ('error' in auth) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
    }

    const { clientId } = await context.params

    const { data: rows, error } = await admin
      .from('client_assignees')
      .select('user_id, users:user_id (id, name, email, role, profile_picture_url)')
      .eq('client_id', clientId)

    if (error) {
      console.error('list assignees error:', error)
      return NextResponse.json({ success: false, error: 'Failed to load assignees' }, { status: 500 })
    }

    const assignees = (rows || [])
      .map((r: { users: unknown }) => r.users)
      .filter(Boolean)

    return NextResponse.json({ success: true, assignees })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}

export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ clientId: string }> },
) {
  try {
    const auth = await authorize()
    if ('error' in auth) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
    }

    const { clientId } = await context.params
    const body = (await req.json()) as { userIds?: string[] }
    const userIds = Array.from(
      new Set(
        (body.userIds || [])
          .map((id) => (typeof id === 'string' ? id.trim() : ''))
          .filter(Boolean),
      ),
    )

    if (userIds.length > 0) {
      const { data: validUsers } = await admin
        .from('users')
        .select('id')
        .in('id', userIds)
        .in('role', ['admin', 'manager', 'employee'])
        .is('client_id', null)

      const validIds = new Set((validUsers || []).map((u: { id: string }) => u.id))
      for (const id of userIds) {
        if (!validIds.has(id)) {
          return NextResponse.json(
            { success: false, error: 'One or more userIds are not agency team members' },
            { status: 400 },
          )
        }
      }
    }

    const { error: delErr } = await admin
      .from('client_assignees')
      .delete()
      .eq('client_id', clientId)

    if (delErr) {
      console.error('clear assignees error:', delErr)
      return NextResponse.json({ success: false, error: 'Failed to update assignees' }, { status: 500 })
    }

    if (userIds.length > 0) {
      const rows = userIds.map((user_id) => ({ client_id: clientId, user_id }))
      const { error: insErr } = await admin.from('client_assignees').insert(rows)
      if (insErr) {
        console.error('insert assignees error:', insErr)
        return NextResponse.json({ success: false, error: 'Failed to save assignees' }, { status: 500 })
      }
    }

    return NextResponse.json({ success: true, count: userIds.length })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
