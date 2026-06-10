import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { encryptSecret, isSealed } from '@/lib/crypto/secretBox'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * One-time backfill: AES-256-GCM encrypt any plaintext credentials still
 * sitting in user_integrations (Calendly PATs, Google/Zoom OAuth tokens from
 * before encryption-at-rest landed). Idempotent - sealed rows are skipped, so
 * re-running is safe.
 *
 * ⚠️ SEQUENCING: run this ONLY after the code that reads via openSecret() is
 * deployed everywhere that talks to this database, and EMAIL_CRED_KEY is set
 * in every environment. Old code reads the column verbatim; encrypting under
 * it would hand "v1:..." blobs to the providers and break every integration.
 *
 * Auth: ?secret=<CRON_SECRET>, same as the other maintenance routes.
 */
export async function GET(req: NextRequest) {
  try {
    // Fail CLOSED: unlike the read-mostly cron routes, this one mutates
    // credentials, so a missing CRON_SECRET must block, not allow. (The
    // lenient `envSecret && ...` convention bit us here once already.)
    const secret = new URL(req.url).searchParams.get('secret')
    const envSecret = process.env.CRON_SECRET
    if (!envSecret || secret !== envSecret) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }
    if (!process.env.EMAIL_CRED_KEY) {
      return NextResponse.json(
        { success: false, error: 'EMAIL_CRED_KEY is not configured' },
        { status: 500 },
      )
    }

    const db = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    const { data: rows, error } = await db
      .from('user_integrations')
      .select('id, provider, access_token, refresh_token')
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    let sealed = 0
    let alreadySealed = 0
    for (const row of rows ?? []) {
      const r = row as {
        id: string
        provider: string
        access_token: string | null
        refresh_token: string | null
      }
      const patch: Record<string, string> = {}
      if (r.access_token && !isSealed(r.access_token)) {
        patch.access_token = encryptSecret(r.access_token)
      }
      if (r.refresh_token && !isSealed(r.refresh_token)) {
        patch.refresh_token = encryptSecret(r.refresh_token)
      }
      if (Object.keys(patch).length === 0) {
        alreadySealed += 1
        continue
      }
      const { error: upErr } = await db.from('user_integrations').update(patch).eq('id', r.id)
      if (upErr) {
        console.error('[encrypt-tokens] update failed for', r.id, upErr)
        return NextResponse.json(
          { success: false, error: `Update failed for ${r.provider}/${r.id}: ${upErr.message}`, sealed },
          { status: 500 },
        )
      }
      sealed += 1
    }

    return NextResponse.json({ success: true, sealed, alreadySealed, total: rows?.length ?? 0 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[encrypt-tokens] error:', err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
