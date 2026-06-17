import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Hard-delete agreements that have sat in Recently Deleted for 30+ days.
 * Soft delete (deleted_at) hides them and kills the public link; this is the
 * final purge. Child rows (signers, etc.) cascade. Schedule daily via Apps
 * Script time trigger (runAgreementsPurge), auth via ?secret=<CRON_SECRET>.
 */
export async function GET(req: NextRequest) {
  const secret = new URL(req.url).searchParams.get('secret')
  const envSecret = process.env.CRON_SECRET
  if (envSecret && secret !== envSecret) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
  }

  const admin = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await admin
    .from('agreements')
    .delete()
    .not('deleted_at', 'is', null)
    .lt('deleted_at', cutoff)
    .select('id')

  if (error) {
    console.error('cron/purge-agreements error:', error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
  return NextResponse.json({ success: true, purged: (data || []).length })
}
