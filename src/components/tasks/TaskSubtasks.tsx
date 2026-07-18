'use client'

import { useCallback, useEffect, useState } from 'react'
import { readJsonSafe } from '@/lib/http/readJsonSafe'
import Link from 'next/link'
import { Plus, ChevronRight, Trash2 } from 'lucide-react'

type TaskStatus =
  | 'new'
  | 'in_progress'
  | 'waiting_for_footage'
  | 'discontinued'
  | 'ready_for_review'
  | 'ready_for_approval'
  | 'approved'
  | 'complete'

interface Subtask {
  id: string
  name: string
  status: TaskStatus
}

const STATUS_DOT: Record<TaskStatus, string> = {
  new: '#3B82F6',
  in_progress: '#A855F7',
  waiting_for_footage: '#F59E0B',
  discontinued: '#EF4444',
  ready_for_review: '#06B6D4',
  ready_for_approval: '#6366F1',
  approved: '#10B981',
  complete: '#22C55E',
}

const STATUS_LABEL: Record<TaskStatus, string> = {
  new: 'New',
  in_progress: 'In progress',
  waiting_for_footage: 'Waiting for footage',
  discontinued: 'Discontinued',
  ready_for_review: 'Ready for review',
  ready_for_approval: 'Ready for approval',
  approved: 'Approved',
  complete: 'Complete',
}

interface Props {
  parentTaskId: string
  clientId: string
}

export function TaskSubtasks({ parentTaskId, clientId }: Props) {
  const [subtasks, setSubtasks] = useState<Subtask[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [creating, setCreating] = useState(false)

  const refresh = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await fetch(
        `/api/tasks?clientId=${encodeURIComponent(clientId)}&parentTaskId=${encodeURIComponent(parentTaskId)}`,
      )
      const data = await readJsonSafe(res)
      if (data.success) setSubtasks(data.tasks || [])
    } finally {
      setIsLoading(false)
    }
  }, [parentTaskId, clientId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const handleCreate = async () => {
    const name = draftName.trim()
    if (!name) return
    setCreating(true)
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, parentTaskId, name }),
      })
      const data = await readJsonSafe(res)
      if (data.success) {
        setSubtasks((prev) => [data.task, ...prev])
        setDraftName('')
        setShowAdd(false)
      }
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (id: string) => {
    setSubtasks((prev) => prev.filter((s) => s.id !== id))
    const res = await fetch(`/api/tasks/${id}`, { method: 'DELETE' })
    const data = await readJsonSafe(res)
    if (!data.success) {
      // If it failed, refetch to recover state.
      void refresh()
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-wide text-[var(--text-tertiary)] font-medium">Subtasks</p>
        <button
          type="button"
          onClick={() => setShowAdd((v) => !v)}
          className="inline-flex items-center gap-1 text-xs text-[#2B79F7] hover:underline"
        >
          <Plus className="h-3.5 w-3.5" />
          Add subtask
        </button>
      </div>

      {showAdd && (
        <div className="flex items-center gap-2">
          <input
            autoFocus
            type="text"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleCreate()
              if (e.key === 'Escape') {
                setShowAdd(false)
                setDraftName('')
              }
            }}
            placeholder="Subtask name…"
            className="flex-1 px-3 py-1.5 rounded-lg border border-[var(--border-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
          />
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={creating || !draftName.trim()}
            className="px-3 py-1.5 rounded-lg bg-[#2B79F7] text-white text-xs font-medium disabled:opacity-50"
          >
            Add
          </button>
        </div>
      )}

      {isLoading ? (
        <p className="text-xs text-[var(--text-tertiary)]">Loading…</p>
      ) : subtasks.length === 0 ? (
        <p className="text-xs text-[var(--text-tertiary)] italic">No subtasks yet.</p>
      ) : (
        <ul className="glass-inset divide-y divide-[var(--glass-border)] rounded-lg overflow-hidden">
          {subtasks.map((s) => (
            <li
              key={s.id}
              className="flex items-center gap-2 px-3 py-2 hover:bg-white/5 group"
            >
              <span
                className="h-2 w-2 rounded-full shrink-0"
                style={{ backgroundColor: STATUS_DOT[s.status] }}
                title={STATUS_LABEL[s.status]}
              />
              <Link
                href={`/tasks/${s.id}`}
                className="flex-1 min-w-0 text-sm text-[var(--text-primary)] truncate hover:text-[#2B79F7]"
              >
                {s.name}
              </Link>
              <span className="text-[11px] text-[var(--text-tertiary)]">{STATUS_LABEL[s.status]}</span>
              <button
                type="button"
                onClick={() => void handleDelete(s.id)}
                className="p-1 rounded text-[var(--text-tertiary)] opacity-0 group-hover:opacity-100 hover:text-red-600 hover:bg-red-50 transition"
                aria-label="Delete subtask"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
              <Link
                href={`/tasks/${s.id}`}
                className="p-1 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                aria-label="Open subtask"
              >
                <ChevronRight className="h-4 w-4" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
