'use client'

// Compact stage badge for the brand profile page. Self-fetches the stage
// state via /api/planner/data and renders a pill + progress note.
// Includes a "Open planner" link.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Calendar as CalendarIcon, Sparkles } from 'lucide-react'

interface Props {
  clientId: string
}

interface StageData {
  currentStage: 'foundation' | 'growing' | 'established'
  nextStage: 'foundation' | 'growing' | 'established' | null
  criteriaMet: string[]
  criteriaTotal: number
}

const STAGE_TONE: Record<StageData['currentStage'], { dot: string; chip: string; text: string }> = {
  foundation:  { dot: 'bg-amber-500', chip: 'bg-amber-500/15', text: 'text-amber-600 dark:text-amber-400' },
  growing:     { dot: 'bg-sky-500',   chip: 'bg-sky-500/15',   text: 'text-sky-600 dark:text-sky-400' },
  established: { dot: 'bg-emerald-500',chip: 'bg-emerald-500/15',text: 'text-emerald-600 dark:text-emerald-400' },
}

function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : ''
}

export function StageBadge({ clientId }: Props) {
  const [data, setData] = useState<StageData | null>(null)

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const res = await fetch(`/api/planner/stage?clientId=${clientId}`, { cache: 'no-store' })
        const j = await res.json()
        if (!active) return
        if (j.success && j.stage) setData(j.stage as StageData)
      } catch {
        // Silent failure - the badge is non-critical
      }
    })()
    return () => { active = false }
  }, [clientId])

  if (!data) return null
  const tone = STAGE_TONE[data.currentStage]
  const note = data.nextStage
    ? `${data.criteriaMet.length} of ${data.criteriaTotal} criteria for ${cap(data.nextStage)} met`
    : 'Top stage reached'

  return (
    <div className="inline-flex items-center gap-2 flex-wrap justify-center">
      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${tone.chip} ${tone.text}`}>
        <Sparkles className={`h-3 w-3 ${tone.text}`} />
        {cap(data.currentStage)}
      </span>
      <span className="text-xs text-[var(--text-tertiary)]">{note}</span>
      <Link
        href={`/clients/${clientId}/planner`}
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#E8F1FF] text-[#2B79F7] dark:bg-[#1E3A6F] dark:text-[#93C5FD] text-xs font-medium hover:bg-[#5A9AFF]/20 transition-colors"
      >
        <CalendarIcon className="h-3 w-3" />
        Open planner
      </Link>
    </div>
  )
}
