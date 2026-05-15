'use client'

// Side drawer that opens when an admin event row is clicked. Shows the
// full event detail: actor, client, link target, category, status,
// failure reason (if any), and the raw meta JSON for ops debugging.
//
// Linear-density styling: hairline borders, mono font for the JSON, no
// card containers. Closes on Escape or backdrop click.

import { useEffect } from 'react'
import Link from 'next/link'
import { X, ExternalLink } from 'lucide-react'
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock'
import type { AdminEvent } from '@/lib/admin/events'

interface Props {
  event: AdminEvent | null
  onClose: () => void
}

export function EventDrawer({ event, onClose }: Props) {
  useEffect(() => {
    if (!event) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [event, onClose])

  useBodyScrollLock(event !== null)

  if (!event) return null

  const ts = new Date(event.ts)
  const tsLabel = `${ts.toLocaleDateString()} ${ts.toLocaleTimeString()}`

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl h-full overflow-y-auto bg-[var(--bg-card)] border-l border-[var(--border-primary)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 px-4 py-3 border-b border-[var(--border-primary)] bg-[var(--bg-card)] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
              {event.category} · {event.status}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] rounded"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="space-y-1">
            <p className="text-base font-medium text-[var(--text-primary)]">{event.action}</p>
            <p className="text-xs text-[var(--text-secondary)]">{event.detail}</p>
            {event.failureReason && (
              <p className="text-xs text-red-500 mt-1">{event.failureReason}</p>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3 text-xs">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] mb-0.5">When</div>
              <div className="font-mono text-[var(--text-primary)]">{tsLabel}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] mb-0.5">Actor</div>
              <div className="text-[var(--text-primary)]">{event.actorName ?? '-'}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] mb-0.5">Client</div>
              <div className="text-[var(--text-primary)]">{event.clientName ?? '-'}</div>
            </div>
          </div>

          {event.linkTarget && (
            <Link
              href={event.linkTarget}
              className="inline-flex items-center gap-1 text-xs text-[#2B79F7] hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              Open destination
            </Link>
          )}

          <div>
            <div className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] mb-1">
              Raw meta
            </div>
            <pre className="text-[11px] font-mono leading-relaxed text-[var(--text-secondary)] bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded p-2 overflow-x-auto whitespace-pre-wrap break-words">
              {JSON.stringify(event.meta, null, 2)}
            </pre>
          </div>
        </div>
      </div>
    </div>
  )
}
