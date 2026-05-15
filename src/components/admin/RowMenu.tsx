'use client'

// Three-dot kebab menu for activity rows. Lives at the row edge and
// opens an absolutely positioned menu on click. Closes on click-outside
// or Escape. Each menu item runs a small action - open destination, copy
// event id, view raw meta in the drawer, copy direct link to detail.

import { useEffect, useRef, useState } from 'react'
import { MoreVertical, ExternalLink, Copy, Code2, Link2 } from 'lucide-react'

export interface RowMenuAction {
  label: string
  icon: React.ReactNode
  onClick: () => void
  disabled?: boolean
}

interface Props {
  actions: RowMenuAction[]
}

export function RowMenu({ actions }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onMouseDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        className="p-1 rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
        aria-label="Row actions"
      >
        <MoreVertical className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div
          className="absolute right-0 top-full mt-1 z-30 min-w-[180px] max-w-[calc(100vw-1rem)] rounded-md border border-[var(--border-primary)] bg-[var(--bg-card)] shadow-xl py-1"
          onClick={(e) => e.stopPropagation()}
        >
          {actions.map((a, i) => (
            <button
              key={i}
              type="button"
              disabled={a.disabled}
              onClick={() => {
                a.onClick()
                setOpen(false)
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-40 disabled:cursor-not-allowed text-left"
            >
              <span className="text-[var(--text-tertiary)] shrink-0">{a.icon}</span>
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Convenience icons for callers, kept here so the call site doesn't need
// to import a dozen lucide icons just to pass them in.
export const RowMenuIcons = {
  external: <ExternalLink className="h-3 w-3" />,
  copy: <Copy className="h-3 w-3" />,
  meta: <Code2 className="h-3 w-3" />,
  link: <Link2 className="h-3 w-3" />,
}
