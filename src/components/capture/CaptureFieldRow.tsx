'use client'

// Single row in the form-builder field list. Collapsed by default
// (shows label + type badge + actions). Click anywhere on the row
// header to expand into the full edit form (label, placeholder,
// helper text, type-specific options).
//
// The collapsed summary makes long forms scannable. The expand-on-
// click pattern keeps the edit affordances available without
// overwhelming the picker.

import { useRef, useState } from 'react'
import {
  Type,
  ChevronDown,
  CircleDot,
  Calendar,
  Clock,
  Link as LinkIcon,
  Mail,
  Phone,
  AlignLeft,
  ChevronRight,
  ArrowUp,
  ArrowDown,
  Trash2,
  Asterisk,
  GripVertical,
} from 'lucide-react'
import { Input } from '@/components/ui/Input'

type FieldType =
  | 'text'
  | 'email'
  | 'phone'
  | 'textarea'
  | 'select'
  | 'radio'
  | 'date'
  | 'time'
  | 'embed'

interface CaptureField {
  id: string
  type: FieldType
  label: string
  required: boolean
  placeholder?: string
  description?: string
  options?: string[]
  embedUrl?: string
  embedHeight?: number
}

interface Props {
  field: CaptureField
  index: number
  total: number
  /** Patch single field properties. */
  onUpdate: (id: string, patch: Partial<CaptureField>) => void
  /** -1 to move up, +1 to move down. */
  onMove: (id: string, delta: 1 | -1) => void
  onRemove: (id: string) => void
  /** Drag-to-reorder hooks. The parent owns the drag state so visual
   *  feedback (which row is being dragged + which is the drop target)
   *  stays consistent across the list. */
  isDragging: boolean
  isDragOver: boolean
  onDragStartField: (id: string) => void
  onDragOverField: (id: string) => void
  onDropOnField: (id: string) => void
  onDragEndField: () => void
}

const TYPE_META: Record<
  FieldType,
  { label: string; icon: React.ComponentType<{ className?: string }> }
> = {
  text: { label: 'Text', icon: Type },
  email: { label: 'Email', icon: Mail },
  phone: { label: 'Phone', icon: Phone },
  textarea: { label: 'Long text', icon: AlignLeft },
  select: { label: 'Dropdown', icon: ChevronDown },
  radio: { label: 'Options', icon: CircleDot },
  date: { label: 'Date', icon: Calendar },
  time: { label: 'Time', icon: Clock },
  embed: { label: 'Embed', icon: LinkIcon },
}

export function CaptureFieldRow({
  field,
  index,
  total,
  onUpdate,
  onMove,
  onRemove,
  isDragging,
  isDragOver,
  onDragStartField,
  onDragOverField,
  onDropOnField,
  onDragEndField,
}: Props) {
  const [expanded, setExpanded] = useState(false)
  const rowRef = useRef<HTMLDivElement>(null)
  const meta = TYPE_META[field.type]
  const Icon = meta.icon

  return (
    <div
      ref={rowRef}
      onDragOver={(e) => {
        // Allow drops on this row. Without preventDefault the drop
        // event never fires.
        if (!isDragging) {
          e.preventDefault()
          onDragOverField(field.id)
        }
      }}
      onDrop={(e) => {
        e.preventDefault()
        onDropOnField(field.id)
      }}
      className={`rounded-xl border bg-[var(--bg-secondary)] overflow-hidden transition-all ${
        isDragging
          ? 'opacity-40 border-[var(--border-primary)]'
          : isDragOver
            ? 'border-[#2B79F7] bg-[#2B79F7]/5'
            : 'border-[var(--border-primary)]'
      }`}
    >
      {/* Summary row - always visible. The drag handle is the only
          element with `draggable` - clicking elsewhere on the row
          toggles expansion as before, no accidental drags. */}
      <div className="flex items-stretch hover:bg-[var(--bg-card-hover)] transition-colors">
        {/* Drag handle: only this element is draggable. onDragStart
            walks up to the entire row ref and uses setDragImage so
            the user sees the WHOLE row floating with the cursor,
            not just the grip column. */}
        <div
          draggable
          onDragStart={(e) => {
            if (rowRef.current) {
              e.dataTransfer.setDragImage(rowRef.current, 20, 20)
            }
            e.dataTransfer.effectAllowed = 'move'
            e.dataTransfer.setData('text/plain', field.id)
            onDragStartField(field.id)
          }}
          onDragEnd={onDragEndField}
          className="px-2 flex items-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] cursor-grab active:cursor-grabbing"
          title="Drag to reorder"
        >
          <GripVertical className="h-4 w-4" />
        </div>

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex-1 min-w-0 flex items-center gap-3 pl-1 pr-4 py-3 text-left"
        >
          <ChevronRight
            className={`h-3.5 w-3.5 text-[var(--text-tertiary)] shrink-0 transition-transform ${
              expanded ? 'rotate-90' : ''
            }`}
          />
          <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] tabular-nums shrink-0">
            <Icon className="h-3.5 w-3.5" />
            {meta.label}
          </span>
          <span className="flex-1 min-w-0 text-sm font-medium text-[var(--text-primary)] truncate">
            {field.label || (
              <span className="text-[var(--text-tertiary)] italic">Untitled field</span>
            )}
          </span>
          {field.required && (
            <span
              title="Required"
              className="inline-flex items-center gap-0.5 text-[10px] uppercase tracking-wider text-amber-500"
            >
              <Asterisk className="h-3 w-3" />
              req
            </span>
          )}
        </button>

        <div className="flex items-center gap-1 pr-3">
          <button
            type="button"
            disabled={index === 0}
            onClick={() => onMove(field.id, -1)}
            className="p-1.5 rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-30 disabled:hover:bg-transparent"
            title="Move up"
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            disabled={index === total - 1}
            onClick={() => onMove(field.id, 1)}
            className="p-1.5 rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-30 disabled:hover:bg-transparent"
            title="Move down"
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onRemove(field.id)}
            className="p-1.5 rounded text-[var(--text-tertiary)] hover:text-red-500 hover:bg-red-500/10"
            title="Delete field"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Edit form - shown only when expanded. */}
      {expanded && (
        <div className="px-4 pb-4 pt-1 space-y-3 border-t border-[var(--border-primary)]">
          <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-3">
            <Input
              label="Label"
              value={field.label}
              onChange={(e) => onUpdate(field.id, { label: e.target.value })}
              placeholder="Field label"
            />
            <div>
              <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">
                Type
              </label>
              <select
                value={field.type}
                onChange={(e) => onUpdate(field.id, { type: e.target.value as FieldType })}
                className="w-full px-3 py-2.5 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-primary)] text-sm"
              >
                {Object.entries(TYPE_META).map(([key, m]) => (
                  <option key={key} value={key}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {field.type !== 'embed' && (
            <Input
              label="Placeholder (optional)"
              value={field.placeholder || ''}
              onChange={(e) => onUpdate(field.id, { placeholder: e.target.value })}
              placeholder="Type here..."
            />
          )}

          <Input
            label="Helper text (optional)"
            value={field.description || ''}
            onChange={(e) => onUpdate(field.id, { description: e.target.value })}
            placeholder="Small note shown under the field"
          />

          <label className="flex items-center gap-2 text-sm text-[var(--text-primary)] cursor-pointer">
            <input
              type="checkbox"
              checked={!!field.required}
              onChange={(e) => onUpdate(field.id, { required: e.target.checked })}
              className="h-4 w-4 rounded border-[var(--border-primary)] bg-[var(--bg-input)] text-[#2B79F7]"
            />
            Required
          </label>

          {(field.type === 'select' || field.type === 'radio') && (
            <div>
              <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">
                Options (one per line)
              </label>
              <textarea
                value={(field.options || []).join('\n')}
                onChange={(e) =>
                  onUpdate(field.id, {
                    options: e.target.value
                      .split('\n')
                      .map((x) => x.trim())
                      .filter(Boolean),
                  })
                }
                rows={4}
                className="w-full px-3 py-2.5 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[#2B79F7] resize-none"
              />
            </div>
          )}

          {field.type === 'embed' && (
            <div className="grid grid-cols-1 md:grid-cols-[3fr_1fr] gap-3">
              <Input
                label="Embed URL"
                value={field.embedUrl || ''}
                onChange={(e) => onUpdate(field.id, { embedUrl: e.target.value })}
                placeholder="https://..."
              />
              <Input
                label="Height (px)"
                type="number"
                value={String(field.embedHeight || 520)}
                onChange={(e) =>
                  onUpdate(field.id, { embedHeight: Number(e.target.value) || 520 })
                }
                placeholder="520"
              />
            </div>
          )}

          <p className="text-[10px] text-[var(--text-tertiary)] font-mono pt-1 border-t border-[var(--border-primary)]">
            id: {field.id}
          </p>
        </div>
      )}
    </div>
  )
}
