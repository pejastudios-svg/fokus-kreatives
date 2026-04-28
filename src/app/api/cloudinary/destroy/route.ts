import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import crypto from 'crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Delete one or more Cloudinary assets.
 *
 * Used to clean up orphans created by the approval-edit flow: when an
 * operator deletes/replaces an attachment that was already saved, or
 * cancels an edit after uploading new files, those assets would otherwise
 * sit in the Cloudinary library forever. The browser sends `{ assets:
 * [{ publicId, resourceType }] }` (or a single `{ publicId, resourceType }`)
 * and we sign + fan out destroy calls per asset.
 *
 * Auth: requires a logged-in user. Failures are reported per-asset so the
 * caller can retry just the ones that didn't work.
 */

interface AssetRef {
  publicId: string
  resourceType: 'image' | 'video'
}

interface Body {
  publicId?: string
  resourceType?: 'image' | 'video'
  assets?: AssetRef[]
}

async function destroyOne(
  cloudName: string,
  apiKey: string,
  apiSecret: string,
  publicId: string,
  resourceType: 'image' | 'video',
): Promise<{ publicId: string; ok: boolean; result: string }> {
  const timestamp = Math.floor(Date.now() / 1000)
  // Cloudinary's destroy signature is sha1(`public_id=<id>&timestamp=<ts>` + secret).
  // Field order is alphabetical (`public_id` before `timestamp`); since it's only
  // two params here that's the same as the alphabetical-and-`&`-joined string.
  const signString = `public_id=${publicId}&timestamp=${timestamp}${apiSecret}`
  const signature = crypto.createHash('sha1').update(signString).digest('hex')

  const form = new URLSearchParams()
  form.append('public_id', publicId)
  form.append('api_key', apiKey)
  form.append('timestamp', String(timestamp))
  form.append('signature', signature)

  const url = `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/destroy`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  })

  let data: { result?: string } = {}
  try {
    data = await res.json()
  } catch {
    // Cloudinary normally returns JSON; if it didn't we'll surface "unknown".
  }
  return { publicId, ok: data?.result === 'ok', result: data?.result || 'unknown' }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
    }

    const apiKey = process.env.CLOUDINARY_API_KEY
    const apiSecret = process.env.CLOUDINARY_API_SECRET
    const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME
    if (!apiKey || !apiSecret || !cloudName) {
      return NextResponse.json(
        { success: false, error: 'Cloudinary not configured' },
        { status: 500 },
      )
    }

    const body = (await req.json().catch(() => ({}))) as Body
    const list: AssetRef[] = Array.isArray(body.assets) && body.assets.length
      ? body.assets
      : body.publicId
        ? [{ publicId: body.publicId, resourceType: body.resourceType || 'image' }]
        : []

    if (!list.length) {
      return NextResponse.json(
        { success: false, error: 'No assets to destroy' },
        { status: 400 },
      )
    }

    const safeList = list
      .filter((a) => typeof a?.publicId === 'string' && a.publicId.length > 0)
      .map((a) => ({
        publicId: a.publicId,
        resourceType: a.resourceType === 'video' ? 'video' : 'image',
      })) as AssetRef[]

    const results = await Promise.all(
      safeList.map((a) =>
        destroyOne(cloudName, apiKey, apiSecret, a.publicId, a.resourceType),
      ),
    )

    return NextResponse.json({ success: true, results })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('cloudinary destroy exception:', err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
