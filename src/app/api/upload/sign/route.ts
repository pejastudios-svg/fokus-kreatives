import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Issues a short-lived signed upload URL so the browser can upload large
// files (e.g. reels/videos) DIRECTLY to Supabase Storage, bypassing the
// serverless function body limit (~4.5MB on Vercel) that /api/upload hits.
// The actual bytes never pass through this function.

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function POST(req: NextRequest) {
  try {
    const { folder, name } = (await req.json().catch(() => ({}))) as {
      folder?: string
      name?: string
    }
    const safeFolder = (folder || 'general').replace(/[^\w./-]+/g, '').slice(0, 80)
    const safeName = String(name || 'file').replace(/[^\w.\-]+/g, '_').slice(0, 80)
    const path = `${safeFolder}/${Date.now()}-${safeName}`

    const { data, error } = await supabase.storage.from('uploads').createSignedUploadUrl(path)
    if (error || !data) {
      return NextResponse.json(
        { success: false, error: error?.message || 'Could not start upload' },
        { status: 500 },
      )
    }

    const { data: pub } = supabase.storage.from('uploads').getPublicUrl(data.path)
    return NextResponse.json({
      success: true,
      path: data.path,
      token: data.token,
      publicUrl: pub.publicUrl,
    })
  } catch (err) {
    console.error('[upload/sign] error', err)
    return NextResponse.json({ success: false, error: 'Could not start upload' }, { status: 500 })
  }
}
