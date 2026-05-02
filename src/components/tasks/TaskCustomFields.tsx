'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Plus,
  Trash2,
  Type as TypeIcon,
  Link as LinkIcon,
  FileText,
  Folder as FolderIcon,
  ExternalLink,
  Link2,
} from 'lucide-react'
import { FileUpload } from '@/components/ui/FileUpload'

type FieldType = 'text' | 'url' | 'file' | 'folder'
type FieldRole = 'main_deliverable' | 'captions' | 'thumbnail' | 'cover' | 'generic'

interface CustomField {
  id: string
  task_id: string
  name: string
  type: FieldType
  role: FieldRole
  value: string | null
  parent_field_id: string | null
  position: number
}

const TYPE_OPTIONS: { id: FieldType; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'text',   label: 'Text',   icon: TypeIcon },
  { id: 'url',    label: 'URL',    icon: LinkIcon },
  { id: 'file',   label: 'File',   icon: FileText },
  { id: 'folder', label: 'Folder', icon: FolderIcon },
]

const ROLE_OPTIONS: { id: FieldRole; label: string }[] = [
  { id: 'generic',          label: 'Generic' },
  { id: 'main_deliverable', label: 'Main deliverable' },
  { id: 'captions',         label: 'Captions' },
  { id: 'thumbnail',        label: 'Thumbnail' },
  { id: 'cover',            label: 'Cover' },
]

const ROLE_LABEL: Record<FieldRole, string> = ROLE_OPTIONS.reduce(
  (acc, r) => ({ ...acc, [r.id]: r.label }),
  {} as Record<FieldRole, string>,
)

const ROLE_BADGE: Record<FieldRole, string> = {
  main_deliverable: 'bg-indigo-50 text-indigo-700',
  captions:         'bg-amber-50 text-amber-700',
  thumbnail:        'bg-purple-50 text-purple-700',
  cover:            'bg-cyan-50 text-cyan-700',
  generic:          'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]',
}

interface Props {
  taskId: string
}

export function TaskCustomFields({ taskId }: Props) {
  const [fields, setFields] = useState<CustomField[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [draftType, setDraftType] = useState<FieldType>('text')
  const [draftRole, setDraftRole] = useState<FieldRole>('generic')
  const [creating, setCreating] = useState(false)

  const refresh = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await fetch(`/api/tasks/${taskId}/custom-fields`)
      const data = await res.json()
      if (data.success) setFields(data.fields || [])
    } finally {
      setIsLoading(false)
    }
  }, [taskId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Pairing: only main_deliverable fields can be the *target* of a pairing.
  // The "from" side (captions/thumbnail/cover) is what carries parent_field_id.
  const pairTargets = useMemo(
    () => fields.filter((f) => f.role === 'main_deliverable'),
    [fields],
  )

  const handleCreate = async () => {
    const name = draftName.trim()
    if (!name) return
    setCreating(true)
    try {
      const res = await fetch(`/api/tasks/${taskId}/custom-fields`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, type: draftType, role: draftRole }),
      })
      const data = await res.json()
      if (data.success) {
        setFields((prev) => [...prev, data.field])
        setDraftName('')
        setDraftType('text')
        setDraftRole('generic')
        setShowCreate(false)
      }
    } finally {
      setCreating(false)
    }
  }

  const updateField = async (id: string, body: Partial<Pick<CustomField, 'name' | 'role' | 'value' | 'parent_field_id'>>) => {
    setFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...body } : f)))
    await fetch(`/api/tasks/custom-fields/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: body.name,
        role: body.role,
        value: body.value,
        parentFieldId: body.parent_field_id ?? null,
      }),
    })
  }

  const handleDelete = async (id: string) => {
    setFields((prev) => prev.filter((f) => f.id !== id))
    await fetch(`/api/tasks/custom-fields/${id}`, { method: 'DELETE' })
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-wide text-[var(--text-tertiary)] font-medium">Custom fields</p>
        <button
          type="button"
          onClick={() => setShowCreate((v) => !v)}
          className="inline-flex items-center gap-1 text-xs text-[#2B79F7] hover:underline"
        >
          <Plus className="h-3.5 w-3.5" />
          New field
        </button>
      </div>

      {showCreate && (
        <div className="border border-[var(--border-primary)] rounded-lg p-3 space-y-3 bg-[var(--bg-tertiary)]">
          <input
            autoFocus
            type="text"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            placeholder="Field name (e.g. Long form 1)"
            className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
          />
          <div className="grid grid-cols-2 gap-2">
            <select
              value={draftType}
              onChange={(e) => setDraftType(e.target.value as FieldType)}
              className="pl-3 pr-9 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] text-sm focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
            >
              {TYPE_OPTIONS.map((t) => (
                <option key={t.id} value={t.id}>
                  Type · {t.label}
                </option>
              ))}
            </select>
            <select
              value={draftRole}
              onChange={(e) => setDraftRole(e.target.value as FieldRole)}
              className="pl-3 pr-9 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] text-sm focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r.id} value={r.id}>
                  Category · {r.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setShowCreate(false)
                setDraftName('')
              }}
              className="px-3 py-1.5 rounded-lg text-xs text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={creating || !draftName.trim()}
              className="px-3 py-1.5 rounded-lg bg-[#2B79F7] text-white text-xs font-medium disabled:opacity-50"
            >
              Create field
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <p className="text-xs text-[var(--text-tertiary)]">Loading…</p>
      ) : fields.length === 0 ? (
        <p className="text-xs text-[var(--text-tertiary)] italic">
          No custom fields. Add one to start tracking deliverables.
        </p>
      ) : (
        <ul className="space-y-2">
          {fields.map((f) => (
            <FieldRow
              key={f.id}
              field={f}
              pairTargets={pairTargets.filter((t) => t.id !== f.id)}
              onUpdate={(body) => void updateField(f.id, body)}
              onDelete={() => void handleDelete(f.id)}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function FieldRow({
  field,
  pairTargets,
  onUpdate,
  onDelete,
}: {
  field: CustomField
  pairTargets: CustomField[]
  onUpdate: (body: Partial<Pick<CustomField, 'name' | 'role' | 'value' | 'parent_field_id'>>) => void
  onDelete: () => void
}) {
  const [name, setName] = useState(field.name)
  const [value, setValue] = useState(field.value ?? '')

  useEffect(() => setName(field.name), [field.name])
  useEffect(() => setValue(field.value ?? ''), [field.value])

  // Pairing UI is only meaningful for non-main-deliverable, non-generic roles.
  const canPair = field.role !== 'main_deliverable' && field.role !== 'generic'

  const onNameBlur = () => {
    if (name.trim() && name !== field.name) onUpdate({ name: name.trim() })
  }

  const commitValue = (next: string | null) => {
    if (next !== (field.value ?? null)) onUpdate({ value: next })
  }

  return (
    <li className="border border-[var(--border-primary)] rounded-lg p-3 space-y-2 group">
      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={onNameBlur}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
          className="flex-1 min-w-[160px] text-sm font-medium text-[var(--text-primary)] bg-transparent border-0 outline-none focus:ring-0 p-0"
          placeholder="Field name"
        />
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium uppercase bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]">
          {field.type}
        </span>
        <select
          value={field.role}
          onChange={(e) => onUpdate({ role: e.target.value as FieldRole })}
          className={`pl-2 pr-7 py-0.5 rounded-full text-[10px] font-medium uppercase border-0 focus:outline-none focus:ring-2 focus:ring-[#2B79F7] cursor-pointer ${ROLE_BADGE[field.role]}`}
          aria-label="Field role"
        >
          {ROLE_OPTIONS.map((r) => (
            <option key={r.id} value={r.id} className="text-[var(--text-primary)]">
              {r.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={onDelete}
          className="p-1 rounded text-[var(--text-tertiary)] hover:text-red-600 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition"
          aria-label="Delete field"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Value editor by type */}
      {field.type === 'text' && (
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => commitValue(value)}
          rows={2}
          placeholder="Enter text…"
          className="w-full text-sm text-[var(--text-secondary)] px-2 py-1.5 rounded border border-[var(--border-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7] resize-none placeholder:text-[var(--text-tertiary)]"
        />
      )}
      {(field.type === 'url' || field.type === 'folder') && (
        <div className="flex items-center gap-2">
          <input
            type="url"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={() => commitValue(value || null)}
            placeholder={field.type === 'folder' ? 'Drive / folder link…' : 'https://…'}
            className="flex-1 text-sm text-[var(--text-secondary)] px-2 py-1.5 rounded border border-[var(--border-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7] placeholder:text-[var(--text-tertiary)]"
          />
          {value && (
            <a
              href={value}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 rounded text-[var(--text-tertiary)] hover:text-[#2B79F7] hover:bg-blue-50"
              aria-label="Open link"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      )}
      {field.type === 'file' && (
        <div className="space-y-2">
          {value ? (
            <div className="flex items-center gap-2 p-2 rounded bg-green-50 border border-green-100">
              <FileText className="h-4 w-4 text-green-600 shrink-0" />
              <a
                href={value}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 text-xs text-green-700 hover:underline truncate"
              >
                {value.split('/').pop() || value}
              </a>
              <button
                type="button"
                onClick={() => commitValue(null)}
                className="text-[11px] text-red-600 hover:underline"
              >
                Remove
              </button>
            </div>
          ) : (
            <FileUpload
              folder="task-files"
              accept="*/*"
              label="Upload file"
              onUpload={(url) => {
                setValue(url)
                commitValue(url)
              }}
            />
          )}
        </div>
      )}

      {/* Pairing — only available when role is captions/thumbnail/cover. */}
      {canPair && (
        <div className="flex items-center gap-2 pt-1">
          <Link2 className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
          <span className="text-[11px] text-[var(--text-tertiary)]">Pair with</span>
          <select
            value={field.parent_field_id || ''}
            onChange={(e) =>
              onUpdate({ parent_field_id: e.target.value || null })
            }
            className="flex-1 pl-2 pr-7 py-1 rounded border border-[var(--border-primary)] bg-[var(--bg-card)] text-xs text-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
          >
            <option value="">Not paired</option>
            {pairTargets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({ROLE_LABEL[t.role]})
              </option>
            ))}
          </select>
        </div>
      )}
    </li>
  )
}
