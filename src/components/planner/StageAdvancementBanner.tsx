'use client'

import { useState } from 'react'
import { readJsonSafe } from '@/lib/http/readJsonSafe'
import { Sparkles, X } from 'lucide-react'

interface Props {
  clientId: string
  currentStage: string
  proposedStage: string
  criteriaMet: number
  criteriaTotal: number
  onChange: () => void
}

export function StageAdvancementBanner({ clientId, currentStage, proposedStage, criteriaMet, criteriaTotal, onChange }: Props) {
  const [busy, setBusy] = useState<'confirm' | 'dismiss' | null>(null)
  const [error, setError] = useState('')

  const handle = async (kind: 'confirm' | 'dismiss') => {
    setBusy(kind)
    setError('')
    try {
      const res = await fetch(`/api/planner/stage/${kind}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId }),
      })
      const j = await readJsonSafe(res)
      if (!j.success) throw new Error(j.error || 'Failed')
      onChange()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(null)
    }
  }

  const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : '')

  return (
    <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 shadow-[0_2px_8px_-3px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.14)] px-4 py-3 flex items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <Sparkles className="h-4 w-4 text-emerald-500 shrink-0" />
        <div>
          <div className="text-sm font-semibold text-[var(--text-primary)]">
            Ready to advance to {cap(proposedStage)}
          </div>
          <div className="text-xs text-[var(--text-secondary)]">
            {criteriaMet} of {criteriaTotal} criteria met. Promotes from {cap(currentStage)}.
          </div>
          {error && <div className="text-xs text-red-500 mt-0.5">{error}</div>}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => handle('dismiss')}
          disabled={busy !== null}
          className="px-2.5 py-1 text-xs rounded-md text-[var(--text-secondary)] glass-chip disabled:opacity-50"
        >
          {busy === 'dismiss' ? 'Dismissing...' : 'Dismiss'}
        </button>
        <button
          onClick={() => handle('confirm')}
          disabled={busy !== null}
          className="px-3 py-1 text-xs rounded-md bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50"
        >
          {busy === 'confirm' ? 'Confirming...' : 'Confirm'}
        </button>
        <button onClick={() => handle('dismiss')} className="p-1 text-[var(--text-tertiary)] md:hidden">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
