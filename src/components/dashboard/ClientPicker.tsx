'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Image from 'next/image'
import { ChevronDown, Search, UserCircle } from 'lucide-react'

interface ClientLite {
  id: string
  name: string
  business_name: string
  profile_picture_url?: string | null
}

interface Props {
  clients: ClientLite[]
  value: string
  onChange: (id: string) => void
  loading?: boolean
  placeholder?: string
}

// The dropdown is rendered in a portal (fixed-positioned) rather than as an
// in-flow absolute element. The glass cards across the app use backdrop-filter,
// which makes each card its own stacking context - an in-flow dropdown would be
// painted UNDER later sibling cards regardless of z-index. Portaling to <body>
// sidesteps that entirely. We reposition (not close) on scroll/resize so the
// mobile keyboard popping open doesn't dismiss the menu.
export function ClientPicker({
  clients,
  value,
  onChange,
  loading,
  placeholder = 'Choose a client…',
}: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const popRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null)

  // Position the portaled menu under the trigger, flipping above if there's
  // not enough room below.
  useLayoutEffect(() => {
    if (!open) return
    const update = () => {
      const el = triggerRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const MENU_MAX = 320
      const below = window.innerHeight - r.bottom
      const top = below < MENU_MAX && r.top > below ? Math.max(8, r.top - MENU_MAX - 4) : r.bottom + 4
      setPos({ top, left: r.left, width: r.width })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open])

  // Close on outside click (trigger + portaled menu both count as "inside")
  // and on Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (triggerRef.current?.contains(t)) return
      if (popRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const selected = clients.find((c) => c.id === value) || null
  const selectedLabel = selected
    ? selected.name || selected.business_name || 'Untitled'
    : loading
      ? 'Loading clients…'
      : placeholder

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return clients
    return clients.filter((c) =>
      [c.name, c.business_name].some((v) => (v || '').toLowerCase().includes(q)),
    )
  }, [clients, query])

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={loading}
        className="glass-field w-full px-4 py-2.5 text-left flex items-center gap-2.5 disabled:opacity-50"
      >
        {selected ? (
          selected.profile_picture_url ? (
            <Image
              src={selected.profile_picture_url}
              alt={selectedLabel}
              width={24}
              height={24}
              unoptimized
              className="rounded-full object-cover shrink-0"
            />
          ) : (
            <div className="h-6 w-6 rounded-full bg-brand-gradient text-white text-[10px] font-semibold flex items-center justify-center shrink-0">
              {selectedLabel.charAt(0).toUpperCase()}
            </div>
          )
        ) : (
          <div className="h-6 w-6 rounded-full bg-[var(--bg-tertiary)] flex items-center justify-center text-[var(--text-tertiary)] shrink-0">
            <UserCircle className="h-4 w-4" />
          </div>
        )}
        <span className={`flex-1 truncate ${selected ? '' : 'text-[var(--text-tertiary)]'}`}>
          {selectedLabel}
        </span>
        {selected && selected.business_name && (
          <span className="hidden sm:inline text-xs text-[var(--text-tertiary)] truncate">
            {selected.business_name}
          </span>
        )}
        <ChevronDown
          className={`h-4 w-4 text-[var(--text-tertiary)] shrink-0 ml-2 transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {open && pos && typeof window !== 'undefined' &&
        createPortal(
          <div
            ref={popRef}
            style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width }}
            className="glass-pop z-[9999] max-h-72 overflow-y-auto rounded-xl animate-in fade-in zoom-in-95 duration-150"
          >
            <div className="sticky top-0 bg-[var(--glass-bg-strong)] border-b border-[var(--glass-border)] p-2">
              <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-[var(--bg-tertiary)]">
                <Search className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
                <input
                  autoFocus
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search clients…"
                  className="flex-1 bg-transparent text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none"
                />
              </div>
            </div>
            {filtered.length === 0 ? (
              <p className="py-6 text-center text-xs text-[var(--text-tertiary)]">
                No matching clients.
              </p>
            ) : (
              <ul>
                {filtered.map((c) => {
                  const active = c.id === value
                  const label = c.name || c.business_name || 'Untitled'
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => {
                          onChange(c.id)
                          setOpen(false)
                          setQuery('')
                        }}
                        className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2.5 transition-colors ${
                          active
                            ? 'bg-blue-100 text-[#1E54B7] dark:bg-[#1E3A6F] dark:text-[#93C5FD]'
                            : 'text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]'
                        }`}
                      >
                        {c.profile_picture_url ? (
                          <Image
                            src={c.profile_picture_url}
                            alt={label}
                            width={22}
                            height={22}
                            unoptimized
                            className="rounded-full object-cover shrink-0"
                          />
                        ) : (
                          <div className="h-[22px] w-[22px] rounded-full bg-brand-gradient text-white text-[10px] font-semibold flex items-center justify-center shrink-0">
                            {label.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <span className="flex-1 truncate">{label}</span>
                        {c.business_name && c.business_name !== label && (
                          <span
                            className={`text-[10px] shrink-0 truncate max-w-[100px] ${
                              active
                                ? 'text-[#1E54B7]/70 dark:text-[#93C5FD]/70'
                                : 'text-[var(--text-tertiary)]'
                            }`}
                          >
                            {c.business_name}
                          </span>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>,
          document.body,
        )}
    </div>
  )
}
