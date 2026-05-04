'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Check, Search, X } from 'lucide-react'

export interface LeadOption {
  id: string
  name: string
  email?: string | null
}

interface LeadFilterProps {
  options: LeadOption[]
  value: string[] // selected lead ids; empty = all
  onChange: (next: string[]) => void
  className?: string
  // When false, behaves as a single-select (picking another lead replaces
  // the current selection). When true, picks toggle in/out and an extra
  // "All leads" + "Clear" affordance is shown.
  multi?: boolean
}

export function LeadFilter({
  options,
  value,
  onChange,
  className = '',
  multi = true,
}: LeadFilterProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const sorted = useMemo(
    () => [...options].sort((a, b) => a.name.localeCompare(b.name)),
    [options],
  )
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return sorted
    return sorted.filter(
      (l) =>
        l.name.toLowerCase().includes(q) ||
        (l.email || '').toLowerCase().includes(q),
    )
  }, [sorted, query])

  const selectedSet = useMemo(() => new Set(value), [value])
  const selectedNames = options
    .filter((o) => selectedSet.has(o.id))
    .map((o) => o.name)

  const triggerLabel = (() => {
    if (value.length === 0) return 'All leads'
    if (value.length === 1) return selectedNames[0] || '1 lead'
    return `${value.length} leads`
  })()

  function toggle(id: string) {
    if (!multi) {
      onChange([id])
      setOpen(false)
      setQuery('')
      return
    }
    if (selectedSet.has(id)) {
      onChange(value.filter((v) => v !== id))
    } else {
      onChange([...value, id])
    }
  }

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[var(--bg-card)] border border-[var(--border-primary)] text-[11px] font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] transition-colors max-w-[220px]"
      >
        <span className="text-[var(--text-tertiary)] font-normal">Lead</span>
        <span className="truncate">{triggerLabel}</span>
        {value.length > 0 && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation()
              onChange([])
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                e.stopPropagation()
                onChange([])
              }
            }}
            className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] cursor-pointer"
            aria-label="Clear lead filter"
          >
            <X className="h-3 w-3" />
          </span>
        )}
        <ChevronDown
          className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute z-30 mt-1 right-0 w-72 max-h-80 overflow-hidden rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] shadow-lg flex flex-col">
          <div className="p-2 border-b border-[var(--border-primary)]">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-tertiary)]" />
              <input
                autoFocus
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search leads…"
                className="w-full pl-7 pr-2 py-1.5 rounded-md bg-[var(--bg-tertiary)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none"
              />
            </div>
          </div>
          {multi && (
            <div className="px-3 py-1.5 border-b border-[var(--border-primary)] flex items-center justify-between text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider">
              <span>{value.length} selected</span>
              {value.length > 0 && (
                <button
                  type="button"
                  onClick={() => onChange([])}
                  className="text-[#2B79F7] hover:underline normal-case tracking-normal text-[11px]"
                >
                  Clear
                </button>
              )}
            </div>
          )}
          <ul className="overflow-y-auto">
            {filtered.length === 0 ? (
              <li className="px-3 py-4 text-xs text-[var(--text-tertiary)] text-center">
                {options.length === 0 ? 'No leads yet.' : 'No matches.'}
              </li>
            ) : (
              filtered.map((l) => {
                const active = selectedSet.has(l.id)
                return (
                  <li key={l.id}>
                    <button
                      type="button"
                      onClick={() => toggle(l.id)}
                      className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between gap-2 transition-colors ${
                        active
                          ? 'bg-blue-100 text-[#1E54B7] dark:bg-[#1E3A6F] dark:text-[#93C5FD]'
                          : 'text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      <span className="flex flex-col min-w-0 items-start">
                        <span className="truncate font-medium">{l.name}</span>
                        {l.email && (
                          <span className="truncate text-[10px] text-[var(--text-tertiary)]">
                            {l.email}
                          </span>
                        )}
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
