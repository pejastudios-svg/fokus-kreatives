import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const scriptUrl = process.env.APPS_SCRIPT_WEBHOOK_URL
  const secret = process.env.APPS_SCRIPT_SECRET

  if (!scriptUrl || !secret) {
    return NextResponse.json(
      { success: false, error: 'Apps Script not configured' },
      { status: 500 }
    )
  }

  try {
    const body = await req.json()

    const res = await fetch(scriptUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        secret,                    // must match Apps Script
        type: 'meeting_created',   // event type
        payload: body,             // actual meeting data
      }),
    })

    const text = await res.text()

    if (!res.ok) {
      console.error('Apps Script error:', text)
      return NextResponse.json(
        { success: false, error: 'Apps Script error', details: text },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Meeting notify error:', err)
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    )
  }
}