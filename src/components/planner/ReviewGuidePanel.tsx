'use client'

// Static per-format human review guide. Sits next to the AI-graded
// ChecklistPanel in the slot drawer and tells staff what to look for
// when reading the generated script before approving.
//
// Distinct from ChecklistPanel:
//   - ChecklistPanel = per-script AI evaluation (Mark fixed / Waive /
//     Re-check). Lives on generation_meta.checklist.
//   - ReviewGuidePanel = static instruction. Same content for every
//     script of that format. Authored in lib/checklist/reviewGuides.ts.
//
// Closed by default - staff who already know the rules just collapse it.
// Sections expand individually so a reviewer can pin one open while
// scanning the script.

import { useState } from 'react'
import { BookOpen, ChevronDown, ChevronRight } from 'lucide-react'
import type { SlotStream } from '@/lib/planner/types'
import { getReviewGuide } from '@/lib/checklist/reviewGuides'

export interface ReviewGuidePanelProps {
  stream: SlotStream
}

export function ReviewGuidePanel({ stream }: ReviewGuidePanelProps) {
  const guide = getReviewGuide(stream)
  const [open, setOpen] = useState(false)

  if (!guide) return null

  return (
    <div className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-secondary)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--bg-tertiary)] rounded-md transition-colors"
      >
        <BookOpen className="h-3.5 w-3.5 text-[var(--text-tertiary)] shrink-0" />
        <span className="flex-1 text-[11px] uppercase tracking-wide text-[var(--text-tertiary)]">
          {guide.title} · {guide.sections.length} sections
        </span>
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
        )}
      </button>

      {open && (
        <div className="px-3 pb-3 pt-1 space-y-1.5">
          {guide.sections.map((section, idx) => (
            <GuideSectionRow
              key={`${stream}-${idx}-${section.title}`}
              // Index is the source of truth for section numbering - the
              // title strings stay number-less in reviewGuides.ts so the
              // ordering is always correct regardless of which sections a
              // given guide includes.
              number={idx + 1}
              title={section.title}
              intro={section.intro}
              items={section.items}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function GuideSectionRow({
  number,
  title,
  intro,
  items,
}: {
  number: number
  title: string
  intro?: string
  items: string[]
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="rounded border border-[var(--border-primary)] bg-[var(--bg-card)]">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 text-[var(--text-tertiary)] shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 text-[var(--text-tertiary)] shrink-0" />
        )}
        <span className="flex-1 text-xs font-medium text-[var(--text-primary)]">
          {number}. {title}
        </span>
        <span className="text-[10px] text-[var(--text-tertiary)] tabular-nums">
          {items.length}
        </span>
      </button>

      {expanded && (
        <div className="px-2.5 pb-2.5 pl-6 space-y-1.5">
          {intro && (
            <p className="text-[11px] leading-snug text-[var(--text-secondary)] italic">
              {intro}
            </p>
          )}
          <ul className="space-y-1">
            {items.map((item, idx) => (
              <li
                key={idx}
                className="text-[11px] leading-snug text-[var(--text-secondary)] flex gap-1.5"
              >
                <span className="text-[var(--text-tertiary)] shrink-0">·</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
