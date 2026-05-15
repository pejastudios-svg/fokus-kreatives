// Brand DM keywords (brand_content_settings.dm_keywords). The table's RLS
// policy is service_role-only, so the StoryDmKeywords UI cannot read or
// write the column directly from the browser. This route mediates both
// operations: it authenticates the caller (admin/manager) and uses the
// service-role client for the underlying upsert.

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const admin = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const MAX_KEYWORDS = 3
const MAX_LEN = 24

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

    const { data, error } = await admin
      .from('brand_content_settings')
      .select('dm_keywords')
      .eq('client_id', clientId)
      .maybeSingle()

    if (error) {
      console.error('dm-keywords load error:', error)
      return NextResponse.json({ success: false, error: 'Failed to load keywords' }, { status: 500 })
    }

    const keywords = (data?.dm_keywords as string[] | null) ?? []
    return NextResponse.json({ success: true, keywords: keywords.filter((k) => typeof k === 'string') })
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
    const body = (await req.json()) as { keywords?: unknown }
    const raw = Array.isArray(body.keywords) ? body.keywords : []

    const keywords = Array.from(
      new Set(
        raw
          .map((k) => (typeof k === 'string' ? k.trim().toUpperCase().replace(/\s+/g, '_').slice(0, MAX_LEN) : ''))
          .filter(Boolean),
      ),
    ).slice(0, MAX_KEYWORDS)

    const { data, error } = await admin
      .from('brand_content_settings')
      .upsert(
        { client_id: clientId, dm_keywords: keywords },
        { onConflict: 'client_id' },
      )
      .select('dm_keywords')
      .single()

    if (error) {
      console.error('dm-keywords save error:', error)
      return NextResponse.json({ success: false, error: 'Failed to save keywords' }, { status: 500 })
    }

    const persisted = (data?.dm_keywords as string[] | null) ?? []
    return NextResponse.json({ success: true, keywords: persisted })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
