'use client'

import { useMemo } from 'react'
import { RefreshCw } from 'lucide-react'
import { CURRENCY_NAMES } from '@/hooks/useExchangeRates'
import { CurrencyPicker } from './CurrencyPicker'

interface CurrencyControlProps {
  // Currency codes that actually appear in the data set
  // (e.g., ['USD', 'NGN', 'EUR']). Powers the filter chips.
  available: string[]

  // Active filter: a currency code or 'ALL'.
  filter: string
  onFilterChange: (next: string) => void

  // Override the default for display only. null = use the default.
  convertTo: string | null
  onConvertToChange: (next: string | null) => void

  // The fallback currency that "All" totals get converted INTO when no
  // explicit convertTo is set. Persisted per-CRM by the parent.
  defaultCurrency: string
  onDefaultCurrencyChange: (next: string) => void

  // Codes the FX feed actually has rates for. Limits both the convert-to
  // and default-currency pickers to reachable targets.
  supportedTargets: string[]

  // Loading + freshness signals from useExchangeRates.
  loading?: boolean
  date?: string
  error?: string | null
}

export function CurrencyControl({
  available,
  filter,
  onFilterChange,
  convertTo,
  onConvertToChange,
  defaultCurrency,
  onDefaultCurrencyChange,
  supportedTargets,
  loading,
  date,
  error,
}: CurrencyControlProps) {
  const filterChips = useMemo(() => ['ALL', ...available], [available])

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {/* Filter chips: 'All' + each currency present in data. Each chip
            shows the code; the full name appears on hover via title. */}
        <div className="flex items-center gap-1 flex-wrap">
          {filterChips.map((c) => {
            const active = filter === c
            const label = c === 'ALL' ? 'All' : c
            const titleText =
              c === 'ALL' ? 'All currencies' : CURRENCY_NAMES[c] || c
            return (
              <button
                key={c}
                type="button"
                onClick={() => onFilterChange(c)}
                title={titleText}
                className={`px-2.5 py-1 rounded-full text-[11px] font-semibold tracking-wide transition-colors ${
                  active
                    ? 'bg-[#2B79F7] text-white'
                    : 'bg-[var(--bg-card)] text-[var(--text-secondary)] border border-[var(--border-primary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]'
                }`}
              >
                {label}
              </button>
            )
          })}
        </div>

        {/* Default currency: what "All" totals get summed into. */}
        <CurrencyPicker
          value={defaultCurrency}
          onChange={(next) => {
            if (next) onDefaultCurrencyChange(next)
          }}
          options={supportedTargets}
          placeholder="Default"
          prefix="Default"
          variant="pill"
        />

        {/* Convert-to override. Picking a value forces every total + row
            into this currency. Picking "Original currency" clears it. */}
        <CurrencyPicker
          value={convertTo || ''}
          onChange={(next) => onConvertToChange(next || null)}
          options={supportedTargets}
          placeholder="Convert to…"
          prefix="Convert to"
          variant="pill"
          allowClear
          clearLabel="Original currency"
        />

        {/* Freshness pill */}
        {(date || loading || error) && (
          <span
            className={`inline-flex items-center gap-1 text-[10px] ${
              error ? 'text-red-500' : 'text-[var(--text-tertiary)]'
            }`}
            title={error || (date ? `Rates updated ${date}` : '')}
          >
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
            {error ? 'Rates offline' : loading ? 'Loading rates' : `FX ${date}`}
          </span>
        )}
      </div>
    </div>
  )
}
