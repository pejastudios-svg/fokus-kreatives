// GET /api/e/c/{token}?u=<encoded destination>&l=<label>
//
// Click tracking redirect. Logs the click against the recipient's send row
// (per-link breakdown via the label: 'cta:1', 'button', 'embed',
// 'social:instagram') and 302s to the destination. Unknown token or unsafe
// destination still redirects when possible - tracking must never break a
// recipient's click.

import { NextRequest, NextResponse } from 'next/server'
import { admin } from '@/lib/emailOutbox'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function safeTarget(raw: string | null): string | null {
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.toString()
  } catch {
    return null
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  const search = new URL(req.url).searchParams
  const target = safeTarget(search.get('u'))
  const label = (search.get('l') || '').slice(0, 100)

  if (token && target) {
    try {
      const db = admin()
      const { data: send } = await db
        .from('email_campaign_sends')
        .select('id, first_clicked_at, click_count')
        .eq('token', token)
        .maybeSingle()
      if (send) {
        await Promise.all([
          db.from('email_link_clicks').insert({
            send_id: send.id,
            url: target.slice(0, 2000),
            label: label || null,
          }),
          db
            .from('email_campaign_sends')
            .update({
              click_count: (send.click_count || 0) + 1,
              ...(send.first_clicked_at ? {} : { first_clicked_at: new Date().toISOString() }),
            })
            .eq('id', send.id),
        ])
      }
    } catch (e) {
      console.error('[e/c] click log failed:', e)
    }
  }

  return NextResponse.redirect(target || process.env.NEXT_PUBLIC_APP_URL || 'https://google.com', 302)
}
