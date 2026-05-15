// Brand description settings: social handles, bio, audience blurb. These
// are threaded into the long-form [DESCRIPTION] section of generated
// scripts. The brand_content_settings RLS policy is service-role-only,
// so writes go through this server-side route.
//
// Schema migration: sql/migrations/20260605_brand_socials.sql

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const admin = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const URL_MAX = 250
const BIO_MAX = 500
const AUDIENCE_MAX = 500

interface DescriptionSettings {
  instagram_handle: string | null
  tiktok_handle: string | null
  youtube_handle: string | null
  linkedin_handle: string | null
  x_handle: string | null
  brand_bio: string | null
  audience_blurb: string | null
  default_hashtags: string[] | null
}

const HASHTAG_MAX_LEN = 30
const HASHTAG_MAX_COUNT = 20

function normalizeHashtag(raw: string): string | null {
  const trimmed = raw.trim().replace(/^#+/, '').replace(/[^A-Za-z0-9_]/g, '')
  if (!trimmed) return null
  return `#${trimmed.slice(0, HASHTAG_MAX_LEN)}`
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

function normalizeSocialUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim().slice(0, URL_MAX)
  if (!trimmed) return null
  // Stored verbatim - the brand pastes the FULL URL of the profile they
  // want hyperlinked in the YouTube description (e.g.
  // "https://www.instagram.com/saint_000777/"). YouTube auto-linkifies
  // any line containing a recognized URL when the description is
  // pasted, so storing the URL verbatim makes the rendered description
  // clickable. We do NOT strip "@" or "https://" - the user's input is
  // the source of truth.
  return trimmed
}

function normalizeText(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim().slice(0, max)
  return trimmed || null
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
      .select('instagram_handle, tiktok_handle, youtube_handle, linkedin_handle, x_handle, brand_bio, audience_blurb, default_hashtags')
      .eq('client_id', clientId)
      .maybeSingle()

    if (error) {
      console.error('description-settings load error:', error)
      return NextResponse.json({ success: false, error: 'Failed to load settings' }, { status: 500 })
    }

    const settings: DescriptionSettings = {
      instagram_handle: (data?.instagram_handle as string | null) ?? null,
      tiktok_handle: (data?.tiktok_handle as string | null) ?? null,
      youtube_handle: (data?.youtube_handle as string | null) ?? null,
      linkedin_handle: (data?.linkedin_handle as string | null) ?? null,
      x_handle: (data?.x_handle as string | null) ?? null,
      brand_bio: (data?.brand_bio as string | null) ?? null,
      audience_blurb: (data?.audience_blurb as string | null) ?? null,
      default_hashtags: (data?.default_hashtags as string[] | null) ?? null,
    }

    return NextResponse.json({ success: true, settings })
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
    const body = (await req.json()) as Partial<DescriptionSettings>

    // Normalize hashtags: strip leading #, alphanum + underscore only, prefix
    // back to #, dedupe, cap at 20.
    const hashtagsRaw = Array.isArray(body.default_hashtags) ? body.default_hashtags : []
    const hashtags = Array.from(
      new Set(
        hashtagsRaw
          .map((h) => (typeof h === 'string' ? normalizeHashtag(h) : null))
          .filter((h): h is string => h !== null),
      ),
    ).slice(0, HASHTAG_MAX_COUNT)

    const payload = {
      client_id: clientId,
      instagram_handle: normalizeSocialUrl(body.instagram_handle),
      tiktok_handle: normalizeSocialUrl(body.tiktok_handle),
      youtube_handle: normalizeSocialUrl(body.youtube_handle),
      linkedin_handle: normalizeSocialUrl(body.linkedin_handle),
      x_handle: normalizeSocialUrl(body.x_handle),
      brand_bio: normalizeText(body.brand_bio, BIO_MAX),
      audience_blurb: normalizeText(body.audience_blurb, AUDIENCE_MAX),
      default_hashtags: hashtags.length > 0 ? hashtags : null,
    }

    const { data, error } = await admin
      .from('brand_content_settings')
      .upsert(payload, { onConflict: 'client_id' })
      .select('instagram_handle, tiktok_handle, youtube_handle, linkedin_handle, x_handle, brand_bio, audience_blurb, default_hashtags')
      .single()

    if (error) {
      console.error('description-settings save error:', error)
      return NextResponse.json({ success: false, error: 'Failed to save settings' }, { status: 500 })
    }

    return NextResponse.json({ success: true, settings: data })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
