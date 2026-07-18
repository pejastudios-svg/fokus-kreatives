'use client'

// Pre-generation material readiness for the planner. Tells staff, before they
// hit Regenerate plan, whether this client has enough usable topics for their
// tier and flags topics whose thin/missing answers will silently drop a
// stream's pieces. Reads /api/planner/readiness.

import { useCallback, useEffect, useState } from 'react'
import { readJsonSafe } from '@/lib/http/readJsonSafe'
import { AlertTriangle, CheckCircle2, ChevronDown, Loader2 } from 'lucide-react'
import { STREAM_LABEL, type StreamKey } from '@/lib/planner/readiness'

interface TopicAssessment {
  topic_group_id: string
  title: string | null
  thinTypes: string[]
  missingTypes: string[]
  atRiskStreams: StreamKey[]
  ready: boolean
}

interface ReadinessReport {
  topicsAvailable: number
  topicsNeeded: number
  topicsReady: number
  shortfall: number
  topics: TopicAssessment[]
}

const TYPE_LABEL: Record<string, string> = {
  scene: 'origin',
  failed_attempt: 'failed attempt',
  turning_point: 'turning point',
  framework: 'framework',
  proof: 'proof',
  opinion: 'opinion',
  named_mentor: 'mentor',
  win_moment: 'win',
}

const streamList = (s: StreamKey[]) => s.map((x) => STREAM_LABEL[x]).join(', ')

export function ReadinessPanel({ clientId, months }: { clientId: string; months: number }) {
  const [report, setReport] = useState<ReadinessReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/planner/readiness?clientId=${clientId}&months=${months}`, {
        cache: 'no-store',
      })
      const j = await readJsonSafe(res)
      if (j.success) setReport(j.report as ReadinessReport)
    } catch {
      // Non-blocking - the panel just hides on error.
    } finally {
      setLoading(false)
    }
  }, [clientId, months])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) {
    return (
      <div className="glass-card flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-[var(--text-tertiary)]">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking material readiness…
      </div>
    )
  }
  if (!report) return null

  const enoughTopics = report.topicsReady >= report.topicsNeeded
  const atRiskTopics = report.topics.filter((t) => t.atRiskStreams.length > 0)
  const allClear = enoughTopics && atRiskTopics.length === 0

  return (
    <div
      className={`rounded-lg border px-3 py-2 text-xs shadow-[0_2px_8px_-3px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.14)] ${
        allClear
          ? 'border-green-300/60 bg-green-50 dark:border-green-900/60 dark:bg-green-950/40'
          : 'border-amber-300/60 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/40'
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-left"
      >
        {allClear ? (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />
        ) : (
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
        )}
        <span className="font-medium text-[var(--text-primary)]">
          {report.topicsReady}/{report.topicsNeeded} topics ready for this tier
          {report.shortfall > 0 ? ` (${report.shortfall} short)` : ''}
          {atRiskTopics.length > 0 ? ` · ${atRiskTopics.length} with thin material` : ''}
        </span>
        <ChevronDown
          className={`ml-auto h-4 w-4 shrink-0 text-[var(--text-tertiary)] transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="mt-2 space-y-2 border-t border-[var(--glass-border)] pt-2">
          {report.shortfall > 0 && (
            <p className="text-[var(--text-secondary)]">
              This tier needs {report.topicsNeeded} topic{report.topicsNeeded === 1 ? '' : 's'} of material;{' '}
              {report.topicsReady} {report.topicsReady === 1 ? 'is' : 'are'} ready. Collect{' '}
              {report.shortfall} more answered topic{report.shortfall === 1 ? '' : 's'} to fill the month.
            </p>
          )}
          {atRiskTopics.length === 0 ? (
            <p className="text-[var(--text-secondary)]">Every available topic can fill its campaign.</p>
          ) : (
            <ul className="space-y-1.5">
              {atRiskTopics.map((t, i) => (
                <li key={t.topic_group_id} className="text-[var(--text-secondary)]">
                  <span className="font-medium text-[var(--text-primary)]">{t.title || `Topic ${i + 1}`}</span>
                  : {streamList(t.atRiskStreams)} at risk
                  {(() => {
                    const weak = [...t.thinTypes, ...t.missingTypes]
                    if (weak.length === 0) return null
                    return (
                      <span className="text-[var(--text-tertiary)]">
                        {' '}
                        ({weak.map((w) => TYPE_LABEL[w] || w).join(', ')} thin or missing)
                      </span>
                    )
                  })()}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
