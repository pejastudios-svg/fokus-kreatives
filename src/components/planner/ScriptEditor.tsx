'use client'

// Editable script viewer for the slot drawer. Shows the current saved
// script (from generation_meta.script) with a Save button that POSTs to
// /api/planner/slot/[id]/save-script. Generation + regenerate are handled
// by the parent drawer (separate buttons since they have different costs).

import { useEffect, useRef, useState } from 'react'
import { Loader2, Save, Sparkles } from 'lucide-react'

export interface ScriptEditorProps {
  slotId: string
  /** Initial value loaded from generation_meta.script. */
  initialScript: string
  /** True when the slot is approved or has no script yet. */
  disabled?: boolean
  /** "Generate" appears when there is no script yet; "Regenerate" otherwise. */
  hasScript: boolean
  isGenerating: boolean
  onGenerate: () => Promise<void>
  /** Called after a successful save so the parent can refresh state. */
  onSaved?: (newScript: string) => void
}

export function ScriptEditor({
  slotId,
  initialScript,
  disabled,
  hasScript,
  isGenerating,
  onGenerate,
  onSaved,
}: ScriptEditorProps) {
  const [draft, setDraft] = useState(initialScript)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const lastInitialRef = useRef(initialScript)

  // Reset draft when the slot's saved script changes externally
  // (e.g. after a regenerate). Only resets if the user hasn't edited
  // since the last reset.
  useEffect(() => {
    if (initialScript !== lastInitialRef.current) {
      setDraft(initialScript)
      lastInitialRef.current = initialScript
      setSavedAt(null)
    }
  }, [initialScript])

  const dirty = draft !== initialScript

  const handleSave = async () => {
    setError(null)
    setSaving(true)
    try {
      const res = await fetch(`/api/planner/slot/${slotId}/save-script`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ script: draft }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error || 'Save failed')
      setSavedAt(Date.now())
      onSaved?.(draft)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]">
          Script
        </div>
        {hasScript && savedAt && Date.now() - savedAt < 4000 && (
          <span className="text-[10px] text-green-600">Saved</span>
        )}
      </div>

      {hasScript ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={disabled || saving}
          rows={Math.min(20, Math.max(6, draft.split('\n').length + 1))}
          className="w-full text-sm font-mono leading-relaxed rounded border border-[var(--border-primary)] bg-[var(--bg-input)] p-2.5 text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[#2B79F7] disabled:opacity-50"
          placeholder="Generated script will appear here..."
        />
      ) : (
        <div className="rounded border border-dashed border-[var(--border-primary)] p-4 text-center">
          <p className="text-xs text-[var(--text-tertiary)]">No script yet for this slot.</p>
        </div>
      )}

      {error && <p className="text-[11px] text-red-500">{error}</p>}

      <div className="flex gap-2">
        {!hasScript ? (
          <button
            type="button"
            onClick={onGenerate}
            disabled={isGenerating || disabled}
            className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 text-sm rounded-md bg-[#2B79F7] text-white font-medium hover:bg-[#1E54B7] disabled:opacity-50"
          >
            {isGenerating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {isGenerating ? 'Generating...' : 'Generate script'}
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !dirty || disabled}
              className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 text-sm rounded-md border border-[var(--border-primary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {saving ? 'Saving...' : dirty ? 'Save edits' : 'Saved'}
            </button>
            <button
              type="button"
              onClick={onGenerate}
              disabled={isGenerating || disabled}
              className="inline-flex items-center justify-center gap-2 px-3 py-2 text-sm rounded-md border border-[var(--border-primary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-50"
              title="Regenerate from scratch (replaces edits)"
            >
              {isGenerating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              Regenerate
            </button>
          </>
        )}
      </div>
    </div>
  )
}
