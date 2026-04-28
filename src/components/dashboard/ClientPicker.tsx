'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Image from 'next/image'
import { ChevronDown, Search, Check, UserCircle } from 'lucide-react'

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

export function ClientPicker({ clients, value, onChange, loading, placeholder = 'Choose a client…' }: Props) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const [query, setQuery] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const selected = clients.find((c) => c.id === value) || null

  const openMenu = () => {
    if (!triggerRef.current) return
    const r = triggerRef.current.getBoundingClientRect()
    const maxHeight = 360
    const viewportH = window.innerHeight
    let top = r.bottom + 6
    if (top + maxHeight > viewportH - 8) top = Math.max(8, r.top - maxHeight - 6)
    setPos({ top, left: r.left, width: r.width })
    setOpen(true)
    setQuery('')
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (menuRef.current?.contains(target)) return
      if (triggerRef.current?.contains(target)) return
      setOpen(false)
    }
    const onReposition = () => setOpen(false)
    document.addEventListener('mousedown', onDown)
    window.addEventListener('scroll', onReposition, true)
    window.addEventListener('resize', onReposition)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('scroll', onReposition, true)
      window.removeEventListener('resize', onReposition)
    }
  }, [open])

  const filtered = query.trim()
    ? clients.filter((c) =>
        (`${c.name} ${c.business_name}`).toLowerCase().includes(query.toLowerCase()),
      )
    : clients

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openMenu())}
        className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl border border-theme-primary bg-theme-card text-left hover:border-[#5A9AFF] transition-colors"
        disabled={loading}
      >
        {selected?.profile_picture_url ? (
          <Image
            src={selected.profile_picture_url}
            alt={selected.name}
            width={28}
            height={28}
            unoptimized
            className="rounded-full object-cover"
          />
        ) : selected ? (
          <div className="h-7 w-7 rounded-full bg-brand-gradient text-white text-xs font-semibold flex items-center justify-center">
            {selected.name.charAt(0).toUpperCase()}
          </div>
        ) : (
          <div className="h-7 w-7 rounded-full bg-gray-100 flex items-center justify-center text-gray-400">
            <UserCircle className="h-5 w-5" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          {selected ? (
            <>
              <p className="text-sm font-medium text-theme-primary truncate">{selected.name}</p>
              <p className="text-xs text-theme-secondary truncate">{selected.business_name}</p>
            </>
          ) : (
            <p className="text-sm text-theme-secondary">
              {loading ? 'Loading clients…' : placeholder}
            </p>
          )}
        </div>
        <ChevronDown
          className={`h-5 w-5 text-theme-tertiary shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && pos && typeof window !== 'undefined' &&
        createPortal(
          <div
            ref={menuRef}
            style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width }}
            className="z-[100] bg-theme-card rounded-xl shadow-lg border border-theme-primary animate-in zoom-in-95 fade-in duration-150 overflow-hidden flex flex-col max-h-[360px]"
          >
            <div className="p-2 border-b border-theme-primary">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-theme-tertiary" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search clients…"
                  className="w-full pl-9 pr-3 py-2 rounded-lg border border-theme-primary bg-theme-tertiary/30 text-sm text-theme-primary focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                />
              </div>
            </div>
            <div className="overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="px-4 py-6 text-sm text-theme-secondary text-center">No clients match.</p>
              ) : (
                filtered.map((c) => {
                  const isSelected = c.id === value
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        onChange(c.id)
                        setOpen(false)
                      }}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-theme-tertiary/50 transition-colors ${
                        isSelected ? 'bg-[#E8F1FF]' : ''
                      }`}
                    >
                      {c.profile_picture_url ? (
                        <Image
                          src={c.profile_picture_url}
                          alt={c.name}
                          width={28}
                          height={28}
                          unoptimized
                          className="rounded-full object-cover"
                        />
                      ) : (
                        <div className="h-7 w-7 rounded-full bg-brand-gradient text-white text-xs font-semibold flex items-center justify-center">
                          {c.name.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-theme-primary truncate">{c.name}</p>
                        <p className="text-xs text-theme-secondary truncate">{c.business_name}</p>
                      </div>
                      {isSelected && <Check className="h-4 w-4 text-[#2B79F7] shrink-0" />}
                    </button>
                  )
                })
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
