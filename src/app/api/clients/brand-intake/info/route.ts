import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const token = searchParams.get('token')

  if (!token) {
    return NextResponse.json({ success: false, error: 'Missing token' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('clients')
    .select(
      'id, name, business_name, industry, target_audience, website_url, profile_picture_url, brand_doc_url, dos_and_donts, topics_library, key_stories, unique_mechanisms, social_proof, competitor_insights, brand_profile, brand_intake_submitted_at',
    )
    .eq('brand_intake_token', token)
    .maybeSingle()

  if (error || !data) {
    return NextResponse.json({ success: false, error: 'Invalid or expired link' }, { status: 404 })
  }

  return NextResponse.json({
    success: true,
    client: {
      id: data.id,
      name: data.name,
      business_name: data.business_name,
      industry: data.industry,
      target_audience: data.target_audience,
      website_url: data.website_url,
      profile_picture_url: data.profile_picture_url,
      brand_doc_url: data.brand_doc_url,
      dos_and_donts: data.dos_and_donts,
      topics_library: data.topics_library,
      key_stories: data.key_stories,
      unique_mechanisms: data.unique_mechanisms,
      social_proof: data.social_proof,
      competitor_insights: data.competitor_insights,
      brand_profile: data.brand_profile,
      already_submitted: !!data.brand_intake_submitted_at,
    },
  })
}
