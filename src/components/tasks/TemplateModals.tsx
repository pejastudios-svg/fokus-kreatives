'use client'

import { useEffect, useState } from 'react'
import { readJsonSafe } from '@/lib/http/readJsonSafe'
import { X, Save, Trash2 } from 'lucide-react'
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock'

interface TaskTemplate {
  id: string
  name: string
  description: string | null
  owner_id: string | null
  is_shared: boolean
  created_at: string
}

/**
 * Modal: capture the current task as a reusable template. Stores the whole
 * task tree (subtasks + checklists + custom fields with pairings preserved
 * via temporary IDs) on the server.
 */
export function SaveTemplateModal({
  open,
  taskId,
  defaultName,
  onClose,
  onSaved,
}: {
  open: boolean
  taskId: string
  defaultName: string
  onClose: () => void
  onSaved: (template: TaskTemplate) => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isShared, setIsShared] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setName(defaultName)
      setDescription('')
      setIsShared(true)
      setError(null)
    }
  }, [open, defaultName])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useBodyScrollLock(open)

  if (!open) return null

  const handleSave = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    setIsSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/tasks/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceTaskId: taskId,
          name: trimmed,
          description: description.trim() || null,
          isShared,
        }),
      })
      const data = await readJsonSafe(res)
      if (!data.success) {
        setError(data.error || 'Failed to save template')
        return
      }
      onSaved(data.template as TaskTemplate)
      onClose()
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="glass-pop relative w-full max-w-md max-h-[90vh] overflow-y-auto scrollbar-none rounded-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--glass-border)]">
          <div className="flex items-center gap-2">
            <Save className="h-4 w-4 text-[#2B79F7]" />
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Save as template</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-white/5"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="text-[11px] uppercase tracking-wide text-[var(--text-tertiary)] font-medium">
              Template name
            </label>
            <input
              autoFocus
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Monthly content package"
              className="mt-1 w-full px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
            />
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wide text-[var(--text-tertiary)] font-medium">
              Description (optional)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="What's in this template?"
              className="mt-1 w-full px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2B79F7] resize-none"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
            <input
              type="checkbox"
              checked={isShared}
              onChange={(e) => setIsShared(e.target.checked)}
              className="h-4 w-4 rounded border-[var(--border-primary)] text-[#2B79F7] focus:ring-[#2B79F7]"
            />
            Share with the team
          </label>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[var(--glass-border)]">
          <button
            type="button"
            onClick={onClose}
            className="glass-chip px-3 py-1.5 rounded-lg text-sm text-[var(--text-secondary)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={isSaving || !name.trim()}
            className="px-3 py-1.5 rounded-lg bg-[#2B79F7] text-white text-sm font-medium disabled:opacity-50"
          >
            {isSaving ? 'Saving…' : 'Save template'}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Modal: pick from a list of saved templates and instantiate it into the
 * current client + folder. Owner can also delete their own templates here.
 */
export function ApplyTemplateModal({
  open,
  clientId,
  folderId,
  onClose,
  onApplied,
}: {
  open: boolean
  clientId: string
  folderId: string | null
  onClose: () => void
  onApplied: (newTaskId: string) => void
}) {
  const [templates, setTemplates] = useState<TaskTemplate[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [applyingId, setApplyingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setIsLoading(true)
    void (async () => {
      try {
        const res = await fetch('/api/tasks/templates')
        const data = await readJsonSafe(res)
        if (data.success) setTemplates(data.templates || [])
      } finally {
        setIsLoading(false)
      }
    })()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useBodyScrollLock(open)

  if (!open) return null

  const handleApply = async (templateId: string) => {
    setApplyingId(templateId)
    setError(null)
    try {
      const res = await fetch(`/api/tasks/templates/${templateId}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, folderId }),
      })
      const data = await readJsonSafe(res)
      if (!data.success) {
        setError(data.error || 'Failed to apply template')
        return
      }
      onApplied(data.taskId as string)
      onClose()
    } finally {
      setApplyingId(null)
    }
  }

  const handleDelete = async (templateId: string) => {
    setTemplates((prev) => prev.filter((t) => t.id !== templateId))
    await fetch(`/api/tasks/templates/${templateId}`, { method: 'DELETE' })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="glass-pop relative w-full max-w-lg max-h-[90vh] overflow-y-auto scrollbar-none rounded-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--glass-border)]">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Use a template</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-white/5"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          {isLoading ? (
            <p className="px-5 py-8 text-center text-xs text-[var(--text-tertiary)]">Loading templates…</p>
          ) : templates.length === 0 ? (
            <p className="px-5 py-8 text-center text-xs text-[var(--text-tertiary)]">
              No templates saved yet. Open a task and use &ldquo;Save as template&rdquo;.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--glass-border)]">
              {templates.map((t) => (
                <li key={t.id} className="flex items-center gap-3 px-5 py-3 hover:bg-white/5 group">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--text-primary)] truncate">{t.name}</p>
                    {t.description && (
                      <p className="text-xs text-[var(--text-tertiary)] truncate">{t.description}</p>
                    )}
                    <p className="text-[10px] text-[var(--text-tertiary)] mt-0.5">
                      {t.is_shared ? 'Shared' : 'Private'} · saved{' '}
                      {new Date(t.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleDelete(t.id)}
                    className="p-1.5 rounded text-[var(--text-tertiary)] opacity-0 group-hover:opacity-100 hover:text-red-600 hover:bg-red-50 transition"
                    aria-label="Delete template"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleApply(t.id)}
                    disabled={applyingId === t.id}
                    className="px-3 py-1.5 rounded-lg bg-[#2B79F7] text-white text-xs font-medium hover:bg-[#1E54B7] disabled:opacity-50"
                  >
                    {applyingId === t.id ? 'Applying…' : 'Apply'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {error && <p className="px-5 pb-3 text-xs text-red-600">{error}</p>}
      </div>
    </div>
  )
}
