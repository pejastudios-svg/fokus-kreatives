// Brand story campaign (brand_content_settings.story_campaign). The active
// launch offer that launch-intent stories pull from. Like dm-keywords, the
// table's RLS is service-role-only, so this route mediates read/write with
// admin/manager auth + the service-role client.

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const admin = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const MAX_OFFER_LEN = 120
const MAX_KEYWORD_LEN = 24

interface StoryCampaign {
  offer: string
  event_date: string | null
  keyword: string | null
  mechanic: 'reply' | 'dm'
  active: boolean
}

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

function normalizeCampaign(raw: unknown): StoryCampaign | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const offer = typeof r.offer === 'string' ? r.offer.trim().slice(0, MAX_OFFER_LEN) : ''
  if (!offer) return null
  const eventDate =
    typeof r.event_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.event_date.trim())
      ? r.event_date.trim()
      : null
  const keyword =
    typeof r.keyword === 'string' && r.keyword.trim()
      ? r.keyword.trim().toUpperCase().replace(/\s+/g, '_').slice(0, MAX_KEYWORD_LEN)
      : null
  const mechanic: 'reply' | 'dm' = r.mechanic === 'dm' ? 'dm' : 'reply'
  const active = r.active !== false
  return { offer, event_date: eventDate, keyword, mechanic, active }
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
      .select('story_campaign')
      .eq('client_id', clientId)
      .maybeSingle()

    if (error) {
      console.error('story-campaign load error:', error)
      return NextResponse.json({ success: false, error: 'Failed to load campaign' }, { status: 500 })
    }

    return NextResponse.json({ success: true, campaign: data?.story_campaign ?? null })
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
    const body = (await req.json()) as { campaign?: unknown }
    // A null/blank campaign clears the field (no active offer).
    const campaign = normalizeCampaign(body.campaign)

    const { data, error } = await admin
      .from('brand_content_settings')
      .upsert({ client_id: clientId, story_campaign: campaign }, { onConflict: 'client_id' })
      .select('story_campaign')
      .single()

    if (error) {
      console.error('story-campaign save error:', error)
      return NextResponse.json({ success: false, error: 'Failed to save campaign' }, { status: 500 })
    }

    return NextResponse.json({ success: true, campaign: data?.story_campaign ?? null })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
