import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const scriptUrl = process.env.APPS_SCRIPT_WEBHOOK_URL
    const envSecret = process.env.APPS_SCRIPT_SECRET

    if (!scriptUrl || !envSecret) {
      return NextResponse.json(
        { success: false, error: 'Apps Script not configured' },
        { status: 500 }
      )
    }

    const body = await req.json()
    const type = body?.type as string
    const payload = (body?.payload || {}) as Record<string, any>

    if (!type) {
      return NextResponse.json(
        { success: false, error: 'Missing type' },
        { status: 400 }
      )
    }

    // Allow callers to pass secret, but default to env secret.
    const secret = payload.secret || envSecret

    // If caller passed a secret and it's wrong, reject.
    if (payload.secret && payload.secret !== envSecret) {
      return NextResponse.json(
        { success: false, error: 'Invalid secret' },
        { status: 403 }
      )
    }

    const res = await fetch(scriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret,
        type,
        payload: {
          ...payload,
          secret: undefined, // don't forward the secret inside payload
        },
      }),
    })

    const text = await res.text()
    if (!res.ok) {
      console.error('Apps Script notify-email error:', text)
      return NextResponse.json(
        { success: false, error: 'Apps Script error', details: text },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('notify-email route error:', err)
    return NextResponse.json(
      { success: false, error: err?.message || 'Server error' },
      { status: 500 }
    )
  }
}