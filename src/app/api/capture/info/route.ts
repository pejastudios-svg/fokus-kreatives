import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const slug = searchParams.get('slug')

  if (!slug) {
    return NextResponse.json(
      { success: false, error: 'Missing slug' },
      { status: 400 }
    )
  }

  const { data, error } = await supabase
  .from('capture_pages')
  .select(
    'id, client_id, name, slug, headline, description, lead_magnet_url, is_active, logo_url, include_meeting, calendly_url'
  )
  .eq('slug', slug)
  .eq('is_active', true)
  .single()

  if (error || !data) {
    return NextResponse.json(
      { success: false, error: 'Capture page not found' },
      { status: 404 }
    )
  }

  return NextResponse.json({
    success: true,
    page: data,
  })
}