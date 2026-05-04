import { NextResponse } from 'next/server'

// Daily FX rates served from open.er-api.com (free, no API key, 161
// currencies including NGN/GHS/KES/ZAR/AED/etc.). Cached at the Next
// route layer for 6 hours so a busy CRM hits the upstream API 4× a day
// max. Returns `{ base, date, rates }`.
//
// Why this provider: Frankfurter (our previous choice) is ECB-sourced
// and only covers ~30 mostly-European/major currencies, which leaves
// African and a lot of emerging-market currencies out. open.er-api.com
// publishes the full ISO 4217 set with daily updates.

export const revalidate = 21600 // 6 hours

interface OpenErApiResponse {
  result: 'success' | 'error'
  base_code: string
  time_last_update_utc?: string
  rates?: Record<string, number>
  'error-type'?: string
}

export interface ExchangeRatesPayload {
  base: string
  date: string
  rates: Record<string, number>
  error?: string
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const base = (searchParams.get('base') || 'USD').toUpperCase()

  try {
    const res = await fetch(
      `https://open.er-api.com/v6/latest/${encodeURIComponent(base)}`,
      { next: { revalidate: 21600 } },
    )
    if (!res.ok) {
      throw new Error(`open.er-api responded ${res.status}`)
    }
    const data = (await res.json()) as OpenErApiResponse
    if (data.result !== 'success' || !data.rates) {
      throw new Error(data['error-type'] || 'unknown upstream error')
    }
    // Ensure base is included as 1 so callers can do `rates[code] || 1`
    // without a special case.
    const rates: Record<string, number> = {
      ...data.rates,
      [data.base_code]: 1,
    }
    const date = (data.time_last_update_utc || new Date().toUTCString()).slice(
      0,
      16,
    )
    const payload: ExchangeRatesPayload = {
      base: data.base_code,
      date,
      rates,
    }
    return NextResponse.json(payload, {
      headers: {
        // CDN edge cache for the same 6h window.
        'cache-control': 's-maxage=21600, stale-while-revalidate=86400',
      },
    })
  } catch (err) {
    console.error('exchange-rates upstream failed:', err)
    // Fail soft: return a 1:1 identity rate + an error string so the UI
    // can show "Rates offline" without crashing.
    return NextResponse.json(
      {
        base,
        date: new Date().toISOString().slice(0, 10),
        rates: { [base]: 1 },
        error: 'Upstream rates unavailable. Showing original currencies.',
      },
      { status: 200 },
    )
  }
}
