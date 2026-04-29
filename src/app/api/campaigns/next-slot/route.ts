import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { nextCampaignSlot, type PackageTier } from '@/lib/campaignTiers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Suggest the next (campaign_number, month_number) for a given client based
 * on their highest-numbered existing campaign. Drives the auto-fill on the
 * create form. The agency can override either number on the form before
 * submitting.
 */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const clientId = (url.searchParams.get('clientId') || '').trim()
    if (!clientId) {
      return NextResponse.json({ success: false, error: 'Missing clientId' }, { status: 400 })
    }

    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    const { data: client } = await sb
      .from('clients')
      .select('package_tier')
      .eq('id', clientId)
      .maybeSingle()

    // Find the latest (month, campaign) pair so the suggestion increments
    // from where the agency last left off. Order by month then campaign,
    // both desc, take the first.
    const { data: latest } = await sb
      .from('campaigns')
      .select('campaign_number, month_number')
      .eq('client_id', clientId)
      .order('month_number', { ascending: false })
      .order('campaign_number', { ascending: false })
      .limit(1)
      .maybeSingle()

    const slot = nextCampaignSlot({
      tier: (client?.package_tier as PackageTier | null) ?? null,
      lastCampaign: (latest?.campaign_number as number | null) ?? null,
      lastMonth: (latest?.month_number as number | null) ?? null,
    })

    return NextResponse.json({
      success: true,
      tier: client?.package_tier ?? null,
      ...slot,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('GET /api/campaigns/next-slot exception:', err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
