'use client'

// Drag-and-drop block builder for the 'landing' capture layout. Content
// elements (heading, text, button, image, video, card, logos, divider,
// spacer) and the lead form stack into the page and into row columns. Drag
// any element by its body to any position - top level or any column - and a
// blue line shows where it snaps. Native HTML5 DnD, no library.

import { useRef, useState } from 'react'
import {
  GripVertical,
  Trash2,
  Type,
  Heading,
  MousePointerClick,
  Image as ImageIcon,
  Film,
  LayoutPanelTop,
  Images,
  Minus,
  MoveVertical,
  Upload,
  Loader2,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Plus,
  Columns2,
  Columns3,
  SeparatorVertical,
  AlertTriangle,
  FormInput,
  Quote,
  GalleryHorizontal,
} from 'lucide-react'
import { Tooltip } from '@/components/ui/Tooltip'
import { DOC_FONTS, DOC_FONTS_URL } from '@/components/agreements/docStyles'
import { uploadFileDirect } from '@/lib/capture/uploadDirect'
import type { CaptureBlock, CaptureColumn, CaptureBlockType, BlockAlign, TestimonialItem } from './types'

const uid = () => `blk-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

const gridColsEditor = (n: number) =>
  n <= 1 ? 'grid-cols-1' : n === 2 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1 md:grid-cols-3'

/** Count lead-form blocks anywhere in the tree (top level + row columns). */
function countForms(blocks: CaptureBlock[]): number {
  let n = 0
  for (const b of blocks) {
    if (b.type === 'form') n++
    else if (b.type === 'row') for (const c of b.columns || []) n += countForms(c.blocks || [])
  }
  return n
}

const INPUT =
  'w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[#2B79F7]'

// Blocks the user can add. 'form' is intentionally excluded - a landing page
// has exactly one lead form, seeded by the editor and not duplicable.
const BLOCK_DEFS: Array<{
  type: CaptureBlockType
  label: string
  icon: React.ComponentType<{ className?: string }>
}> = [
  { type: 'heading', label: 'Heading', icon: Heading },
  { type: 'text', label: 'Text', icon: Type },
  { type: 'button', label: 'Button', icon: MousePointerClick },
  { type: 'image', label: 'Image', icon: ImageIcon },
  { type: 'gallery', label: 'Image row', icon: GalleryHorizontal },
  { type: 'embed', label: 'Video / embed', icon: Film },
  { type: 'card', label: 'Card / panel', icon: LayoutPanelTop },
  { type: 'logos', label: 'Logo row', icon: Images },
  { type: 'testimonials', label: 'Testimonials', icon: Quote },
  { type: 'divider', label: 'Divider', icon: Minus },
  { type: 'spacer', label: 'Spacer', icon: MoveVertical },
]

function makeBlock(type: CaptureBlockType): CaptureBlock {
  const id = uid()
  switch (type) {
    case 'heading':
      return { id, type, content: 'Your headline', size: 'lg', align: 'center' }
    case 'text':
      return { id, type, content: 'Add a short supporting sentence here.', align: 'center' }
    case 'button':
      return { id, type, label: 'Get started', url: '', variant: 'solid', align: 'center' }
    case 'image':
      return { id, type, url: '', align: 'center', maxWidth: 640 }
    case 'gallery':
      return { id, type, gallery: [{ url: '' }, { url: '' }] }
    case 'embed':
      return { id, type, url: '', title: '' }
    case 'card':
      return { id, type, heading: 'Feature', text: 'Describe it here.', cardVariant: 'soft', align: 'left' }
    case 'logos':
      return { id, type, caption: 'Trusted by', logos: [{ url: '' }, { url: '' }, { url: '' }] }
    case 'testimonials':
      return {
        id,
        type,
        testimonials: [
          { quote: 'This completely changed how we work.', name: 'Alex Rivera', subtitle: 'Founder, Northwind' },
          { quote: 'Worth every penny. The results spoke for themselves.', name: 'Sam Lee', subtitle: 'Marketing Lead' },
          { quote: 'I recommend it to everyone in my network.', name: 'Jordan Blake' },
        ],
      }
    case 'spacer':
      return { id, type, space: 'md' }
    case 'divider':
    default:
      return { id, type }
  }
}

function makeRow(count: number): CaptureBlock {
  const n = Math.min(3, Math.max(1, count))
  return {
    id: uid(),
    type: 'row',
    vAlign: 'top',
    columns: Array.from({ length: n }, () => ({ id: uid(), blocks: [] })),
  }
}

/** Resize a row's columns. Growing adds empty columns; shrinking merges the
 *  dropped columns' blocks into the last kept column so nothing is lost. */
function withColumnCount(row: CaptureBlock, n: number): CaptureColumn[] {
  const cols = row.columns || []
  if (n === cols.length) return cols
  if (n > cols.length) {
    const extra = Array.from({ length: n - cols.length }, () => ({ id: uid(), blocks: [] }))
    return [...cols, ...extra]
  }
  const keep = cols.slice(0, n)
  const dropped = cols.slice(n)
  const tail = keep[n - 1]
  const mergedTail: CaptureColumn = { ...tail, blocks: [...(tail?.blocks || []), ...dropped.flatMap((c) => c.blocks || [])] }
  return [...keep.slice(0, n - 1), mergedTail]
}

const blockLabel = (t: CaptureBlockType) =>
  t === 'form'
    ? 'Lead form'
    : t === 'row'
      ? 'Columns'
      : (BLOCK_DEFS.find((d) => d.type === t)?.label ?? t)

// --- small controls --------------------------------------------------------

function AlignToggle({ value, onChange }: { value?: BlockAlign; onChange: (a: BlockAlign) => void }) {
  const opts: { a: BlockAlign; icon: React.ComponentType<{ className?: string }> }[] = [
    { a: 'left', icon: AlignLeft },
    { a: 'center', icon: AlignCenter },
    { a: 'right', icon: AlignRight },
  ]
  const current = value || 'center'
  return (
    <div className="inline-flex rounded-lg border border-[var(--border-primary)] p-0.5">
      {opts.map(({ a, icon: Icon }) => (
        <button
          key={a}
          type="button"
          onClick={() => onChange(a)}
          className={`p-1.5 rounded-md ${current === a ? 'bg-[#2B79F7] text-white' : 'text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)]'}`}
          title={a}
        >
          <Icon className="h-3.5 w-3.5" />
        </button>
      ))}
    </div>
  )
}

// Segmented tap picker (e.g. text size S / M / L / XL). Same control style as
// the row column-count and align toggles.
function SegPicker<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { v: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="inline-flex rounded-lg border border-[var(--border-primary)] p-0.5">
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(o.v)}
          className={`px-2.5 py-1 text-xs rounded-md ${value === o.v ? 'bg-[#2B79F7] text-white' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

const SIZE_OPTS_HEADING: { v: NonNullable<CaptureBlock['size']>; label: string }[] = [
  { v: 'sm', label: 'S' },
  { v: 'md', label: 'M' },
  { v: 'lg', label: 'L' },
  { v: 'xl', label: 'XL' },
]
const SIZE_OPTS_TEXT: { v: NonNullable<CaptureBlock['size']>; label: string }[] = [
  { v: 'sm', label: 'S' },
  { v: 'md', label: 'M' },
  { v: 'lg', label: 'L' },
]
// Compact ratio labels so the picker never overflows a narrow column.
const ASPECT_OPTS: { v: '16/9' | '9/16' | '1/1'; label: string }[] = [
  { v: '16/9', label: '16:9' },
  { v: '9/16', label: '9:16' },
  { v: '1/1', label: '1:1' },
]
// Font dropdown reusing the agreements editor's curated Google-font list.
function FontSelect({ value, onChange }: { value?: string; onChange: (v: string) => void }) {
  return (
    <select
      className={INPUT + ' max-w-[11rem]'}
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      style={value ? { fontFamily: value } : undefined}
    >
      {DOC_FONTS.map((f) => (
        <option key={f.label} value={f.value} style={f.value ? { fontFamily: f.value } : undefined}>
          {f.label}
        </option>
      ))}
    </select>
  )
}

function UploadButton({
  folder,
  onUrl,
  accept = 'image/*',
  label = 'Upload',
}: {
  folder: string
  onUrl: (url: string) => void
  accept?: string
  label?: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const handle = async (file: File | null) => {
    if (!file) return
    setErr(null)
    setBusy(true)
    try {
      // Direct-to-storage upload so large videos aren't capped by the
      // serverless body limit.
      const url = await uploadFileDirect(file, folder)
      onUrl(url)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <input ref={ref} type="file" accept={accept} className="hidden" onChange={(e) => handle(e.target.files?.[0] ?? null)} />
      <button
        type="button"
        onClick={() => ref.current?.click()}
        disabled={busy}
        title={err || undefined}
        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[var(--border-primary)] text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-50 shrink-0"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
        {label}
      </button>
    </>
  )
}

function ImageField({ value, onChange, folder }: { value: string; onChange: (v: string) => void; folder: string }) {
  return (
    <div className="flex gap-2">
      <input className={INPUT} value={value} onChange={(e) => onChange(e.target.value)} placeholder="Image URL or upload" />
      <UploadButton folder={folder} onUrl={onChange} />
    </div>
  )
}

// --- per-block editor ------------------------------------------------------

function BlockEditor({ block, onChange }: { block: CaptureBlock; onChange: (patch: Partial<CaptureBlock>) => void }) {
  const b = block
  switch (b.type) {
    case 'heading':
      return (
        <div className="space-y-2">
          <textarea className={INPUT} rows={2} value={b.content || ''} onChange={(e) => onChange({ content: e.target.value })} placeholder="Heading text" />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="text-xs text-[var(--text-tertiary)]">Size</span>
            <SegPicker value={b.size || 'lg'} options={SIZE_OPTS_HEADING} onChange={(v) => onChange({ size: v })} />
            <span className="text-xs text-[var(--text-tertiary)]">Font</span>
            <FontSelect value={b.font} onChange={(v) => onChange({ font: v || undefined })} />
            <AlignToggle value={b.align} onChange={(a) => onChange({ align: a })} />
          </div>
        </div>
      )
    case 'text':
      return (
        <div className="space-y-2">
          <textarea className={INPUT} rows={3} value={b.content || ''} onChange={(e) => onChange({ content: e.target.value })} placeholder="Paragraph text" />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="text-xs text-[var(--text-tertiary)]">Size</span>
            <SegPicker value={b.size || 'md'} options={SIZE_OPTS_TEXT} onChange={(v) => onChange({ size: v })} />
            <span className="text-xs text-[var(--text-tertiary)]">Font</span>
            <FontSelect value={b.font} onChange={(v) => onChange({ font: v || undefined })} />
            <AlignToggle value={b.align} onChange={(a) => onChange({ align: a })} />
          </div>
        </div>
      )
    case 'button':
      return (
        <div className="space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input className={INPUT} value={b.label || ''} onChange={(e) => onChange({ label: e.target.value })} placeholder="Button label" />
            <input className={INPUT} value={b.url || ''} onChange={(e) => onChange({ url: e.target.value })} placeholder="https://link" />
          </div>
          <div className="flex items-center gap-2">
            <select className={INPUT + ' max-w-[8rem]'} value={b.variant || 'solid'} onChange={(e) => onChange({ variant: e.target.value as CaptureBlock['variant'] })}>
              <option value="solid">Solid</option>
              <option value="outline">Outline</option>
            </select>
            <AlignToggle value={b.align} onChange={(a) => onChange({ align: a })} />
          </div>
        </div>
      )
    case 'image':
      return (
        <div className="space-y-2">
          <ImageField value={b.url || ''} onChange={(v) => onChange({ url: v })} folder="capture-pages/blocks" />
          <div className="flex items-center gap-2">
            <input className={INPUT + ' max-w-[10rem]'} type="number" value={b.maxWidth || 640} onChange={(e) => onChange({ maxWidth: Number(e.target.value) || 640 })} placeholder="Max width px" />
            <AlignToggle value={b.align} onChange={(a) => onChange({ align: a })} />
          </div>
        </div>
      )
    case 'gallery': {
      const imgs = b.gallery || []
      const setImg = (i: number, url: string) => onChange({ gallery: imgs.map((g, j) => (j === i ? { url } : g)) })
      return (
        <div className="space-y-2">
          <p className="text-xs text-[var(--text-tertiary)]">Up to 5 images side by side, shown at their real shape.</p>
          {imgs.map((g, i) => (
            <div key={i} className="flex gap-2">
              <input className={INPUT} value={g.url} onChange={(e) => setImg(i, e.target.value)} placeholder="Image URL" />
              <UploadButton folder="capture-pages/gallery" onUrl={(url) => setImg(i, url)} />
              <button type="button" onClick={() => onChange({ gallery: imgs.filter((_, j) => j !== i) })} className="p-2 rounded-md text-[var(--text-tertiary)] hover:text-red-500 shrink-0">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          {imgs.length < 5 && (
            <button type="button" onClick={() => onChange({ gallery: [...imgs, { url: '' }] })} className="inline-flex items-center gap-1 text-sm font-medium text-[#2B79F7] hover:opacity-80">
              <Plus className="h-4 w-4" /> Add image
            </button>
          )}
        </div>
      )
    }
    case 'embed':
      return (
        <div className="space-y-2">
          <input className={INPUT} value={b.url || ''} onChange={(e) => onChange({ url: e.target.value })} placeholder="YouTube, Loom, Vimeo, Drive, or image URL" />
          <input className={INPUT} value={b.title || ''} onChange={(e) => onChange({ title: e.target.value })} placeholder="Caption (optional)" />
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-[var(--text-tertiary)]">Shape</span>
            <SegPicker value={b.embedAspect || '16/9'} options={ASPECT_OPTS} onChange={(v) => onChange({ embedAspect: v })} />
          </div>
        </div>
      )
    case 'card':
      return (
        <div className="space-y-2">
          <input className={INPUT} value={b.heading || ''} onChange={(e) => onChange({ heading: e.target.value })} placeholder="Card heading" />
          <textarea className={INPUT} rows={2} value={b.text || ''} onChange={(e) => onChange({ text: e.target.value })} placeholder="Card text" />
          <ImageField value={b.imageUrl || ''} onChange={(v) => onChange({ imageUrl: v })} folder="capture-pages/blocks" />
          {b.imageUrl && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--text-tertiary)]">Image</span>
              <SegPicker
                value={b.imageMode || 'natural'}
                options={[{ v: 'natural', label: 'Actual size' }, { v: 'banner', label: 'Banner' }] as { v: NonNullable<CaptureBlock['imageMode']>; label: string }[]}
                onChange={(v) => onChange({ imageMode: v })}
              />
            </div>
          )}

          {/* Extra images (up to 5) and embeds (up to 2) inside the card. */}
          {(() => {
            const imgs = b.gallery || []
            const setImg = (i: number, url: string) => onChange({ gallery: imgs.map((g, j) => (j === i ? { url } : g)) })
            return (
              <div className="space-y-1.5">
                <span className="text-xs text-[var(--text-tertiary)]">Images (up to 5)</span>
                {imgs.map((g, i) => (
                  <div key={i} className="flex gap-2">
                    <input className={INPUT} value={g.url} onChange={(e) => setImg(i, e.target.value)} placeholder="Image URL" />
                    <UploadButton folder="capture-pages/blocks" onUrl={(url) => setImg(i, url)} />
                    <button type="button" onClick={() => onChange({ gallery: imgs.filter((_, j) => j !== i) })} className="p-2 rounded-md text-[var(--text-tertiary)] hover:text-red-500 shrink-0">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                {imgs.length < 5 && (
                  <button type="button" onClick={() => onChange({ gallery: [...imgs, { url: '' }] })} className="inline-flex items-center gap-1 text-xs font-medium text-[#2B79F7] hover:opacity-80">
                    <Plus className="h-3.5 w-3.5" /> Add image
                  </button>
                )}
              </div>
            )
          })()}
          {(() => {
            const eds = b.embeds || []
            const setEd = (i: number, p: Partial<{ url: string; title?: string; aspect?: '16/9' | '9/16' | '1/1' }>) =>
              onChange({ embeds: eds.map((e, j) => (j === i ? { ...e, ...p } : e)) })
            return (
              <div className="space-y-1.5">
                <span className="text-xs text-[var(--text-tertiary)]">Videos / embeds (up to 2)</span>
                {eds.map((e, i) => (
                  <div key={i} className="space-y-1.5 rounded-lg border border-[var(--border-primary)] p-2">
                    <div className="flex gap-2">
                      <input className={INPUT} value={e.url} onChange={(ev) => setEd(i, { url: ev.target.value })} placeholder="Paste a YouTube / Loom / Vimeo link" />
                      <button type="button" onClick={() => onChange({ embeds: eds.filter((_, j) => j !== i) })} className="p-2 rounded-md text-[var(--text-tertiary)] hover:text-red-500 shrink-0">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-[var(--text-tertiary)]">Shape</span>
                      <SegPicker value={e.aspect || '16/9'} options={ASPECT_OPTS} onChange={(v) => setEd(i, { aspect: v })} />
                    </div>
                  </div>
                ))}
                {eds.length < 2 && (
                  <button type="button" onClick={() => onChange({ embeds: [...eds, { url: '' }] })} className="inline-flex items-center gap-1 text-xs font-medium text-[#2B79F7] hover:opacity-80">
                    <Plus className="h-3.5 w-3.5" /> Add embed
                  </button>
                )}
              </div>
            )
          })()}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input className={INPUT} value={b.buttonLabel || ''} onChange={(e) => onChange({ buttonLabel: e.target.value })} placeholder="Button label (optional)" />
            <input className={INPUT} value={b.buttonUrl || ''} onChange={(e) => onChange({ buttonUrl: e.target.value })} placeholder="https://link" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select className={INPUT + ' max-w-[9rem]'} value={b.cardVariant || 'soft'} onChange={(e) => onChange({ cardVariant: e.target.value as CaptureBlock['cardVariant'] })}>
              <option value="soft">Soft</option>
              <option value="bordered">Bordered</option>
              <option value="elevated">Elevated</option>
            </select>
            <span className="text-xs text-[var(--text-tertiary)]">Font</span>
            <FontSelect value={b.font} onChange={(v) => onChange({ font: v || undefined })} />
            <AlignToggle value={b.align} onChange={(a) => onChange({ align: a })} />
          </div>
        </div>
      )
    case 'logos':
      return (
        <div className="space-y-2">
          <input className={INPUT} value={b.caption || ''} onChange={(e) => onChange({ caption: e.target.value })} placeholder="Caption (e.g. Trusted by)" />
          <div className="space-y-2">
            {(b.logos || []).map((l, i) => (
              <div key={i} className="flex gap-2">
                <input
                  className={INPUT}
                  value={l.url}
                  onChange={(e) => {
                    const next = [...(b.logos || [])]
                    next[i] = { url: e.target.value }
                    onChange({ logos: next })
                  }}
                  placeholder="Logo image URL"
                />
                <UploadButton
                  folder="capture-pages/logos"
                  onUrl={(url) => {
                    const next = [...(b.logos || [])]
                    next[i] = { url }
                    onChange({ logos: next })
                  }}
                />
                <button
                  type="button"
                  onClick={() => onChange({ logos: (b.logos || []).filter((_, j) => j !== i) })}
                  className="p-2 rounded-md text-[var(--text-tertiary)] hover:text-red-500 shrink-0"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          {(b.logos || []).length < 10 && (
            <button
              type="button"
              onClick={() => onChange({ logos: [...(b.logos || []), { url: '' }] })}
              className="inline-flex items-center gap-1 text-sm font-medium text-[#2B79F7] hover:opacity-80"
            >
              <Plus className="h-4 w-4" /> Add logo
            </button>
          )}
        </div>
      )
    case 'testimonials': {
      const items = b.testimonials || []
      const setItem = (i: number, p: Partial<TestimonialItem>) =>
        onChange({ testimonials: items.map((t, j) => (j === i ? { ...t, ...p } : t)) })
      return (
        <div className="space-y-2">
          <p className="text-xs text-[var(--text-tertiary)]">Auto-slides across the page and pauses on hover.</p>
          {items.map((t, i) => (
            <div key={i} className="rounded-lg border border-[var(--border-primary)] p-2 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
                  {t.imageUrl ? `Image ${i + 1}` : `Quote ${i + 1}`}
                </span>
                <button type="button" onClick={() => onChange({ testimonials: items.filter((_, j) => j !== i) })} className="p-1 rounded-md text-[var(--text-tertiary)] hover:text-red-500">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              {t.imageUrl ? (
                <div className="space-y-2">
                  <p className="text-[11px] text-[var(--text-tertiary)]">Showing an uploaded image for this card.</p>
                  <ImageField value={t.imageUrl} onChange={(v) => setItem(i, { imageUrl: v })} folder="capture-pages/testimonials" />
                  <button type="button" onClick={() => setItem(i, { imageUrl: undefined })} className="text-xs text-[var(--text-tertiary)] hover:underline">
                    Use quote + profile instead
                  </button>
                </div>
              ) : (
                <>
                  <textarea className={INPUT} rows={2} value={t.quote} onChange={(e) => setItem(i, { quote: e.target.value })} placeholder="What they said" />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input className={INPUT} value={t.name} onChange={(e) => setItem(i, { name: e.target.value })} placeholder="Name" />
                    <input className={INPUT} value={t.subtitle || ''} onChange={(e) => setItem(i, { subtitle: e.target.value })} placeholder="Role / company (optional)" />
                  </div>
                  <ImageField value={t.avatarUrl || ''} onChange={(v) => setItem(i, { avatarUrl: v })} folder="capture-pages/avatars" />
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-[var(--text-tertiary)]">Or use an image as the whole card</span>
                    <UploadButton folder="capture-pages/testimonials" onUrl={(url) => setItem(i, { imageUrl: url })} />
                  </div>
                </>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() => onChange({ testimonials: [...items, { quote: '', name: '' }] })}
            className="inline-flex items-center gap-1 text-sm font-medium text-[#2B79F7] hover:opacity-80"
          >
            <Plus className="h-4 w-4" /> Add testimonial
          </button>
        </div>
      )
    }
    case 'spacer':
      return (
        <select className={INPUT + ' max-w-[10rem]'} value={b.space || 'md'} onChange={(e) => onChange({ space: e.target.value as CaptureBlock['space'] })}>
          <option value="sm">Small gap</option>
          <option value="md">Medium gap</option>
          <option value="lg">Large gap</option>
        </select>
      )
    case 'divider':
      return <p className="text-xs text-[var(--text-tertiary)]">A horizontal divider line.</p>
    case 'form':
      return <p className="text-xs text-[var(--text-tertiary)]">Your lead form (fields, meeting, submit) renders here. Edit fields in the Fields section.</p>
    default:
      return null
  }
}

// --- shared bits -----------------------------------------------------------

const iconBtn =
  'inline-flex items-center justify-center h-7 w-7 rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'

// Where a dragged element should land.
type DropTarget =
  | { top: true; beforeId: string | null }
  | { top: false; rowId: string; colId: string; beforeId: string | null }

function removeById(blocks: CaptureBlock[], id: string): { next: CaptureBlock[]; removed: CaptureBlock | null } {
  let removed: CaptureBlock | null = null
  const next: CaptureBlock[] = []
  for (const b of blocks) {
    if (b.id === id) {
      removed = b
      continue
    }
    if (b.type === 'row' && b.columns) {
      const columns = b.columns.map((c) => {
        const r = removeById(c.blocks || [], id)
        if (r.removed) removed = r.removed
        return { ...c, blocks: r.next }
      })
      next.push({ ...b, columns })
    } else {
      next.push(b)
    }
  }
  return { next, removed }
}

function insertInto(blocks: CaptureBlock[], target: DropTarget, block: CaptureBlock): CaptureBlock[] {
  if (target.top) {
    if (target.beforeId === null) return [...blocks, block]
    const i = blocks.findIndex((b) => b.id === target.beforeId)
    if (i === -1) return [...blocks, block]
    const copy = [...blocks]
    copy.splice(i, 0, block)
    return copy
  }
  return blocks.map((b) => {
    if (b.id !== target.rowId || !b.columns) return b
    return {
      ...b,
      columns: b.columns.map((c) => {
        if (c.id !== target.colId) return c
        const list = c.blocks || []
        if (target.beforeId === null) return { ...c, blocks: [...list, block] }
        const i = list.findIndex((x) => x.id === target.beforeId)
        if (i === -1) return { ...c, blocks: [...list, block] }
        const copy = [...list]
        copy.splice(i, 0, block)
        return { ...c, blocks: copy }
      }),
    }
  })
}

// A thin drop target between elements. Invisible until a drag is active; shows
// a blue snap line where the element will land.
function DropZone({ active, onDrop }: { active: boolean; onDrop: () => void }) {
  const [over, setOver] = useState(false)
  return (
    <div
      onDragOver={(e) => {
        if (!active) return
        e.preventDefault()
        e.stopPropagation()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!active) return
        e.preventDefault()
        e.stopPropagation()
        setOver(false)
        onDrop()
      }}
      className={`flex items-center transition-all ${active ? 'h-3' : 'h-1'} ${over ? 'h-7' : ''}`}
    >
      <div className={`w-full rounded-full transition-all ${over ? 'h-1 bg-[#2B79F7]' : 'h-0'}`} />
    </div>
  )
}

// Add-element toolbar: icon buttons with hover tooltips (minimalistic).
function AddBar({
  canAddForm,
  includeColumns,
  onAdd,
  onAddRow,
}: {
  canAddForm: boolean
  includeColumns?: boolean
  onAdd: (t: CaptureBlockType) => void
  onAddRow?: (n: number) => void
}) {
  const items = [
    ...BLOCK_DEFS.map((d) => ({ label: d.label, Icon: d.icon, onClick: () => onAdd(d.type) })),
    ...(canAddForm ? [{ label: 'Lead form', Icon: FormInput, onClick: () => onAdd('form') }] : []),
  ]
  const btn = 'inline-flex items-center justify-center h-8 w-8 rounded-lg border border-dashed border-[var(--border-primary)] text-[var(--text-tertiary)] hover:border-[#2B79F7] hover:text-[#2B79F7]'
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {items.map((it, i) => {
        const Icon = it.Icon
        return (
          <Tooltip key={i} content={it.label}>
            <button type="button" onClick={it.onClick} className={btn}>
              <Icon className="h-4 w-4" />
            </button>
          </Tooltip>
        )
      })}
      {includeColumns && onAddRow && (
        <>
          <span className="mx-0.5 h-5 w-px bg-[var(--border-primary)]" />
          <Tooltip content="2 columns">
            <button type="button" onClick={() => onAddRow(2)} className={btn}>
              <Columns2 className="h-4 w-4" />
            </button>
          </Tooltip>
          <Tooltip content="3 columns">
            <button type="button" onClick={() => onAddRow(3)} className={btn}>
              <Columns3 className="h-4 w-4" />
            </button>
          </Tooltip>
        </>
      )}
    </div>
  )
}

// A draggable element card. The whole header is the drag handle and the ghost
// is the whole card. Defined at module scope so it never remounts mid-edit.
function BlockCard({
  block,
  open,
  dragging,
  subtitle,
  onToggle,
  onDelete,
  onDragStartId,
  onDragEnd,
  children,
}: {
  block: CaptureBlock
  open: boolean
  dragging: boolean
  subtitle?: string
  onToggle: () => void
  onDelete: () => void
  onDragStartId: (id: string) => void
  onDragEnd: () => void
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  return (
    <div ref={ref} className={`rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] ${dragging ? 'opacity-40' : ''}`}>
      <div
        draggable
        onDragStart={(e) => {
          onDragStartId(block.id)
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', block.id)
          if (ref.current) e.dataTransfer.setDragImage(ref.current, 16, 16)
        }}
        onDragEnd={onDragEnd}
        className="flex items-center gap-2 px-2 py-2 cursor-grab active:cursor-grabbing"
      >
        <GripVertical className="h-4 w-4 text-[var(--text-tertiary)] shrink-0" />
        <button type="button" onClick={onToggle} className="flex-1 text-left text-sm font-medium text-[var(--text-primary)] truncate">
          {blockLabel(block.type)}
          {subtitle ? <span className="ml-2 font-normal text-[var(--text-tertiary)]">{subtitle}</span> : null}
        </button>
        <Tooltip content="Delete">
          <button type="button" onClick={onDelete} draggable={false} onDragStart={(e) => e.preventDefault()} className={iconBtn}>
            <Trash2 className="h-4 w-4" />
          </button>
        </Tooltip>
      </div>
      {open && <div className="px-3 pb-3 pt-1 border-t border-[var(--border-primary)]">{children}</div>}
    </div>
  )
}

// --- main builder ----------------------------------------------------------

interface Props {
  blocks: CaptureBlock[]
  onChange: (blocks: CaptureBlock[]) => void
}

export function CaptureBlocksEditor({ blocks, onChange }: Props) {
  const [dragId, setDragId] = useState<string | null>(null)
  // A SET of expanded ids (not a single id) so a row stays open while one of
  // its column children is also open - otherwise opening/adding a child would
  // collapse the row it lives in.
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set())
  const isOpen = (id: string) => openIds.has(id)
  const toggle = (id: string) =>
    setOpenIds((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const openBlock = (id: string) => setOpenIds((cur) => new Set(cur).add(id))

  const canAddForm = countForms(blocks) === 0

  const patch = (id: string, p: Partial<CaptureBlock>) => onChange(blocks.map((b) => (b.id === id ? { ...b, ...p } : b)))
  const remove = (id: string) => onChange(blocks.filter((b) => b.id !== id))

  const insertTopLevel = (block: CaptureBlock) => {
    const formIdx = blocks.findIndex((b) => b.type === 'form')
    if (formIdx === -1) onChange([...blocks, block])
    else {
      const copy = [...blocks]
      copy.splice(formIdx, 0, block)
      onChange(copy)
    }
    openBlock(block.id)
  }
  const add = (type: CaptureBlockType) => insertTopLevel(type === 'form' ? ({ id: uid(), type: 'form' } as CaptureBlock) : makeBlock(type))
  const addRow = (n: number) => insertTopLevel(makeRow(n))

  const addToColumn = (rowId: string, colId: string, type: CaptureBlockType) => {
    const blk = type === 'form' ? ({ id: uid(), type: 'form' } as CaptureBlock) : makeBlock(type)
    onChange(insertInto(blocks, { top: false, rowId, colId, beforeId: null }, blk))
    openBlock(blk.id)
  }

  const patchColumn = (rowId: string, colId: string, fn: (col: CaptureColumn) => CaptureColumn) =>
    onChange(blocks.map((b) => (b.id === rowId && b.columns ? { ...b, columns: b.columns.map((c) => (c.id === colId ? fn(c) : c)) } : b)))

  const moveTo = (target: DropTarget) => {
    if (!dragId) return
    if (target.beforeId === dragId) return
    const { next, removed } = removeById(blocks, dragId)
    if (!removed) return
    if (removed.type === 'row' && !target.top) return // no nested rows
    onChange(insertInto(next, target, removed))
    setDragId(null)
  }

  const renderRowBody = (b: CaptureBlock) => {
    const n = Math.min(3, Math.max(1, (b.columns || []).length || 2))
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-[var(--text-tertiary)]">Columns</span>
            <div className="inline-flex rounded-lg border border-[var(--border-primary)] p-0.5">
              {[1, 2, 3].map((c) => (
                <button key={c} type="button" onClick={() => patch(b.id, { columns: withColumnCount(b, c) })} className={`px-2.5 py-1 text-xs rounded-md ${n === c ? 'bg-[#2B79F7] text-white' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'}`}>
                  {c}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-[var(--text-tertiary)]">Background</span>
            <input
              type="color"
              value={b.bgColor || '#ffffff'}
              onChange={(e) => patch(b.id, { bgColor: e.target.value })}
              title="Section background"
              className="h-7 w-9 cursor-pointer rounded-md border border-[var(--border-primary)] bg-transparent p-0"
            />
            {b.bgColor && (
              <button type="button" onClick={() => patch(b.id, { bgColor: undefined })} className="text-xs text-[var(--text-tertiary)] hover:underline">
                clear
              </button>
            )}
          </div>
          <Tooltip content="Divider between columns">
            <button type="button" onClick={() => patch(b.id, { vDividers: !b.vDividers })} className={`${iconBtn} ${b.vDividers ? 'text-[#2B79F7] bg-[#2B79F7]/10' : ''}`}>
              <SeparatorVertical className="h-4 w-4" />
            </button>
          </Tooltip>
          <div className="inline-flex rounded-lg border border-[var(--border-primary)] p-0.5">
            {(['top', 'center'] as const).map((v) => (
              <Tooltip key={v} content={`Align ${v}`}>
                <button type="button" onClick={() => patch(b.id, { vAlign: v })} className={`px-2.5 py-1 text-xs rounded-md capitalize ${(b.vAlign || 'top') === v ? 'bg-[#2B79F7] text-white' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'}`}>
                  {v}
                </button>
              </Tooltip>
            ))}
          </div>
        </div>
        <div className={`grid ${gridColsEditor(n)} items-start gap-2`}>
          {(b.columns || []).map((col, ci) => (
            <div key={col.id} className="rounded-lg border border-dashed border-[var(--border-primary)] p-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)] mb-1">Column {ci + 1}</p>
              {(col.blocks || []).map((cb) => (
                <div key={cb.id}>
                  <DropZone active={!!dragId} onDrop={() => moveTo({ top: false, rowId: b.id, colId: col.id, beforeId: cb.id })} />
                  <BlockCard
                    block={cb}
                    open={isOpen(cb.id)}
                    dragging={dragId === cb.id}
                    onToggle={() => toggle(cb.id)}
                    onDelete={() => patchColumn(b.id, col.id, (c) => ({ ...c, blocks: (c.blocks || []).filter((x) => x.id !== cb.id) }))}
                    onDragStartId={setDragId}
                    onDragEnd={() => setDragId(null)}
                  >
                    <BlockEditor block={cb} onChange={(p) => patchColumn(b.id, col.id, (c) => ({ ...c, blocks: (c.blocks || []).map((x) => (x.id === cb.id ? { ...x, ...p } : x)) }))} />
                  </BlockCard>
                </div>
              ))}
              <DropZone active={!!dragId} onDrop={() => moveTo({ top: false, rowId: b.id, colId: col.id, beforeId: null })} />
              {(col.blocks || []).length === 0 && !dragId && <p className="text-xs text-[var(--text-tertiary)] px-1 pb-1">Empty</p>}
              <div className="mt-1">
                <AddBar canAddForm={canAddForm} onAdd={(t) => addToColumn(b.id, col.id, t)} />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* Load the font list so the per-block font dropdown previews render. */}
      <link rel="stylesheet" href={DOC_FONTS_URL} />
      {blocks.map((b) => {
        const isRow = b.type === 'row'
        const n = isRow ? Math.min(3, Math.max(1, (b.columns || []).length || 2)) : 0
        const subtitle = isRow
          ? `${n} cols`
          : b.type === 'heading' && b.content && !isOpen(b.id)
            ? b.content.slice(0, 32)
            : undefined
        return (
          <div key={b.id}>
            <DropZone active={!!dragId} onDrop={() => moveTo({ top: true, beforeId: b.id })} />
            <BlockCard
              block={b}
              open={isOpen(b.id)}
              dragging={dragId === b.id}
              subtitle={subtitle}
              onToggle={() => toggle(b.id)}
              onDelete={() => remove(b.id)}
              onDragStartId={setDragId}
              onDragEnd={() => setDragId(null)}
            >
              {isRow ? renderRowBody(b) : <BlockEditor block={b} onChange={(p) => patch(b.id, p)} />}
            </BlockCard>
          </div>
        )
      })}
      <DropZone active={!!dragId} onDrop={() => moveTo({ top: true, beforeId: null })} />

      {countForms(blocks) === 0 && (
        <p className="flex items-center gap-1.5 text-xs text-amber-500 mt-1 mb-2">
          <AlertTriangle className="h-3.5 w-3.5" /> No lead form on the page. Add the form so visitors can submit.
        </p>
      )}

      <div className="mt-1">
        <AddBar canAddForm={canAddForm} includeColumns onAdd={add} onAddRow={addRow} />
      </div>
    </div>
  )
}


/** Seed sensible default blocks for a brand-new landing page from the page's
 *  headline + description, with the lead form last. */
export function defaultLandingBlocks(headline: string, description: string): CaptureBlock[] {
  const out: CaptureBlock[] = [
    { id: uid(), type: 'heading', content: headline || 'Get your free resource', size: 'lg', align: 'center' },
  ]
  if (description) out.push({ id: uid(), type: 'text', content: description, align: 'center' })
  out.push({ id: uid(), type: 'form' })
  return out
}
