'use client'

import { useEffect, useState } from 'react'

interface ExchangeRatesState {
  base: string
  date: string
  rates: Record<string, number>
  loading: boolean
  error: string | null
}

// Module-level cache so multiple components on the same page share one
// fetch. Keyed by base currency. Short TTL on the client (5 min) so a
// page navigation re-checks - the heavy lifting is done at the API
// route's 6h cache, which is closer to the upstream and covers all
// users at once. The previous 6h client cache caused stale data to
// linger across reloads even after the upstream/route changed.
type CacheEntry = { ts: number; data: Omit<ExchangeRatesState, 'loading' | 'error'> }
const cache = new Map<string, CacheEntry>()
const STALE_AFTER_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Loads daily FX rates relative to `base` (default USD) from /api/exchange-rates.
 * Always returns a usable shape - even on failure we fall back to an
 * identity table so callers can keep rendering.
 */
export function useExchangeRates(base: string = 'USD') {
  const upper = base.toUpperCase()
  const [state, setState] = useState<ExchangeRatesState>(() => {
    const cached = cache.get(upper)
    if (cached && Date.now() - cached.ts < STALE_AFTER_MS) {
      return { ...cached.data, loading: false, error: null }
    }
    return {
      base: upper,
      date: '',
      rates: { [upper]: 1 },
      loading: true,
      error: null,
    }
  })

  useEffect(() => {
    let cancelled = false
    const cached = cache.get(upper)
    if (cached && Date.now() - cached.ts < STALE_AFTER_MS) {
      setState({ ...cached.data, loading: false, error: null })
      return
    }
    void (async () => {
      setState((s) => ({ ...s, loading: true, error: null }))
      try {
        const res = await fetch(
          `/api/exchange-rates?base=${encodeURIComponent(upper)}`,
        )
        const data = (await res.json()) as {
          base: string
          date: string
          rates: Record<string, number>
          error?: string
        }
        if (cancelled) return
        cache.set(upper, {
          ts: Date.now(),
          data: { base: data.base, date: data.date, rates: data.rates },
        })
        setState({
          base: data.base,
          date: data.date,
          rates: data.rates,
          loading: false,
          error: data.error || null,
        })
      } catch (err) {
        if (cancelled) return
        console.error('useExchangeRates failed:', err)
        setState({
          base: upper,
          date: '',
          rates: { [upper]: 1 },
          loading: false,
          error: 'Could not load exchange rates.',
        })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [upper])

  return state
}

export interface ConversionResult {
  // The displayed numeric value. When `converted` is false, this is the
  // original amount unchanged.
  value: number
  // True when a real conversion using both rates succeeded; false when
  // we fell back because a rate was missing or the same currency.
  converted: boolean
  // The currency the value is actually in. Useful for the UI: when
  // `converted` is false but `to` was requested, this tells us to label
  // the value with `from`, not `to`, so we don't lie about what the
  // figure represents.
  effectiveCurrency: string
}

/**
 * Convert `amount` from `from` currency to `to` currency using a rate
 * table that is keyed relative to a base currency.
 *
 * Returns a `ConversionResult` so the UI can distinguish a successful
 * conversion from a fall-through (e.g., missing rate). On fall-through
 * we keep the *original* currency in `effectiveCurrency` so totals
 * never get the wrong currency symbol slapped on them.
 */
export function convertAmount(
  amount: number,
  from: string,
  to: string,
  rates: Record<string, number>,
): ConversionResult {
  const fromUpper = (from || '').toUpperCase()
  const toUpper = (to || '').toUpperCase()
  if (!amount) {
    return { value: 0, converted: true, effectiveCurrency: toUpper || fromUpper }
  }
  if (fromUpper === toUpper) {
    return { value: amount, converted: true, effectiveCurrency: fromUpper }
  }
  const fromRate = rates[fromUpper]
  const toRate = rates[toUpper]
  if (!fromRate || !toRate) {
    return { value: amount, converted: false, effectiveCurrency: fromUpper }
  }
  // rates are relative to the base, so:
  //   amount_in_base = amount / fromRate
  //   amount_in_to   = amount_in_base * toRate
  return {
    value: (amount / fromRate) * toRate,
    converted: true,
    effectiveCurrency: toUpper,
  }
}

// Convenience: just the number, when the caller doesn't care about
// success/failure (e.g., a chart datapoint).
export function convertAmountValue(
  amount: number,
  from: string,
  to: string,
  rates: Record<string, number>,
): number {
  return convertAmount(amount, from, to, rates).value
}

/**
 * Returns the localized currency symbol for a code (e.g. 'USD' -> '$',
 * 'NGN' -> '₦', 'EUR' -> '€'). Uses Intl.NumberFormat.formatToParts so
 * the symbol matches what totals will actually render with. Falls back
 * to the code itself if Intl can't resolve the currency.
 */
export function getCurrencySymbol(currency: string | null | undefined): string {
  if (!currency) return ''
  const upper = currency.toUpperCase()
  try {
    const parts = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: upper,
      maximumFractionDigits: 0,
    }).formatToParts(0)
    const sym = parts.find((p) => p.type === 'currency')?.value
    return sym || upper
  } catch {
    return upper
  }
}

// Currency names for the picker UI. We list the codes we have human
// names for; codes returned by the API that we don't have a name for
// still appear in dropdowns - they just show without a friendly label.
export const CURRENCY_NAMES: Record<string, string> = {
  USD: 'US Dollar',
  EUR: 'Euro',
  GBP: 'British Pound',
  CAD: 'Canadian Dollar',
  AUD: 'Australian Dollar',
  NGN: 'Nigerian Naira',
  ZAR: 'South African Rand',
  KES: 'Kenyan Shilling',
  GHS: 'Ghanaian Cedi',
  EGP: 'Egyptian Pound',
  MAD: 'Moroccan Dirham',
  TZS: 'Tanzanian Shilling',
  UGX: 'Ugandan Shilling',
  RWF: 'Rwandan Franc',
  XOF: 'West African CFA Franc',
  XAF: 'Central African CFA Franc',
  JPY: 'Japanese Yen',
  CNY: 'Chinese Yuan',
  HKD: 'Hong Kong Dollar',
  SGD: 'Singapore Dollar',
  KRW: 'South Korean Won',
  INR: 'Indian Rupee',
  IDR: 'Indonesian Rupiah',
  THB: 'Thai Baht',
  PHP: 'Philippine Peso',
  MYR: 'Malaysian Ringgit',
  VND: 'Vietnamese Dong',
  CHF: 'Swiss Franc',
  SEK: 'Swedish Krona',
  NOK: 'Norwegian Krone',
  DKK: 'Danish Krone',
  PLN: 'Polish Zloty',
  CZK: 'Czech Koruna',
  HUF: 'Hungarian Forint',
  RON: 'Romanian Leu',
  BGN: 'Bulgarian Lev',
  HRK: 'Croatian Kuna',
  RUB: 'Russian Ruble',
  TRY: 'Turkish Lira',
  ILS: 'Israeli New Shekel',
  AED: 'UAE Dirham',
  SAR: 'Saudi Riyal',
  QAR: 'Qatari Riyal',
  KWD: 'Kuwaiti Dinar',
  OMR: 'Omani Rial',
  BHD: 'Bahraini Dinar',
  JOD: 'Jordanian Dinar',
  LBP: 'Lebanese Pound',
  PKR: 'Pakistani Rupee',
  BRL: 'Brazilian Real',
  MXN: 'Mexican Peso',
  ARS: 'Argentine Peso',
  CLP: 'Chilean Peso',
  COP: 'Colombian Peso',
  PEN: 'Peruvian Sol',
  NZD: 'New Zealand Dollar',
  TWD: 'New Taiwan Dollar',
}
