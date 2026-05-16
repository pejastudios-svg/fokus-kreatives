'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
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

// Mirrors the campaigns-page ClientCombobox so every picker behaves and looks
// the same: no portal, in-flow absolute dropdown, single mousedown-outside
// listener. Avoids the scroll/resize auto-close that was firing on mobile the
// instant the on-screen keyboard popped, making the menu close itself.
export function ClientPicker({
  clients,
  value,
  onChange,
  loading,
  placeholder = 'Choose a client…',
}: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!containerRef.current) return
      if (!containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
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
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={loading}
        className="w-full px-4 py-2.5 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-left text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7] flex items-center gap-2.5 disabled:opacity-50"
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

      {open && (
        // z-50 (not z-30) so the dropdown stacks above sibling
        // sections that come later in the source order, like the
        // "Content Type" cards below this picker on the Content
        // Creation Engine page.
        <div className="absolute z-50 mt-1 left-0 right-0 max-h-72 overflow-y-auto rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] shadow-lg">
          <div className="sticky top-0 bg-[var(--bg-card)] border-b border-[var(--border-primary)] p-2">
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
        </div>
      )}
    </div>
  )
}
