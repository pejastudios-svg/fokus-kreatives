'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Check, Search } from 'lucide-react'
import { CURRENCY_NAMES } from '@/hooks/useExchangeRates'

interface CurrencyPickerProps {
  value: string | null
  onChange: (next: string) => void
  // Codes that are valid choices. Caller should pass the codes their FX
  // feed actually supports so users can't pick something we can't use.
  options: string[]
  // Optional empty-state slot. When set, picking it calls onChange with
  // an empty string and the trigger label shows this instead of a code.
  emptyLabel?: string
  // Trigger label shown before a value is picked. Defaults to the
  // generic "Currency" so this works for any context.
  placeholder?: string
  // Show a "no value" option that calls onChange(''). Used by Convert-to
  // (so picking "Original currency" clears the override). Add Payment
  // has a required value, so it omits this.
  allowClear?: boolean
  clearLabel?: string
  // Render the trigger as a compact pill (default) or a full-width input.
  variant?: 'pill' | 'input'
  className?: string
  // Optional prefix shown before the selected code in pill variant
  // (e.g., "Convert to" or "Default").
  prefix?: string
  // Side of the trigger the dropdown anchors to. Default is right for
  // pill triggers, left for input triggers.
  align?: 'left' | 'right'
}

/**
 * Searchable currency picker. Renders a trigger (pill or input style),
 * opens a portal-free dropdown with search + scrollable options. Each
 * option shows the code in a fixed-width column and the localized name
 * next to it. Used by both the CurrencyControl convert-to selector and
 * the Add Payment form.
 */
export function CurrencyPicker({
  value,
  onChange,
  options,
  emptyLabel,
  placeholder = 'Currency',
  allowClear = false,
  clearLabel = 'Original currency',
  variant = 'pill',
  className = '',
  prefix,
  align,
}: CurrencyPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  // After the dropdown opens, measure its bounding box and shift it
  // back into the viewport if it overflows on the left or right. The
  // dropdown is positioned via Tailwind classes relative to its
  // trigger; this layout effect adds a `translate` only when needed.
  // No state-update inside the effect to avoid re-render loops -
  // mutate the DOM directly.
  useEffect(() => {
    if (!open || !dropdownRef.current) return
    const el = dropdownRef.current
    // Reset any prior translate so re-opens recompute from scratch.
    el.style.transform = ''
    const rect = el.getBoundingClientRect()
    const padding = 8
    const vw = window.innerWidth
    let dx = 0
    if (rect.left < padding) dx = padding - rect.left
    if (rect.right > vw - padding) dx = vw - padding - rect.right
    if (dx !== 0) {
      el.style.transform = `translateX(${dx}px)`
    }
  }, [open])

  const sorted = useMemo(() => [...options].sort(), [options])
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return sorted
    return sorted.filter(
      (c) =>
        c.toLowerCase().includes(q) ||
        (CURRENCY_NAMES[c] || '').toLowerCase().includes(q),
    )
  }, [sorted, query])

  const dropdownAlign = align ?? (variant === 'pill' ? 'right' : 'left')

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {variant === 'pill' ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[var(--bg-card)] border border-[var(--border-primary)] text-[11px] font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] transition-colors"
        >
          {value ? (
            <>
              {prefix && (
                <span className="text-[var(--text-tertiary)] font-normal">
                  {prefix}
                </span>
              )}
              <span>{value}</span>
              <span className="text-[var(--text-tertiary)] font-normal hidden md:inline">
                {CURRENCY_NAMES[value] ? `· ${CURRENCY_NAMES[value]}` : ''}
              </span>
            </>
          ) : (
            <span>{emptyLabel || placeholder}</span>
          )}
          <ChevronDown
            className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full px-4 py-2.5 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-xl text-left text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7] flex items-center justify-between gap-2"
        >
          {value ? (
            <span className="flex items-center gap-2 min-w-0">
              <span className="font-semibold tabular-nums">{value}</span>
              <span className="text-[var(--text-tertiary)] truncate">
                {CURRENCY_NAMES[value] || ''}
              </span>
            </span>
          ) : (
            <span className="text-[var(--text-tertiary)]">{placeholder}</span>
          )}
          <ChevronDown
            className={`h-4 w-4 text-[var(--text-tertiary)] shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </button>
      )}

      {open && (
        <div
          ref={dropdownRef}
          className={`absolute z-30 mt-1 ${dropdownAlign === 'right' ? 'right-0' : 'left-0'} w-72 max-w-[calc(100vw-1rem)] max-h-72 overflow-hidden rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] shadow-lg flex flex-col`}
        >
          <div className="p-2 border-b border-[var(--border-primary)]">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-tertiary)]" />
              <input
                autoFocus
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search currency or code…"
                className="w-full pl-7 pr-2 py-1.5 rounded-md bg-[var(--bg-tertiary)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none"
              />
            </div>
          </div>
          <ul className="overflow-y-auto">
            {allowClear && (
              <li>
                <button
                  type="button"
                  onClick={() => {
                    onChange('')
                    setOpen(false)
                    setQuery('')
                  }}
                  className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between transition-colors ${
                    !value
                      ? 'bg-blue-100 text-[#1E54B7] dark:bg-[#1E3A6F] dark:text-[#93C5FD]'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)]'
                  }`}
                >
                  <span>{clearLabel}</span>
                  {!value && <Check className="h-3.5 w-3.5" />}
                </button>
              </li>
            )}
            {filtered.length === 0 ? (
              <li className="px-3 py-4 text-xs text-[var(--text-tertiary)] text-center">
                No matches.
              </li>
            ) : (
              filtered.map((c) => {
                const active = value === c
                return (
                  <li key={c}>
                    <button
                      type="button"
                      onClick={() => {
                        onChange(c)
                        setOpen(false)
                        setQuery('')
                      }}
                      className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between gap-2 transition-colors ${
                        active
                          ? 'bg-blue-100 text-[#1E54B7] dark:bg-[#1E3A6F] dark:text-[#93C5FD]'
                          : 'text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="font-semibold tabular-nums w-10 shrink-0">
                          {c}
                        </span>
                        <span className="truncate text-[var(--text-tertiary)]">
                          {CURRENCY_NAMES[c] || ''}
                        </span>
                      </span>
                      {active && <Check className="h-3.5 w-3.5 shrink-0" />}
                    </button>
                  </li>
                )
              })
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
