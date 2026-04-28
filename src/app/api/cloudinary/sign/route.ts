import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import crypto from 'crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Sign a Cloudinary direct upload.
 *
 * The browser POSTs the file directly to Cloudinary - we never proxy the bytes
 * through our server. To do that securely Cloudinary needs a signature minted
 * with our API secret, which is what this route produces.
 *
 * The signature is computed over `folder` + `timestamp` + (optional context).
 * Anyone holding a fresh signature can upload to that folder until the
 * timestamp window expires (~1 hour by Cloudinary default).
 *
 * Auth: requires a logged-in user. We don't gate per-role here because this
 * is used by both agency staff (creating approvals) and clients (commenting
 * on approvals). Folder is scoped to the requested approval id so uploads
 * stay organised on the Cloudinary side.
 */

interface Body {
  folder?: string
  resourceType?: 'image' | 'video' | 'auto'
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
        { success: false, error: 'Cloudinary env vars not configured' },
        { status: 500 },
      )
    }

    const body = (await req.json().catch(() => ({}))) as Body
    const folder = (body.folder || 'approvals/misc').replace(/[^a-zA-Z0-9/_\-.]/g, '')
    const resourceType: 'image' | 'video' | 'auto' = body.resourceType === 'video'
      ? 'video'
      : body.resourceType === 'auto'
        ? 'auto'
        : 'image'

    const timestamp = Math.floor(Date.now() / 1000)

    // Cloudinary's signature is the SHA-1 of `<sorted-params>&<api_secret>`
    // where params are the values you'll send with the upload, alphabetised
    // and joined `key=value` with `&`. We only sign the params we actually
    // include in the upload (folder + timestamp).
    const paramsToSign: Record<string, string | number> = {
      folder,
      timestamp,
    }
    const signString = Object.keys(paramsToSign)
      .sort()
      .map((k) => `${k}=${paramsToSign[k]}`)
      .join('&')
    const signature = crypto
      .createHash('sha1')
      .update(signString + apiSecret)
      .digest('hex')

    return NextResponse.json({
      success: true,
      signature,
      timestamp,
      api_key: apiKey,
      cloud_name: cloudName,
      folder,
      resource_type: resourceType,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('cloudinary sign exception:', err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
