'use client'

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { MoreVertical, Check } from 'lucide-react'

// Three-dot overflow menu. Hosts secondary actions on a page header
// (Export PDF, Export CSV, Print, etc.) so the primary action button
// stays clean. Closes on outside click + Escape.
//
// The dropdown is rendered in a portal (fixed-positioned). Glass cards across
// the app use backdrop-filter, which makes each card its own stacking context -
// an in-flow absolute menu would be painted UNDER later sibling cards. Portaling
// to <body> sidesteps that entirely.
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

const MENU_WIDTH = 240

export function KebabMenu({
  items,
  label = 'More actions',
  align = 'right',
  className = '',
}: KebabMenuProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  // Position the portaled menu next to the trigger, clamped to the viewport
  // and flipped above when there isn't room below.
  useLayoutEffect(() => {
    if (!open) return
    const update = () => {
      const el = triggerRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const estimated = Math.min(items.length * 38 + 12, window.innerHeight * 0.7)
      const spaceBelow = window.innerHeight - r.bottom
      const top =
        spaceBelow < estimated && r.top > spaceBelow
          ? Math.max(8, r.top - estimated - 4)
          : r.bottom + 4
      let left = align === 'right' ? r.right - MENU_WIDTH : r.left
      left = Math.min(Math.max(left, 8), window.innerWidth - MENU_WIDTH - 8)
      setPos({ top, left })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open, align, items.length])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (triggerRef.current?.contains(t)) return
      if (menuRef.current?.contains(t)) return
      setOpen(false)
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
    <div className={`relative inline-block ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={label}
        aria-label={label}
        className="p-2 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] transition-colors"
      >
        <MoreVertical className="h-4 w-4" />
      </button>

      {open && pos && typeof window !== 'undefined' &&
        createPortal(
          <div
            ref={menuRef}
            style={{ position: 'fixed', top: pos.top, left: pos.left, width: MENU_WIDTH }}
            className="glass-pop z-[9999] rounded-lg overflow-hidden max-h-[70vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-150"
          >
            <ul className="py-1">
              {items.map((item, i) => {
                if (item.type === 'section') {
                  const isFirst = i === 0
                  return (
                    <li
                      key={i}
                      className={`px-3 ${isFirst ? 'pt-1' : 'pt-2'} pb-1 text-[10px] uppercase tracking-wider font-semibold text-[var(--text-tertiary)] ${isFirst ? '' : 'border-t border-[var(--glass-border)] mt-1'}`}
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
                            isDestructive ? 'text-red-500' : 'text-[var(--text-tertiary)]'
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
          </div>,
          document.body,
        )}
    </div>
  )
}
