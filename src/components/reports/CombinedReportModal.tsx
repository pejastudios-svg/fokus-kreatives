'use client'

import { useEffect, useMemo, useState } from 'react'
import { X, FileDown } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import type { CombinedSectionKey } from './CombinedReport'

// Modal that picks which sections + date range go into the combined
// workspace report. Hands a request payload to a callback so the page
// owns the data fetch + PDF generation (it has the supabase client).

const ALL_SECTIONS: { key: CombinedSectionKey; label: string; hint: string }[] =
  [
    {
      key: 'revenue',
      label: 'Revenue',
      hint: 'Collected, outstanding, overdue + invoice list',
    },
    {
      key: 'leads',
      label: 'Leads',
      hint: 'Pipeline snapshot + leads table',
    },
    {
      key: 'meetings',
      label: 'Meetings',
      hint: 'Calendar overview + meeting list',
    },
    {
      key: 'capture',
      label: 'Capture pages',
      hint: 'Pages, submission counts + recent submissions',
    },
    {
      key: 'team',
      label: 'Team',
      hint: 'Active members + pending invites',
    },
  ]

type Preset = '7d' | '30d' | '90d' | 'ytd' | 'all' | 'custom'

const PRESETS: { id: Preset; label: string }[] = [
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
  { id: '90d', label: 'Last 90 days' },
  { id: 'ytd', label: 'Year to date' },
  { id: 'all', label: 'All time' },
  { id: 'custom', label: 'Custom' },
]

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function daysAgoIso(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function startOfYearIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-01-01`
}

export interface CombinedReportRequest {
  sections: CombinedSectionKey[]
  fromIso: string // inclusive, yyyy-mm-dd. Empty string for 'all time'.
  toIso: string // inclusive, yyyy-mm-dd
  rangeLabel: string // human-readable label used in the PDF cover
}

interface Props {
  open: boolean
  onClose: () => void
  onGenerate: (req: CombinedReportRequest) => Promise<void> | void
}

export function CombinedReportModal({ open, onClose, onGenerate }: Props) {
  const [selected, setSelected] = useState<Set<CombinedSectionKey>>(
    new Set(['revenue', 'leads', 'meetings', 'capture', 'team']),
  )
  const [preset, setPreset] = useState<Preset>('30d')
  const [fromIso, setFromIso] = useState<string>(daysAgoIso(30))
  const [toIso, setToIso] = useState<string>(todayIso())
  const [busy, setBusy] = useState(false)

  // Sync preset -> from/to. Custom keeps whatever's already in the inputs.
  useEffect(() => {
    if (preset === 'custom') return
    if (preset === 'all') {
      setFromIso('')
      setToIso(todayIso())
      return
    }
    setToIso(todayIso())
    if (preset === '7d') setFromIso(daysAgoIso(7))
    else if (preset === '30d') setFromIso(daysAgoIso(30))
    else if (preset === '90d') setFromIso(daysAgoIso(90))
    else if (preset === 'ytd') setFromIso(startOfYearIso())
  }, [preset])

  // Reset busy state if the modal is reopened.
  useEffect(() => {
    if (!open) setBusy(false)
  }, [open])

  const rangeLabel = useMemo(() => {
    if (preset === 'all') return 'All time'
    const fmt = (iso: string) => {
      if (!iso) return ''
      try {
        return new Date(iso).toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })
      } catch {
        return iso
      }
    }
    const presetLabel = PRESETS.find((p) => p.id === preset)?.label
    const presetPrefix =
      preset === 'custom' ? 'Custom' : presetLabel || 'Range'
    return `${presetPrefix} · ${fmt(fromIso)} – ${fmt(toIso)}`
  }, [preset, fromIso, toIso])

  function toggleSection(k: CombinedSectionKey) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  }

  async function handleGenerate() {
    if (busy) return
    if (selected.size === 0) return
    if (preset !== 'all' && fromIso > toIso) return
    setBusy(true)
    try {
      await onGenerate({
        sections: Array.from(selected),
        fromIso: preset === 'all' ? '' : fromIso,
        toIso,
        rangeLabel,
      })
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  const canGenerate =
    selected.size > 0 && (preset === 'all' || fromIso <= toIso)

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border-primary)] shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-primary)]">
          <div>
            <h2 className="text-base font-semibold text-[var(--text-primary)]">
              Generate workspace report
            </h2>
            <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
              Pick sections + date range. Output is a single branded PDF.
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            className="p-2 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Sections */}
        <div className="px-5 py-4">
          <p className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-semibold mb-2">
            Sections
          </p>
          <div className="space-y-1.5">
            {ALL_SECTIONS.map((s) => {
              const checked = selected.has(s.key)
              return (
                <label
                  key={s.key}
                  className="flex items-start gap-3 p-2.5 rounded-lg border border-[var(--border-primary)] hover:bg-[var(--bg-card-hover)] cursor-pointer transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleSection(s.key)}
                    className="mt-0.5 h-4 w-4 accent-[#2B79F7]"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--text-primary)]">
                      {s.label}
                    </p>
                    <p className="text-[11px] text-[var(--text-tertiary)]">
                      {s.hint}
                    </p>
                  </div>
                </label>
              )
            })}
          </div>
        </div>

        {/* Date range */}
        <div className="px-5 py-4 border-t border-[var(--border-primary)]">
          <p className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-semibold mb-2">
            Date range
          </p>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {PRESETS.map((p) => {
              const active = preset === p.id
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPreset(p.id)}
                  className={`px-3 py-1 rounded-full text-[11px] font-semibold transition-colors ${
                    active
                      ? 'bg-[#2B79F7] text-white'
                      : 'bg-[var(--bg-card)] border border-[var(--border-primary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {p.label}
                </button>
              )
            })}
          </div>
          {preset !== 'all' && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-semibold mb-1">
                  From
                </label>
                <input
                  type="date"
                  value={fromIso}
                  onChange={(e) => {
                    setFromIso(e.target.value)
                    setPreset('custom')
                  }}
                  max={toIso}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-input)] border border-[var(--border-primary)] text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-semibold mb-1">
                  To
                </label>
                <input
                  type="date"
                  value={toIso}
                  onChange={(e) => {
                    setToIso(e.target.value)
                    setPreset('custom')
                  }}
                  min={fromIso}
                  max={todayIso()}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-input)] border border-[var(--border-primary)] text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                />
              </div>
            </div>
          )}
          <p className="text-[11px] text-[var(--text-tertiary)] mt-2">
            {rangeLabel}
          </p>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[var(--border-primary)] flex items-center justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={handleGenerate}
            disabled={!canGenerate || busy}
            isLoading={busy}
          >
            <FileDown className="h-4 w-4 mr-1.5" />
            Generate PDF
          </Button>
        </div>
      </div>
    </div>
  )
}
