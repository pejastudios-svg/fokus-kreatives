'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { MoreVertical, Check } from 'lucide-react'

// Three-dot overflow menu. Hosts secondary actions on a page header
// (Export PDF, Export CSV, Print, etc.) so the primary action button
// stays clean. Closes on outside click + Escape.
//
// Items can be regular actions OR section-header dividers, used to
// group related items (e.g. "SORT BY" / "FILTER" / "ACTIONS"). Action
// items can also carry an `active` flag for radio-style behavior - the
// active item gets a check mark.

export interface KebabMenuAction {
  type?: 'action'
  label: string
  onClick: () => void
  icon?: ReactNode
  tone?: 'default' | 'destructive'
  disabled?: boolean
  hint?: string
  // When true, renders a check on the right - used for radio-style
  // option groups (sort-by, filter-by-status, etc.).
  active?: boolean
  // When true, the menu stays open after click. Used for things like
  // toggling a filter on/off without closing the popover. Default false.
  keepOpen?: boolean
}

export interface KebabMenuSection {
  type: 'section'
  label: string
}

export type KebabMenuItem = KebabMenuAction | KebabMenuSection

interface KebabMenuProps {
  items: KebabMenuItem[]
  label?: string
  align?: 'left' | 'right'
  className?: string
}

export function KebabMenu({
  items,
  label = 'More actions',
  align = 'right',
  className = '',
}: KebabMenuProps) {
  const [open, setOpen] = useState(false)
  // Flip the panel above the trigger when the space below can't fit it
  // (cards on the last visible row would otherwise push it off-screen).
  const [dropUp, setDropUp] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const toggle = () => {
    if (!open && ref.current) {
      const r = ref.current.getBoundingClientRect()
      const spaceBelow = window.innerHeight - r.bottom
      const estimated = Math.min(items.length * 38 + 12, window.innerHeight * 0.7)
      setDropUp(spaceBelow < estimated && r.top > spaceBelow)
    }
    setOpen((v) => !v)
  }

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (items.length === 0) return null

  return (
    <div ref={ref} className={`relative inline-block ${className}`}>
      <button
        type="button"
        onClick={toggle}
        title={label}
        aria-label={label}
        className="p-2 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] transition-colors"
      >
        <MoreVertical className="h-4 w-4" />
      </button>

      {open && (
        <div
          className={`absolute z-30 ${dropUp ? 'bottom-full mb-1' : 'top-full mt-1'} ${align === 'right' ? 'right-0' : 'left-0'} w-60 max-w-[calc(100vw-1rem)] rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] shadow-xl overflow-hidden max-h-[70vh] overflow-y-auto`}
        >
          <ul className="py-1">
            {items.map((item, i) => {
              if (item.type === 'section') {
                // Don't show a section divider as the very first item
                // (looks like a stray label) - skip when previous item
                // doesn't exist.
                const isFirst = i === 0
                return (
                  <li
                    key={i}
                    className={`px-3 ${isFirst ? 'pt-1' : 'pt-2'} pb-1 text-[10px] uppercase tracking-wider font-semibold text-[var(--text-tertiary)] ${isFirst ? '' : 'border-t border-[var(--border-primary)] mt-1'}`}
                  >
                    {item.label}
                  </li>
                )
              }
              const isDestructive = item.tone === 'destructive'
              return (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => {
                      if (item.disabled) return
                      if (!item.keepOpen) setOpen(false)
                      item.onClick()
                    }}
                    disabled={item.disabled}
                    className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                      isDestructive
                        ? 'text-red-500 hover:bg-red-500/10'
                        : item.active
                          ? 'bg-[var(--bg-card-hover)] text-[var(--text-primary)]'
                          : 'text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {item.icon && (
                      <span
                        className={
                          isDestructive
                            ? 'text-red-500'
                            : 'text-[var(--text-tertiary)]'
                        }
                      >
                        {item.icon}
                      </span>
                    )}
                    <span className="flex-1 min-w-0">
                      <span className="block truncate">{item.label}</span>
                      {item.hint && (
                        <span className="block text-[11px] text-[var(--text-tertiary)] truncate">
                          {item.hint}
                        </span>
                      )}
                    </span>
                    {item.active && (
                      <Check className="h-3.5 w-3.5 text-[#2B79F7] shrink-0" />
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
