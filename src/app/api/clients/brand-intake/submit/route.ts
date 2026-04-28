import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { normalizeBrandProfile, type BrandProfile } from '@/components/clients/brandProfile'
import { getAgencyRecipientsForClient } from '@/lib/clientRecipients'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const AGENCY_NOTIFY_EMAIL = 'fokuskreatives@gmail.com'

interface IntakeFormPayload {
  name?: string
  business_name?: string
  industry?: string
  target_audience?: string
  website_url?: string
  profile_picture_url?: string
  brand_doc_url?: string
  dos_and_donts?: string
  topics_library?: string
  key_stories?: string
  unique_mechanisms?: string
  social_proof?: string
  competitor_insights?: string
  brand_profile?: Partial<BrandProfile> | null
}

interface SubmitBody {
  token?: string
  form?: IntakeFormPayload
  profile?: Partial<BrandProfile> | null
}

const cleanString = (v: unknown): string | null => {
  if (typeof v !== 'string') return null
  const trimmed = v.trim()
  return trimmed.length ? trimmed : null
}

async function notifyAgency(
  req: NextRequest,
  clientId: string,
  clientName: string,
  businessName: string | null,
) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin
  const clientUrl = `${appUrl}/clients/${clientId}`

  const recipients = await getAgencyRecipientsForClient(supabase, clientId)
  const userIds = recipients.map((r) => r.id).filter(Boolean)
  const emails = recipients.map((r) => r.email).filter((e): e is string => Boolean(e))

  // 1) In-app notifications to assigned team members (or admins/managers as fallback)
  try {
    if (userIds.length) {
      await fetch(`${appUrl}/api/notifications/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userIds,
          type: 'brand_intake_submitted',
          data: {
            clientId,
            clientName: businessName || clientName,
            url: clientUrl,
          },
        }),
      })
    }
  } catch (err) {
    console.error('brand intake in-app notification error:', err)
  }

  // 2) Email via Apps Script
  try {
    const secret = process.env.APPS_SCRIPT_SECRET
    if (secret) {
      const to = emails.length ? Array.from(new Set([...emails, AGENCY_NOTIFY_EMAIL])) : [AGENCY_NOTIFY_EMAIL]
      await fetch(`${appUrl}/api/notify-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'brand_intake_submitted',
          payload: {
            secret,
            to,
            clientName: clientName || 'A client',
            businessName: businessName || '',
            url: clientUrl,
          },
        }),
      })
    }
  } catch (err) {
    console.error('brand intake email notification error:', err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as SubmitBody
    const token = body.token?.trim()

    if (!token) {
      return NextResponse.json({ success: false, error: 'Missing token' }, { status: 400 })
    }

    const { data: client, error: lookupErr } = await supabase
      .from('clients')
      .select('id, name, business_name')
      .eq('brand_intake_token', token)
      .maybeSingle()

    if (lookupErr || !client) {
      return NextResponse.json({ success: false, error: 'Invalid or expired link' }, { status: 404 })
    }

    const form = body.form ?? {}
    const brandProfile = normalizeBrandProfile(form.brand_profile ?? body.profile ?? null)

    const updatePayload: Record<string, unknown> = {
      brand_profile: brandProfile,
      brand_intake_submitted_at: new Date().toISOString(),
    }

    const stringFields: Array<keyof IntakeFormPayload> = [
      'name',
      'business_name',
      'industry',
      'target_audience',
      'website_url',
      'profile_picture_url',
      'brand_doc_url',
      'dos_and_donts',
      'topics_library',
      'key_stories',
      'unique_mechanisms',
      'social_proof',
      'competitor_insights',
    ]

    for (const key of stringFields) {
      if (form[key] === undefined) continue
      updatePayload[key] = cleanString(form[key])
    }

    const { error: updateErr } = await supabase
      .from('clients')
      .update(updatePayload)
      .eq('id', client.id)

    if (updateErr) {
      console.error('brand intake submit error:', updateErr)
      return NextResponse.json({ success: false, error: 'Failed to save' }, { status: 500 })
    }

    const finalName =
      (cleanString(form.name) || client.name || 'A client') as string
    const finalBusiness =
      cleanString(form.business_name) || client.business_name || null

    // Fire-and-forget notifications; don't block the response
    notifyAgency(req, client.id, finalName, finalBusiness).catch((e) =>
      console.error('notifyAgency error:', e),
    )

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('brand intake submit exception:', err)
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
