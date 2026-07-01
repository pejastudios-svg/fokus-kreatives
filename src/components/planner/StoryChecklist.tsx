'use client'

// Read-only QA checklist dropdown shown under each generated story.
//
// Unlike the script ChecklistPanel (which supports per-item recheck / waive /
// mark-fixed because scripts are edited in place), a story is fixed by
// regenerating the whole thing ("Redo"). So this panel is display-only: it
// surfaces the AI-tell / fabrication / CTA flags so staff know whether to
// hit Redo. Collapsed by default; auto-opens when something is flagged.

import { useState } from 'react'
import { CheckCircle2, AlertTriangle, HelpCircle, ChevronDown, ClipboardCheck } from 'lucide-react'
import type { ChecklistItem, ChecklistStatus } from '@/lib/checklist/items'

export function StoryChecklist({ items }: { items?: ChecklistItem[] | null }) {
  const list = items ?? []
  const flags = list.filter((i) => i.status === 'flag').length
  const [open, setOpen] = useState(flags > 0)

  if (list.length === 0) return null

  const passed = list.filter((i) => i.status === 'pass').length

  return (
    <div className="glass-inset rounded-md">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left"
      >
        {flags > 0 ? (
          <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
        ) : (
          <ClipboardCheck className="h-3.5 w-3.5 text-green-500 shrink-0" />
        )}
        <span className="flex-1 text-[11px] font-medium text-[var(--text-secondary)]">
          Checklist · {passed}/{list.length} passed
          {flags > 0 ? ` · ${flags} flagged` : ''}
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 text-[var(--text-tertiary)] transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <ul className="px-2.5 pb-2 space-y-1.5">
          {list.map((item) => (
            <li key={item.id} className="flex items-start gap-2">
              <StatusIcon status={item.status} />
              <div className="min-w-0">
                <div className="text-[11px] leading-snug text-[var(--text-primary)]">{item.label}</div>
                {item.ai_note && item.status !== 'pass' && (
                  <div className="text-[10px] leading-snug text-[var(--text-tertiary)] italic mt-0.5">
                    {item.ai_note}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function StatusIcon({ status }: { status: ChecklistStatus }) {
  if (status === 'pass') return <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0 mt-px" />
  if (status === 'flag') return <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-px" />
  return <HelpCircle className="h-3.5 w-3.5 text-[var(--text-tertiary)] shrink-0 mt-px" />
}
