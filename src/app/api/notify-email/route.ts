import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const scriptUrl = process.env.APPS_SCRIPT_WEBHOOK_URL
  const secret = process.env.APPS_SCRIPT_SECRET

  if (!scriptUrl || !secret) {
    console.error('Apps Script not configured: missing URL or secret')
    return NextResponse.json(
      { success: false, error: 'Apps Script not configured' },
      { status: 500 }
    )
  }

  try {
    const body = await req.json()
    const { type, payload } = body || {}

    if (!type) {
      return NextResponse.json(
        { success: false, error: 'Missing "type"' },
        { status: 400 }
      )
    }

    // Forward to Apps Script
    const res = await fetch(scriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret,
        type,
        payload: payload || {},
      }),
    })

    const text = await res.text()

    if (!res.ok || text.startsWith('Error')) {
      console.error('Apps Script error:', text)
      return NextResponse.json(
        { success: false, error: 'Apps Script error', details: text },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('notify-email error:', err)
    return NextResponse.json(
      { success: false, error: err?.message || 'Server error' },
      { status: 500 }
    )
  }
}