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
import { UploadButton } from './CaptureBlocksEditor'
import {
  Type,
  ChevronDown,
  CircleDot,
  Calendar,
  Clock,
  Link as LinkIcon,
  Globe,
  Package,
  Mail,
  Phone,
  AlignLeft,
  ChevronRight,
  ArrowUp,
  ArrowDown,
  Trash2,
  Plus,
  Asterisk,
  GripVertical,
  Eye,
  EyeOff,
} from 'lucide-react'
import { Input } from '@/components/ui/Input'
import type { PackageOption, PackageUnitOption } from './types'

type FieldType =
  | 'text'
  | 'email'
  | 'phone'
  | 'url'
  | 'textarea'
  | 'select'
  | 'radio'
  | 'date'
  | 'time'
  | 'embed'
  | 'package'

interface CaptureField {
  id: string
  type: FieldType
  label: string
  required: boolean
  hidden?: boolean
  placeholder?: string
  description?: string
  options?: string[]
  embedUrl?: string
  embedHeight?: number
  repeatable?: boolean
  mapToLead?: boolean
  packages?: PackageOption[]
  packageUnits?: PackageUnitOption[]
  packageCurrency?: string
  packageBaseFee?: number
  packagePerPieceFee?: number
  packageShowPrices?: boolean
}

const REPEATABLE_TYPES = new Set<FieldType>(['text', 'email', 'phone', 'url'])

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
  url: { label: 'Link', icon: Globe },
  textarea: { label: 'Long text', icon: AlignLeft },
  select: { label: 'Dropdown', icon: ChevronDown },
  radio: { label: 'Options', icon: CircleDot },
  date: { label: 'Date', icon: Calendar },
  time: { label: 'Time', icon: Clock },
  embed: { label: 'Embed', icon: LinkIcon },
  package: { label: 'Package', icon: Package },
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

  const patchPkg = (i: number, patch: Partial<PackageOption>) =>
    onUpdate(field.id, {
      packages: (field.packages || []).map((p, j) => (j === i ? { ...p, ...patch } : p)),
    })
  const addPackage = () =>
    onUpdate(field.id, {
      packages: [
        ...(field.packages || []),
        { id: crypto.randomUUID(), name: '', price: '', subtitle: '', features: [] },
      ],
    })
  const removePackage = (i: number) =>
    onUpdate(field.id, { packages: (field.packages || []).filter((_, j) => j !== i) })

  // Build-your-own (priced units) handlers.
  const patchUnit = (i: number, patch: Partial<PackageUnitOption>) =>
    onUpdate(field.id, {
      packageUnits: (field.packageUnits || []).map((u, j) => (j === i ? { ...u, ...patch } : u)),
    })
  const addUnit = () =>
    onUpdate(field.id, {
      packageUnits: [
        ...(field.packageUnits || []),
        { id: crypto.randomUUID(), name: '', unitPrice: 0 },
      ],
    })
  const removeUnit = (i: number) =>
    onUpdate(field.id, { packageUnits: (field.packageUnits || []).filter((_, j) => j !== i) })

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
      <div className={`flex items-stretch hover:bg-[var(--bg-card-hover)] transition-colors ${field.hidden ? 'opacity-50' : ''}`}>
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
            onClick={() => onUpdate(field.id, { hidden: !field.hidden })}
            className={`p-1.5 rounded hover:bg-[var(--bg-tertiary)] ${field.hidden ? 'text-[#2B79F7]' : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'}`}
            title={field.hidden ? 'Field is hidden - click to show' : 'Hide this field from the page'}
          >
            {field.hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
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

          {field.type !== 'embed' && field.type !== 'package' && (
            <Input
              label="Placeholder (optional)"
              value={field.placeholder || ''}
              onChange={(e) => onUpdate(field.id, { placeholder: e.target.value })}
              placeholder="Type here..."
            />
          )}

          <Input
            label={field.type === 'embed' ? 'Helper text shown under the embed (optional)' : 'Helper text (optional)'}
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

          {field.type !== 'embed' && (
            <label className="flex items-start gap-2 text-sm text-[var(--text-primary)] cursor-pointer">
              <input
                type="checkbox"
                checked={!!field.mapToLead}
                onChange={(e) => onUpdate(field.id, { mapToLead: e.target.checked })}
                className="mt-0.5 h-4 w-4 rounded border-[var(--border-primary)] bg-[var(--bg-input)] text-[#2B79F7]"
              />
              <span>
                Save answer to the lead profile
                <span className="block text-xs text-[var(--text-tertiary)]">
                  Adds a column on the Leads page and fills it from each new
                  submission. Answers already on a lead are never overwritten.
                </span>
              </span>
            </label>
          )}

          {REPEATABLE_TYPES.has(field.type) && (
            <label className="flex items-center gap-2 text-sm text-[var(--text-primary)] cursor-pointer">
              <input
                type="checkbox"
                checked={!!field.repeatable}
                onChange={(e) => onUpdate(field.id, { repeatable: e.target.checked })}
                className="h-4 w-4 rounded border-[var(--border-primary)] bg-[var(--bg-input)] text-[#2B79F7]"
              />
              Allow multiple entries (visitor can add up to 5, one per line)
            </label>
          )}

          {(field.type === 'select' || field.type === 'radio') && (
            <div>
              <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">
                Options (one per line)
              </label>
              <textarea
                value={(field.options || []).join('\n')}
                onChange={(e) =>
                  // Split only - no trim/filter here, or pressing Space at the
                  // end of a word or Enter for a new line gets stripped as you
                  // type. Empty lines are cleaned on save / when rendered.
                  onUpdate(field.id, { options: e.target.value.split('\n') })
                }
                rows={4}
                className="w-full px-3 py-2.5 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[#2B79F7] resize-none"
              />
            </div>
          )}

          {field.type === 'embed' && (
            <div className="space-y-2">
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
              <div className="flex items-center gap-2">
                <UploadButton
                  folder="capture-pages/videos"
                  accept="video/*,image/*"
                  label="Upload video"
                  onUrl={(url) => onUpdate(field.id, { embedUrl: url })}
                />
                <span className="text-[11px] text-[var(--text-tertiary)]">Upload for the clean player, or paste a YouTube / Loom / Vimeo / Drive link.</span>
              </div>
            </div>
          )}

          {field.type === 'package' && (
            <div className="space-y-4">
              {/* Custom builder (optional). Shown ALONGSIDE preset packages -
                  not instead of them. The visitor picks quantities and the
                  total adds up live. */}
              <div className="space-y-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <label className="text-sm font-medium text-[var(--text-primary)]">Custom builder (optional)</label>
                    <span className="text-xs text-[var(--text-tertiary)]">Currency</span>
                    <input
                      value={field.packageCurrency ?? '$'}
                      onChange={(e) => onUpdate(field.id, { packageCurrency: e.target.value.slice(0, 3) })}
                      className="w-14 px-2 py-1.5 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-primary)] text-sm text-center focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                      placeholder="$"
                    />
                  </div>
                  {/* Base operational costs folded into the total (not shown to
                      the visitor as separate lines). */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <Input
                      label={`Base fee, flat (${field.packageCurrency ?? '$'})`}
                      type="number"
                      value={String(field.packageBaseFee ?? 0)}
                      onChange={(e) => onUpdate(field.id, { packageBaseFee: Math.max(0, Number(e.target.value) || 0) })}
                      placeholder="500"
                    />
                    <Input
                      label={`Per-piece fee (${field.packageCurrency ?? '$'})`}
                      type="number"
                      value={String(field.packagePerPieceFee ?? 0)}
                      onChange={(e) => onUpdate(field.id, { packagePerPieceFee: Math.max(0, Number(e.target.value) || 0) })}
                      placeholder="5"
                    />
                  </div>
                  <p className="text-[11px] text-[var(--text-tertiary)] leading-snug">
                    Operational costs folded into the visitor&apos;s total once they pick at least one piece. Flat is added once; per-piece scales with the number of pieces. The visitor sees one total, not these lines.
                  </p>
                  <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={field.packageShowPrices ?? true}
                      onChange={(e) => onUpdate(field.id, { packageShowPrices: e.target.checked })}
                      className="h-4 w-4 rounded border-[var(--border-primary)] accent-[#2B79F7]"
                    />
                    Show each option&apos;s price to visitors (off = show only the running total)
                  </label>
                  {(field.packageUnits || []).map((u, i) => (
                    <div key={u.id} className="rounded-lg border border-[var(--border-primary)] p-3 space-y-2 bg-[var(--bg-card)]">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-[var(--text-tertiary)]">Option {i + 1}</span>
                        <button type="button" onClick={() => removeUnit(i)} className="p-1 rounded text-[var(--text-tertiary)] hover:text-red-500" title="Remove option">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-2">
                        <Input label="Name" value={u.name} onChange={(e) => patchUnit(i, { name: e.target.value })} placeholder="Short-form reel" />
                        <Input
                          label={`Price per unit (${field.packageCurrency ?? '$'})`}
                          type="number"
                          value={String(u.unitPrice ?? 0)}
                          onChange={(e) => patchUnit(i, { unitPrice: Math.max(0, Number(e.target.value) || 0) })}
                          placeholder="50"
                        />
                      </div>
                      <Input label="Description (optional)" value={u.description || ''} onChange={(e) => patchUnit(i, { description: e.target.value })} placeholder="60-second edited reel" />
                      <Input
                        label="Max quantity (optional, e.g. 1 for a yes/no add-on like CRM access; blank = no cap)"
                        type="number"
                        value={u.maxQty ? String(u.maxQty) : ''}
                        onChange={(e) => patchUnit(i, { maxQty: Math.max(0, Number(e.target.value) || 0) || undefined })}
                        placeholder="No cap"
                      />
                    </div>
                  ))}
                  <button type="button" onClick={addUnit} className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700">
                    <Plus className="h-4 w-4" /> Add option
                  </button>
                </div>

              {/* Preset packages (optional) - the visitor picks one. */}
              <div className="space-y-3 border-t border-[var(--border-primary)] pt-3">
              <label className="block text-sm font-medium text-[var(--text-primary)]">
                Preset packages (optional, visitor picks one)
              </label>
              {(field.packages || []).map((p, i) => (
                <div
                  key={p.id}
                  className="rounded-lg border border-[var(--border-primary)] p-3 space-y-2 bg-[var(--bg-card)]"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-[var(--text-tertiary)]">
                      Package {i + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => removePackage(i)}
                      className="p-1 rounded text-[var(--text-tertiary)] hover:text-red-500"
                      title="Remove package"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-2">
                    <Input
                      label="Name"
                      value={p.name}
                      onChange={(e) => patchPkg(i, { name: e.target.value })}
                      placeholder="Premium"
                    />
                    <Input
                      label="Price"
                      value={p.price || ''}
                      onChange={(e) => patchPkg(i, { price: e.target.value })}
                      placeholder="$49/mo"
                    />
                  </div>
                  <Input
                    label="Subtitle (optional)"
                    value={p.subtitle || ''}
                    onChange={(e) => patchPkg(i, { subtitle: e.target.value })}
                    placeholder="Business"
                  />
                  <div>
                    <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">
                      What&apos;s included (one per line)
                    </label>
                    <textarea
                      value={(p.features || []).join('\n')}
                      onChange={(e) =>
                        // Split only (see options note) so Space/Enter aren't
                        // eaten while typing. Empties cleaned on save / render.
                        patchPkg(i, { features: e.target.value.split('\n') })
                      }
                      rows={4}
                      className="w-full px-3 py-2.5 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[#2B79F7] resize-none"
                      placeholder={'Everything in Starter\nPriority support\nCustom reports'}
                    />
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={addPackage}
                className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700"
              >
                <Plus className="h-4 w-4" /> Add package
              </button>
              </div>
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
