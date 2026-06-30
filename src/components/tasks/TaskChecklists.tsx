'use client'

import { useCallback, useEffect, useState } from 'react'
import { Plus, Trash2, Pencil, Check } from 'lucide-react'

interface ChecklistItem {
  id: string
  checklist_id: string
  label: string
  done: boolean
  position: number
}

interface Checklist {
  id: string
  task_id: string
  name: string
  position: number
  items: ChecklistItem[]
}

interface Props {
  taskId: string
}

export function TaskChecklists({ taskId }: Props) {
  const [lists, setLists] = useState<Checklist[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const refresh = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await fetch(`/api/tasks/${taskId}/checklists`)
      const data = await res.json()
      if (data.success) setLists(data.checklists || [])
    } finally {
      setIsLoading(false)
    }
  }, [taskId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const handleCreate = async () => {
    const name = draftName.trim() || 'Checklist'
    const res = await fetch(`/api/tasks/${taskId}/checklists`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    const data = await res.json()
    if (data.success) {
      setLists((prev) => [...prev, data.checklist])
      setDraftName('')
      setAdding(false)
    }
  }

  const handleRename = async (id: string) => {
    const name = renameValue.trim()
    if (!name) {
      setRenamingId(null)
      return
    }
    setLists((prev) => prev.map((l) => (l.id === id ? { ...l, name } : l)))
    setRenamingId(null)
    await fetch(`/api/tasks/checklists/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
  }

  const handleDeleteList = async (id: string) => {
    setLists((prev) => prev.filter((l) => l.id !== id))
    await fetch(`/api/tasks/checklists/${id}`, { method: 'DELETE' })
  }

  const handleAddItem = async (listId: string, label: string) => {
    if (!label.trim()) return
    const res = await fetch(`/api/tasks/checklists/${listId}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: label.trim() }),
    })
    const data = await res.json()
    if (data.success) {
      setLists((prev) =>
        prev.map((l) => (l.id === listId ? { ...l, items: [...l.items, data.item] } : l)),
      )
    }
  }

  const handleToggleItem = async (listId: string, itemId: string, done: boolean) => {
    setLists((prev) =>
      prev.map((l) =>
        l.id !== listId
          ? l
          : { ...l, items: l.items.map((it) => (it.id === itemId ? { ...it, done } : it)) },
      ),
    )
    await fetch(`/api/tasks/checklist-items/${itemId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ done }),
    })
  }

  const handleEditItemLabel = async (listId: string, itemId: string, label: string) => {
    const trimmed = label.trim()
    if (!trimmed) return
    setLists((prev) =>
      prev.map((l) =>
        l.id !== listId
          ? l
          : { ...l, items: l.items.map((it) => (it.id === itemId ? { ...it, label: trimmed } : it)) },
      ),
    )
    await fetch(`/api/tasks/checklist-items/${itemId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: trimmed }),
    })
  }

  const handleDeleteItem = async (listId: string, itemId: string) => {
    setLists((prev) =>
      prev.map((l) =>
        l.id !== listId ? l : { ...l, items: l.items.filter((it) => it.id !== itemId) },
      ),
    )
    await fetch(`/api/tasks/checklist-items/${itemId}`, { method: 'DELETE' })
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-wide text-[var(--text-tertiary)] font-medium">Checklists</p>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="inline-flex items-center gap-1 text-xs text-[#2B79F7] hover:underline"
        >
          <Plus className="h-3.5 w-3.5" />
          New checklist
        </button>
      </div>

      {adding && (
        <div className="flex items-center gap-2">
          <input
            autoFocus
            type="text"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleCreate()
              if (e.key === 'Escape') {
                setAdding(false)
                setDraftName('')
              }
            }}
            placeholder="Checklist name…"
            className="flex-1 px-3 py-1.5 rounded-lg border border-[var(--border-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
          />
          <button
            type="button"
            onClick={() => void handleCreate()}
            className="px-3 py-1.5 rounded-lg bg-[#2B79F7] text-white text-xs font-medium"
          >
            Add
          </button>
        </div>
      )}

      {isLoading ? (
        <p className="text-xs text-[var(--text-tertiary)]">Loading…</p>
      ) : lists.length === 0 ? (
        <p className="text-xs text-[var(--text-tertiary)] italic">No checklists yet.</p>
      ) : (
        lists.map((l) => {
          const total = l.items.length
          const done = l.items.filter((it) => it.done).length
          const isRenaming = renamingId === l.id
          return (
            <div key={l.id} className="glass-inset rounded-lg overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 bg-white/[0.03] border-b border-[var(--glass-border)]">
                {isRenaming ? (
                  <input
                    autoFocus
                    type="text"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={() => void handleRename(l.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleRename(l.id)
                      if (e.key === 'Escape') setRenamingId(null)
                    }}
                    className="flex-1 px-2 py-1 rounded border border-[var(--border-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setRenamingId(l.id)
                      setRenameValue(l.name)
                    }}
                    className="flex-1 text-sm font-medium text-[var(--text-primary)] text-left truncate hover:text-[#2B79F7]"
                    title="Click to rename"
                  >
                    {l.name}
                  </button>
                )}
                <span className="text-[11px] text-[var(--text-tertiary)]">
                  {done}/{total}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setRenamingId(l.id)
                    setRenameValue(l.name)
                  }}
                  className="p-1 rounded text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                  aria-label="Rename"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => void handleDeleteList(l.id)}
                  className="p-1 rounded text-[var(--text-tertiary)] hover:text-red-600 hover:bg-red-50"
                  aria-label="Delete checklist"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>

              <ul className="divide-y divide-[var(--glass-border)]">
                {l.items.map((it) => (
                  <ChecklistItemRow
                    key={it.id}
                    item={it}
                    onToggle={(done) => void handleToggleItem(l.id, it.id, done)}
                    onEdit={(label) => void handleEditItemLabel(l.id, it.id, label)}
                    onDelete={() => void handleDeleteItem(l.id, it.id)}
                  />
                ))}
              </ul>

              <ChecklistAddItem onAdd={(label) => void handleAddItem(l.id, label)} />
            </div>
          )
        })
      )}
    </div>
  )
}

function ChecklistItemRow({
  item,
  onToggle,
  onEdit,
  onDelete,
}: {
  item: ChecklistItem
  onToggle: (done: boolean) => void
  onEdit: (label: string) => void
  onDelete: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(item.label)

  useEffect(() => {
    setDraft(item.label)
  }, [item.label])

  return (
    <li className="flex items-center gap-2 px-3 py-1.5 hover:bg-white/5 group">
      <button
        type="button"
        onClick={() => onToggle(!item.done)}
        className={`h-4 w-4 rounded border flex items-center justify-center shrink-0 transition ${
          item.done
            ? 'bg-[#2B79F7] border-[#2B79F7] text-white'
            : 'border-[var(--border-primary)] hover:border-[#2B79F7]'
        }`}
        aria-label={item.done ? 'Mark incomplete' : 'Mark complete'}
      >
        {item.done && <Check className="h-3 w-3" />}
      </button>
      {editing ? (
        <input
          autoFocus
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            setEditing(false)
            if (draft.trim() && draft !== item.label) onEdit(draft)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            if (e.key === 'Escape') {
              setDraft(item.label)
              setEditing(false)
            }
          }}
          className="flex-1 px-2 py-0.5 rounded border border-[var(--border-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className={`flex-1 text-left text-sm truncate ${
            item.done ? 'line-through text-[var(--text-tertiary)]' : 'text-[var(--text-primary)]'
          }`}
        >
          {item.label}
        </button>
      )}
      <button
        type="button"
        onClick={onDelete}
        className="p-1 rounded text-[var(--text-tertiary)] opacity-0 group-hover:opacity-100 hover:text-red-600 hover:bg-red-50 transition"
        aria-label="Delete item"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </li>
  )
}

function ChecklistAddItem({ onAdd }: { onAdd: (label: string) => void }) {
  const [draft, setDraft] = useState('')
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-t border-[var(--glass-border)]">
      <Plus className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && draft.trim()) {
            onAdd(draft)
            setDraft('')
          }
        }}
        placeholder="Add item…"
        className="flex-1 bg-transparent text-sm text-[var(--text-secondary)] outline-none placeholder:text-[var(--text-tertiary)]"
      />
    </div>
  )
}
