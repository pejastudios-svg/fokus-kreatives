'use client'

// Agreements: write contracts on a doc-style editor with placeholder
// chips, save them as templates, fill them from a lead and send to one
// or more signers, each with their own e-signature link.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'
import { Card, CardContent } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Loading'
import { KebabMenu } from '@/components/ui/KebabMenu'
import { ConfirmModal, type ConfirmModalProps } from '@/components/ui/ConfirmModal'
import { Toggle } from '@/components/ui/Toggle'
import { toast } from '@/components/ui/Toast'
import { useCrmRole } from '@/components/crm/CrmRoleContext'
import { EmailAvatarsInput } from '@/components/agreements/EmailAvatarsInput'
import { RichTextEditor, type PlaceholderDef } from '@/components/agreements/RichTextEditor'
import { AGREEMENT_DOC_CSS, DOC_FONTS_URL } from '@/components/agreements/docStyles'
import { fillAgreementHtml } from '@/lib/agreements/fill'
import {
  saveDraftSnapshot,
  loadDraftSnapshot,
  clearDraftSnapshot,
} from '@/lib/draftSnapshot'
import {
  Plus,
  ArrowLeft,
  Copy,
  ExternalLink,
  PenLine,
  LayoutGrid,
  List as ListIcon,
  Search,
  PanelLeftClose,
  PanelLeftOpen,
  ChevronDown,
} from 'lucide-react'
import type { KebabMenuItem } from '@/components/ui/KebabMenu'

interface Template {
  id: string
  name: string
  body_html: string
  created_at: string
  updated_at: string
}

interface Signer {
  id: string
  email: string
  name: string | null
  signed_at: string | null
  signer_name: string | null
}

interface Agreement {
  id: string
  title: string
  status: 'draft' | 'sent' | 'signed'
  public_token: string
  lead_id: string | null
  template_id: string | null
  recipient_name: string | null
  recipient_email: string | null
  signed_at: string | null
  sent_at: string | null
  viewed_at: string | null
  created_at: string
  body_html: string
  cc_emails: string[]
  invoice_config: {
    lineItems: { description: string; quantity: number; unit_price: number }[]
    currency: string
    dueDays: number
    paymentLink?: string | null
  } | null
  payment_id: string | null
  payment: { id: string; status: string; public_token: string } | null
  signers: Signer[]
}

interface Lead {
  id: string
  data: Record<string, unknown>
}

interface CustomFieldRow {
  field_key: string
  field_name: string
  field_type: string
  options: { value: string; label: string }[] | null
  position: number
}

interface Automation {
  id: string
  template_id: string
  trigger_status: string
  enabled: boolean
}

type View =
  | { kind: 'list' }
  | { kind: 'template'; template: Template | null }
  | { kind: 'compose'; draft: Agreement | null; templateId: string | null }

type ConfirmState = Omit<ConfirmModalProps, 'open' | 'onClose'> | null

/** Working editor state persisted to localStorage so a refresh, crash or
 *  dropped connection never loses what was typed. */
interface EditorSnapshot {
  kind: 'compose' | 'template'
  draftId: string | null
  templateId: string | null
  tplId: string | null
  composeTitle: string
  composeBody: string
  composeLeadId: string
  signerEmails: string[]
  ccEmails: string[]
  invoiceOn: boolean
  invoiceItems: { description: string; quantity: string; unit_price: string }[]
  invoiceCurrency: string
  invoiceDueDays: string
  invoicePaymentLink: string
  tplName: string
  tplBody: string
}

type SyncState = 'idle' | 'saving' | 'saved' | 'offline'

const BLANK_BODY = '<h1>Agreement</h1><p>Write your agreement here...</p>'

function fmtDate(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function statusPill(a: Agreement) {
  const signedCount = a.signers.filter((s) => s.signed_at).length
  const total = a.signers.length
  const cfg =
    a.status === 'signed' && a.payment?.status === 'paid'
      ? { label: 'Signed · Paid', cls: 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400' }
      : a.status === 'signed'
      ? { label: 'Signed', cls: 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400' }
      : a.status === 'sent' && signedCount > 0
        ? { label: `${signedCount}/${total} signed`, cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400' }
        : a.status === 'sent' && a.viewed_at
          ? { label: 'Viewed', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400' }
          : a.status === 'sent'
            ? { label: 'Sent', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400' }
            : { label: 'Draft', cls: 'bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-400' }
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${cfg.cls}`}>
      {cfg.label}
    </span>
  )
}

/** Grid/list switcher with a horizontal slide between the two layouts.
 *  The sliding rig (and its transform) exists ONLY during the animation:
 *  a persistent transform would create a stacking context that traps the
 *  cards' dropdown menus under the sticky section banners, and would also
 *  break position:sticky for anything inside. */
function SlidingViews({
  mode,
  grid,
  list,
}: {
  mode: 'grid' | 'list'
  grid: ReactNode
  list: ReactNode
}) {
  // `settled` trails `mode` by one slide duration; `pos` flips a frame
  // after the rig mounts so the transition has a start and an end value.
  const [settled, setSettled] = useState(mode)
  const [pos, setPos] = useState(mode)
  const animating = settled !== mode
  useEffect(() => {
    if (settled === mode) return
    const raf = requestAnimationFrame(() => setPos(mode))
    const t = setTimeout(() => setSettled(mode), 340)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(t)
    }
  }, [mode, settled])

  if (!animating) {
    return <div>{mode === 'grid' ? grid : list}</div>
  }
  return (
    <div className="overflow-hidden">
      <div
        className="flex w-[200%] items-start transition-transform duration-300 ease-out"
        style={{ transform: pos === 'grid' ? 'translateX(0%)' : 'translateX(-50%)' }}
      >
        <div className="w-1/2">{grid}</div>
        <div className="w-1/2">{list}</div>
      </div>
    </div>
  )
}

/** Drive-style document card: a miniature render of the actual content,
 *  status tag floating on the preview, details + menu in the footer. */
function DocCard({
  bodyHtml,
  title,
  subtitle,
  tag,
  menu,
  onOpen,
  footerExtra,
}: {
  bodyHtml: string
  title: string
  subtitle: string
  tag?: ReactNode
  menu: KebabMenuItem[]
  onOpen: () => void
  footerExtra?: ReactNode
}) {
  return (
    // No overflow-hidden on the card itself: it would clip the dropdown
    // menu. The preview area clips its own content instead.
    <div className="flex flex-col rounded-2xl border border-slate-300 dark:border-[var(--border-primary)] bg-[var(--bg-secondary)] hover:border-[#2B79F7]/50 dark:hover:border-[#2B79F7]/50 transition-colors">
      <button
        type="button"
        onClick={onOpen}
        className="relative h-52 overflow-hidden rounded-t-2xl bg-white text-left cursor-pointer"
      >
        <div
          className="agreement-doc origin-top-left scale-[0.4] w-[250%] px-10 py-8 pointer-events-none select-none"
          dangerouslySetInnerHTML={{ __html: bodyHtml }}
        />
        {tag && <div className="absolute top-2 right-2">{tag}</div>}
      </button>
      <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-t border-slate-300 dark:border-[var(--border-primary)]">
        <button type="button" onClick={onOpen} className="min-w-0 text-left cursor-pointer">
          <p className="font-medium text-sm text-[var(--text-primary)] truncate">{title}</p>
          <p className="text-[11px] text-[var(--text-tertiary)] truncate mt-0.5">{subtitle}</p>
        </button>
        <div className="flex items-center gap-1 shrink-0">
          {footerExtra}
          <KebabMenu items={menu} />
        </div>
      </div>
    </div>
  )
}

/** The "new document" tile that takes the first spot in each grid. */
function CreateTile({ onClick, label = 'Create' }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center justify-center gap-3 min-h-[265px] rounded-2xl border border-dashed border-slate-400 dark:border-[var(--border-primary)] bg-[var(--bg-secondary)] hover:border-[#2B79F7] hover:bg-[#2B79F7]/5 transition-colors"
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#2B79F7]/10">
        <Plus className="h-6 w-6 text-[#2B79F7]" />
      </span>
      <span className="text-xs font-semibold text-[var(--text-secondary)]">{label}</span>
    </button>
  )
}

/** Searchable lead picker for the compose sidebar. The panel renders in
 *  flow (it pushes the sidebar taller) so the sidebar's scroll container
 *  can't clip it. */
function LeadPicker({
  leads,
  value,
  onChange,
  labelFor,
}: {
  leads: Lead[]
  value: string
  onChange: (id: string) => void
  labelFor: (l: Lead) => string
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const selected = leads.find((l) => l.id === value) || null
  const ql = q.trim().toLowerCase()
  const filtered = ql
    ? leads.filter((l) => {
        const email = String((l.data as Record<string, unknown>)?.email || '').toLowerCase()
        return labelFor(l).toLowerCase().includes(ql) || email.includes(ql)
      })
    : leads
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2 text-sm outline-none focus:border-[#2B79F7]"
      >
        <span
          className={`min-w-0 truncate ${
            selected ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]'
          }`}
        >
          {selected ? labelFor(selected) : 'Choose a lead...'}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-[var(--text-tertiary)] transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="mt-1.5 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] p-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-tertiary)]" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search leads"
              className="w-full rounded-full bg-[var(--bg-tertiary)] pl-8 pr-3 py-1.5 text-xs text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
            />
          </div>
          <div className="mt-1.5 max-h-44 overflow-y-auto">
            {value && (
              <button
                type="button"
                onClick={() => {
                  onChange('')
                  setOpen(false)
                  setQ('')
                }}
                className="w-full rounded-lg px-2 py-1.5 text-left text-xs font-semibold text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)]"
              >
                Clear selection
              </button>
            )}
            {filtered.length === 0 ? (
              <p className="px-2 py-1.5 text-[11px] text-[var(--text-tertiary)]">No matches.</p>
            ) : (
              filtered.map((l) => {
                const email = String((l.data as Record<string, unknown>)?.email || '')
                return (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => {
                      onChange(l.id)
                      setOpen(false)
                      setQ('')
                    }}
                    className={`w-full rounded-lg px-2 py-1.5 text-left hover:bg-[var(--bg-tertiary)] ${
                      l.id === value ? 'bg-[#2B79F7]/10' : ''
                    }`}
                  >
                    <p className={`truncate text-xs font-medium ${l.id === value ? 'text-[#2B79F7]' : 'text-[var(--text-primary)]'}`}>
                      {labelFor(l)}
                    </p>
                    {email && (
                      <p className="truncate text-[10px] text-[var(--text-tertiary)]">{email}</p>
                    )}
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/** Small rounded action button that lives inside the toolbar pill. */
function Pill({
  children,
  onClick,
  primary = false,
  disabled = false,
  title,
}: {
  children: ReactNode
  onClick: () => void
  primary?: boolean
  disabled?: boolean
  title?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
        primary
          ? 'bg-[#2B79F7] text-white hover:opacity-90'
          : 'border border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
      }`}
    >
      {children}
    </button>
  )
}

export default function AgreementsPage() {
  const params = useParams()
  const clientId = (params?.clientId as string) || ''
  const supabase = createClient()
  const { workspaceName, canEditRecords } = useCrmRole()

  const [agreements, setAgreements] = useState<Agreement[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [leads, setLeads] = useState<Lead[]>([])
  const [fields, setFields] = useState<CustomFieldRow[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<View>({ kind: 'list' })
  const [confirm, setConfirm] = useState<ConfirmState>(null)
  // Status-trigger rules + the template whose rules modal is open.
  const [automations, setAutomations] = useState<Automation[]>([])
  const [autoTpl, setAutoTpl] = useState<Template | null>(null)
  const [autoStatus, setAutoStatus] = useState('')
  // Grid (doc previews) vs list, remembered per device.
  const [viewMode, setViewModeState] = useState<'grid' | 'list'>('grid')
  useEffect(() => {
    const saved = loadDraftSnapshot<'grid' | 'list'>('fk:agreements:viewmode')
    if (saved === 'list' || saved === 'grid') setViewModeState(saved)
  }, [])
  const setViewMode = (m: 'grid' | 'list') => {
    setViewModeState(m)
    saveDraftSnapshot('fk:agreements:viewmode', m)
  }
  const [search, setSearch] = useState('')

  // ----- template editor state -----
  const [tplName, setTplName] = useState('')
  const [tplBody, setTplBody] = useState(BLANK_BODY)
  const [savingTpl, setSavingTpl] = useState(false)

  // ----- compose state -----
  const [composeTitle, setComposeTitle] = useState('')
  const [composeBody, setComposeBody] = useState(BLANK_BODY)
  const [composeLeadId, setComposeLeadId] = useState('')
  const [signerEmails, setSignerEmails] = useState<string[]>([])
  const [ccEmails, setCcEmails] = useState<string[]>([])
  // Attached invoice: config only until everyone signs (no payment row yet).
  const [invoiceOn, setInvoiceOn] = useState(false)
  const [invoiceItems, setInvoiceItems] = useState<
    { description: string; quantity: string; unit_price: string }[]
  >([{ description: '', quantity: '1', unit_price: '' }])
  const [invoiceCurrency, setInvoiceCurrency] = useState('USD')
  const [invoiceDueDays, setInvoiceDueDays] = useState('7')
  const [invoicePaymentLink, setInvoicePaymentLink] = useState('')
  const [previewing, setPreviewing] = useState(false)
  const [sending, setSending] = useState(false)
  const [savingDraft, setSavingDraft] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [editingTitle, setEditingTitle] = useState(false)

  // Addresses used on past sends - powers suggestions + the saved-emails
  // browser in the signer/CC inputs.
  const savedEmailsKey = `fk:agreements:saved-emails:${clientId}`
  const [savedEmails, setSavedEmails] = useState<string[]>([])
  // Real profile pictures for people known to the workspace (users table).
  const [knownAvatars, setKnownAvatars] = useState<Record<string, string>>({})
  useEffect(() => {
    setSavedEmails(loadDraftSnapshot<string[]>(savedEmailsKey) || [])
  }, [savedEmailsKey])
  const rememberEmails = useCallback(
    (emails: string[]) => {
      const cleaned = emails.map((e) => e.toLowerCase()).filter(Boolean)
      if (cleaned.length === 0) return
      setSavedEmails((prev) => {
        const merged = [...cleaned, ...prev.filter((p) => !cleaned.includes(p))].slice(0, 100)
        saveDraftSnapshot(savedEmailsKey, merged)
        return merged
      })
    },
    [savedEmailsKey],
  )
  // Email auto-added by the currently picked lead - switching leads swaps
  // it out instead of stacking every lead's email into the signer list.
  const leadAutoEmailRef = useRef('')

  // ----- persistence: refresh-proof snapshot + server autosave -----
  const snapshotKey = `fk:agreements:editor:${clientId}`
  const [sync, setSync] = useState<SyncState>('idle')
  const restoredRef = useRef(false)
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savingRef = useRef(false)
  // Fingerprint of the last state that reached the server - skips no-op saves.
  const lastSavedRef = useRef('')

  const loadAll = useCallback(async () => {
    try {
      const [agRes, tplRes, leadsRes, fieldsRes] = await Promise.all([
        fetch(`/api/crm/agreements?clientId=${encodeURIComponent(clientId)}`, { cache: 'no-store' }),
        fetch(`/api/crm/agreements/templates?clientId=${encodeURIComponent(clientId)}`, { cache: 'no-store' }),
        supabase.from('leads').select('id, data').eq('client_id', clientId).order('position'),
        supabase
          .from('custom_fields')
          .select('field_key, field_name, field_type, options, position')
          .eq('client_id', clientId)
          .order('position'),
      ])
      const agJson = await agRes.json()
      if (agJson.success) setAgreements(agJson.agreements as Agreement[])
      const tplJson = await tplRes.json()
      if (tplJson.success) setTemplates(tplJson.templates as Template[])
      void fetch(`/api/crm/avatars?clientId=${encodeURIComponent(clientId)}`, { cache: 'no-store' })
        .then((r) => r.json())
        .then((j) => {
          if (j.success) setKnownAvatars(j.avatars as Record<string, string>)
        })
        .catch(() => {})
      void fetch(`/api/crm/agreements/automations?clientId=${encodeURIComponent(clientId)}`, { cache: 'no-store' })
        .then((r) => r.json())
        .then((j) => {
          if (j.success) setAutomations(j.automations as Automation[])
        })
        .catch(() => {})
      setLeads((leadsRes.data as Lead[]) || [])
      setFields((fieldsRes.data as CustomFieldRow[]) || [])
    } catch (err) {
      console.error('Agreements load error:', err)
      toast.error('Could not load agreements.')
    } finally {
      setLoading(false)
    }
  }, [clientId, supabase])

  useEffect(() => {
    if (clientId) void loadAll()
  }, [clientId, loadAll])

  // Placeholder list for the editor: lead fields + built-ins.
  const placeholders = useMemo<PlaceholderDef[]>(() => {
    const fromFields = fields.map((f) => ({ key: f.field_key, label: f.field_name }))
    const builtins: PlaceholderDef[] = [
      { key: 'date', label: 'Today’s date' },
      { key: 'business_name', label: 'Your business name' },
      { key: 'invoice_total', label: 'Invoice total' },
    ]
    const seen = new Set<string>()
    return [...fromFields, ...builtins].filter((p) => {
      if (seen.has(p.key)) return false
      seen.add(p.key)
      return true
    })
  }, [fields])

  // Lead status options drive the status-trigger picker.
  const leadStatusOptions = useMemo(() => {
    const f = fields.find((x) => x.field_type === 'status')
    return (Array.isArray(f?.options) ? f.options : []).filter((o) => o && o.value)
  }, [fields])

  const selectedLead = useMemo(
    () => leads.find((l) => l.id === composeLeadId) || null,
    [leads, composeLeadId],
  )

  const fillValues = useMemo<Record<string, unknown>>(() => {
    // Option-based fields (select/status/multiselect) store internal VALUE
    // keys (e.g. sssss_1781224250311) - documents must always print the
    // display labels instead.
    const data: Record<string, unknown> = { ...(selectedLead?.data || {}) }
    for (const f of fields) {
      if (!['select', 'status', 'multiselect'].includes(f.field_type)) continue
      const opts = Array.isArray(f.options) ? f.options : []
      const labelFor = (v: unknown) =>
        opts.find((o) => o && o.value === String(v))?.label || String(v)
      const raw = data[f.field_key]
      if (Array.isArray(raw)) data[f.field_key] = raw.map(labelFor)
      else if (typeof raw === 'string' && raw) data[f.field_key] = labelFor(raw)
    }
    return {
      ...data,
      date: new Date().toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }),
      business_name: workspaceName,
      invoice_total: invoiceOn
        ? `${invoiceCurrency.trim().toUpperCase() || 'USD'} ${invoiceItems
            .reduce(
              (sum, li) => sum + (parseFloat(li.quantity) || 0) * (parseFloat(li.unit_price) || 0),
              0,
            )
            .toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : '',
    }
  }, [selectedLead, fields, workspaceName, invoiceOn, invoiceItems, invoiceCurrency])

  // Cleaned invoice config (null when off/empty) + live total.
  const invoiceConfig = useMemo(() => {
    if (!invoiceOn) return null
    const lineItems = invoiceItems
      .map((li) => ({
        description: li.description.trim(),
        quantity: parseFloat(li.quantity) || 0,
        unit_price: parseFloat(li.unit_price) || 0,
      }))
      .filter((li) => li.description !== '' || li.quantity > 0 || li.unit_price > 0)
    if (lineItems.length === 0) return null
    return {
      lineItems,
      currency: invoiceCurrency.trim().toUpperCase() || 'USD',
      dueDays: Math.max(0, parseInt(invoiceDueDays, 10) || 0),
      paymentLink: invoicePaymentLink.trim() || null,
    }
  }, [invoiceOn, invoiceItems, invoiceCurrency, invoiceDueDays, invoicePaymentLink])

  const invoiceTotalNum = useMemo(
    () =>
      invoiceConfig
        ? invoiceConfig.lineItems.reduce((sum, li) => sum + li.quantity * li.unit_price, 0)
        : 0,
    [invoiceConfig],
  )

  const filled = useMemo(
    () => fillAgreementHtml(composeBody, fillValues),
    [composeBody, fillValues],
  )

  // ----- autosave to the server (drafts) with offline fallback -----
  // Debounced after every edit. Offline or failed saves keep the local
  // snapshot and retry on the browser's 'online' event, so work made
  // without a connection syncs up by itself.
  const autosaveNow = useCallback(async (): Promise<boolean> => {
    if (view.kind === 'list') return true
    if (savingRef.current) return true

    if (view.kind === 'compose') {
      // "Worth a draft" includes recipients and the lead pick, not just
      // text: adding emails alone must survive going back and returning.
      const meaningful =
        composeTitle.trim() !== '' ||
        (composeBody !== BLANK_BODY && composeBody.trim() !== '') ||
        signerEmails.length > 0 ||
        ccEmails.length > 0 ||
        composeLeadId !== '' ||
        invoiceConfig !== null
      if (!meaningful) return true
      // Sent/signed agreements are frozen - only drafts autosave.
      if (view.draft && view.draft.status !== 'draft') return true
      const fingerprint = JSON.stringify([
        composeTitle, composeBody, composeLeadId, signerEmails, ccEmails, invoiceConfig,
      ])
      if (fingerprint === lastSavedRef.current) return true
      savingRef.current = true
      setSync('saving')
      try {
        const draft = view.draft
        const res = await fetch(
          draft ? `/api/crm/agreements/${draft.id}` : '/api/crm/agreements',
          {
            method: draft ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              clientId,
              templateId: view.templateId,
              leadId: composeLeadId || null,
              title: composeTitle.trim() || 'Untitled agreement',
              bodyHtml: composeBody,
              signers: signerEmails,
              ccEmails,
              invoiceConfig,
            }),
          },
        )
        const json = await res.json()
        if (!json.success) throw new Error(json.error || 'autosave failed')
        lastSavedRef.current = fingerprint
        if (!draft && json.agreement) {
          const created = json.agreement as Agreement
          setView((v) => (v.kind === 'compose' ? { ...v, draft: created } : v))
        }
        setSync('saved')
        return true
      } catch {
        setSync('offline')
        return false
      } finally {
        savingRef.current = false
      }
    }

    // Template editor: typed-but-unnamed work still autosaves, under a
    // default name, so going back never loses it.
    const tplMeaningful =
      tplName.trim() !== '' || (tplBody !== BLANK_BODY && tplBody.trim() !== '')
    if (!tplMeaningful) return true
    const fingerprint = JSON.stringify([tplName, tplBody])
    if (fingerprint === lastSavedRef.current) return true
    savingRef.current = true
    setSync('saving')
    try {
      const existing = view.template
      const res = await fetch(
        existing
          ? `/api/crm/agreements/templates/${existing.id}`
          : '/api/crm/agreements/templates',
        {
          method: existing ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientId,
            name: tplName.trim() || 'Untitled template',
            bodyHtml: tplBody,
          }),
        },
      )
      const json = await res.json()
      if (!json.success) throw new Error(json.error || 'autosave failed')
      lastSavedRef.current = fingerprint
      if (!existing && json.template) {
        const created = json.template as Template
        setView((v) => (v.kind === 'template' ? { ...v, template: created } : v))
      }
      setSync('saved')
      return true
    } catch {
      setSync('offline')
      return false
    } finally {
      savingRef.current = false
    }
  }, [view, clientId, composeTitle, composeBody, composeLeadId, signerEmails, ccEmails, invoiceConfig, tplName, tplBody])

  // Debounced autosave on every edit.
  useEffect(() => {
    if (view.kind === 'list') return
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current)
    autosaveTimer.current = setTimeout(() => void autosaveNow(), 2500)
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current)
    }
  }, [view.kind, autosaveNow])

  // When the connection comes back, push whatever is pending.
  useEffect(() => {
    const onOnline = () => void autosaveNow()
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [autosaveNow])

  // Instant local snapshot (covers refresh mid-debounce and offline).
  useEffect(() => {
    if (view.kind === 'list') return
    const snap: EditorSnapshot = {
      kind: view.kind,
      draftId: view.kind === 'compose' ? view.draft?.id || null : null,
      templateId: view.kind === 'compose' ? view.templateId : null,
      tplId: view.kind === 'template' ? view.template?.id || null : null,
      composeTitle,
      composeBody,
      composeLeadId,
      signerEmails,
      ccEmails,
      invoiceOn,
      invoiceItems,
      invoiceCurrency,
      invoiceDueDays,
      invoicePaymentLink,
      tplName,
      tplBody,
    }
    saveDraftSnapshot(snapshotKey, snap)
  }, [view, composeTitle, composeBody, composeLeadId, signerEmails, ccEmails, invoiceOn, invoiceItems, invoiceCurrency, invoiceDueDays, invoicePaymentLink, tplName, tplBody, snapshotKey])

  // Reopen the editor after a refresh if a snapshot was left behind.
  useEffect(() => {
    if (loading || restoredRef.current) return
    restoredRef.current = true
    const snap = loadDraftSnapshot<EditorSnapshot>(snapshotKey)
    if (!snap) return
    if (snap.kind === 'template') {
      setTplName(snap.tplName)
      setTplBody(snap.tplBody)
      setView({ kind: 'template', template: templates.find((t) => t.id === snap.tplId) || null })
    } else {
      setComposeTitle(snap.composeTitle)
      setComposeBody(snap.composeBody)
      setComposeLeadId(snap.composeLeadId)
      setSignerEmails(snap.signerEmails || [])
      setCcEmails(snap.ccEmails || [])
      setInvoiceOn(!!snap.invoiceOn)
      setInvoiceItems(
        snap.invoiceItems?.length
          ? snap.invoiceItems
          : [{ description: '', quantity: '1', unit_price: '' }],
      )
      setInvoiceCurrency(snap.invoiceCurrency || 'USD')
      setInvoiceDueDays(snap.invoiceDueDays || '7')
      setInvoicePaymentLink(snap.invoicePaymentLink || '')
      setPreviewing(false)
      const draft = agreements.find((a) => a.id === snap.draftId && a.status === 'draft') || null
      setView({ kind: 'compose', draft, templateId: snap.templateId })
    }
  }, [loading, agreements, templates, snapshotKey])

  /** Leave the editor: final autosave, then clear the local snapshot if it
   *  reached the server (offline keeps it so nothing is lost). */
  const closeEditor = useCallback(async () => {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current)
    const synced = await autosaveNow()
    if (synced) {
      clearDraftSnapshot(snapshotKey)
    } else {
      toast.info('You are offline. Changes are saved on this device and will sync when you reconnect.')
    }
    lastSavedRef.current = ''
    setSync('idle')
    setView({ kind: 'list' })
    void loadAll()
  }, [autosaveNow, snapshotKey, loadAll])

  const syncLabel =
    sync === 'saving'
      ? 'Saving…'
      : sync === 'saved'
        ? 'Saved'
        : sync === 'offline'
          ? 'Offline - saved on this device'
          : ''

  // ----- template actions -----

  // "Recently opened or edited in any capacity floats to the top": opening
  // a doc bumps it locally AND stamps updated_at server-side (the list
  // orders by it). Signed agreements are immutable, so they only reorder
  // locally for this session.
  const touchAgreement = (id: string, status: Agreement['status']) => {
    setAgreements((prev) => {
      const i = prev.findIndex((x) => x.id === id)
      if (i <= 0) return prev
      const copy = [...prev]
      const [item] = copy.splice(i, 1)
      return [item, ...copy]
    })
    if (status !== 'signed') {
      void fetch(`/api/crm/agreements/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId }),
      }).catch(() => {})
    }
  }

  const touchTemplate = (id: string) => {
    setTemplates((prev) => {
      const i = prev.findIndex((x) => x.id === id)
      if (i <= 0) return prev
      const copy = [...prev]
      const [item] = copy.splice(i, 1)
      return [item, ...copy]
    })
    void fetch(`/api/crm/agreements/templates/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId }),
    }).catch(() => {})
  }

  const openTemplate = (template: Template | null) => {
    if (template) touchTemplate(template.id)
    setTplName(template?.name || '')
    setTplBody(template?.body_html || BLANK_BODY)
    // Seed the fingerprint so opening without editing doesn't autosave.
    lastSavedRef.current = template
      ? JSON.stringify([template.name, template.body_html])
      : ''
    setSync('idle')
    setView({ kind: 'template', template })
  }

  const saveTemplate = async () => {
    setSavingTpl(true)
    try {
      const existing = view.kind === 'template' ? view.template : null
      const res = await fetch(
        existing
          ? `/api/crm/agreements/templates/${existing.id}`
          : '/api/crm/agreements/templates',
        {
          method: existing ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientId,
            name: tplName.trim() || 'Untitled template',
            bodyHtml: tplBody,
          }),
        },
      )
      const json = await res.json()
      if (!json.success) {
        toast.error(json.error || 'Could not save the template.')
        return
      }
      toast.success('Template saved.')
      clearDraftSnapshot(snapshotKey)
      lastSavedRef.current = ''
      setSync('idle')
      setView({ kind: 'list' })
      void loadAll()
    } finally {
      setSavingTpl(false)
    }
  }

  const deleteTemplate = (t: Template) => {
    setConfirm({
      title: 'Delete template',
      message: `Delete the template "${t.name}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      tone: 'danger',
      onConfirm: async () => {
        const res = await fetch(
          `/api/crm/agreements/templates/${t.id}?clientId=${encodeURIComponent(clientId)}`,
          { method: 'DELETE' },
        )
        const json = await res.json()
        if (!json.success) {
          toast.error(json.error || 'Could not delete the template.')
          return
        }
        setTemplates((prev) => prev.filter((x) => x.id !== t.id))
        setConfirm(null)
      },
    })
  }

  // ----- compose actions -----

  const openCompose = (opts: { template?: Template | null; draft?: Agreement | null }) => {
    const draft = opts.draft || null
    const template = opts.template || null
    if (draft) touchAgreement(draft.id, draft.status)
    if (template) touchTemplate(template.id)
    setComposeTitle(draft?.title || template?.name || '')
    setComposeBody(draft?.body_html || template?.body_html || BLANK_BODY)
    setComposeLeadId(draft?.lead_id || '')
    setSignerEmails(draft ? draft.signers.map((s) => s.email) : [])
    setCcEmails(draft?.cc_emails || [])
    const cfg = draft?.invoice_config || null
    setInvoiceOn(!!cfg)
    setInvoiceItems(
      cfg?.lineItems?.length
        ? cfg.lineItems.map((li) => ({
            description: li.description,
            quantity: String(li.quantity),
            unit_price: String(li.unit_price),
          }))
        : [{ description: '', quantity: '1', unit_price: '' }],
    )
    setInvoiceCurrency(cfg?.currency || 'USD')
    setInvoiceDueDays(String(cfg?.dueDays ?? 7))
    setInvoicePaymentLink(cfg?.paymentLink || '')
    leadAutoEmailRef.current = ''
    setPreviewing(false)
    setSidebarOpen(true)
    setEditingTitle(false)
    // Seed the fingerprint so opening without editing doesn't autosave.
    lastSavedRef.current = draft
      ? JSON.stringify([
          draft.title,
          draft.body_html,
          draft.lead_id || '',
          draft.signers.map((s) => s.email),
          draft.cc_emails || [],
        ])
      : ''
    setSync('idle')
    setView({ kind: 'compose', draft, templateId: template?.id || draft?.template_id || null })
  }

  const onPickLead = (id: string) => {
    setComposeLeadId(id)
    const lead = leads.find((l) => l.id === id)
    const email = String((lead?.data as Record<string, unknown> | undefined)?.email || '')
      .trim()
      .toLowerCase()
    const prevAuto = leadAutoEmailRef.current
    setSignerEmails((prev) => {
      // Switching leads REPLACES the previous lead's auto-added email.
      let next = prevAuto && prevAuto !== email ? prev.filter((e) => e !== prevAuto) : prev
      if (email && !next.includes(email)) next = [...next, email]
      return next
    })
    leadAutoEmailRef.current = email
  }

  // Latest view for callbacks that await: an in-flight autosave can attach
  // a freshly created draft to the view mid-submit, and a stale closure
  // would then POST a duplicate.
  const viewRef = useRef(view)
  useEffect(() => {
    viewRef.current = view
  }, [view])

  const doSubmit = useCallback(
    async (send: boolean) => {
      const setBusy = send ? setSending : setSavingDraft
      setBusy(true)
      try {
        // Don't race the autosaver: cancel the pending run, wait out one
        // already in flight, then read the up-to-date draft.
        if (autosaveTimer.current) clearTimeout(autosaveTimer.current)
        for (let i = 0; i < 20 && savingRef.current; i++) {
          await new Promise((r) => setTimeout(r, 150))
        }
        const v = viewRef.current
        const draft = v.kind === 'compose' ? v.draft : null
        const payload = {
          clientId,
          templateId: v.kind === 'compose' ? v.templateId : null,
          leadId: composeLeadId || null,
          title: composeTitle.trim() || 'Untitled agreement',
          // Send freezes the FILLED body; drafts keep chips so they can be
          // refilled when the lead's details change before sending.
          bodyHtml: send ? filled.html : composeBody,
          signers: signerEmails,
          ccEmails,
          invoiceConfig,
          ...(send ? { action: 'send' as const, send: true } : {}),
        }
        const res = await fetch(
          draft ? `/api/crm/agreements/${draft.id}` : '/api/crm/agreements',
          {
            method: draft ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          },
        )
        const json = await res.json()
        if (!json.success) {
          toast.error(json.error || 'Could not save the agreement.')
          return
        }
        if (send) {
          toast.success(
            json.emailedNow === false
              ? 'Agreement created. The email is queued and will go out shortly.'
              : signerEmails.length > 1
                ? `Sent to ${signerEmails.length} signers.`
                : 'Agreement sent.',
          )
        } else {
          toast.success('Draft saved.')
        }
        rememberEmails([...signerEmails, ...ccEmails])
        clearDraftSnapshot(snapshotKey)
        lastSavedRef.current = ''
        setSync('idle')
        setView({ kind: 'list' })
        void loadAll()
      } finally {
        setBusy(false)
      }
    },
    [clientId, composeLeadId, composeTitle, composeBody, filled.html, signerEmails, ccEmails, invoiceConfig, loadAll, snapshotKey, rememberEmails],
  )

  const submitAgreement = (send: boolean) => {
    // Drafts can stay untitled ("Untitled agreement"); sending needs a name.
    if (send && !composeTitle.trim()) {
      toast.error('Give the agreement a title before sending.')
      return
    }
    if (send && signerEmails.length === 0) {
      toast.error('Add at least one signer email.')
      return
    }
    if (send && filled.missing.length > 0) {
      setConfirm({
        title: 'Some fields are empty',
        message: `These fields have no value yet and will be blank in the document: ${filled.missing.join(', ')}. Send anyway?`,
        confirmLabel: 'Send anyway',
        tone: 'warning',
        onConfirm: async () => {
          setConfirm(null)
          await doSubmit(true)
        },
      })
      return
    }
    void doSubmit(send)
  }

  const deleteAgreement = (a: Agreement) => {
    setConfirm({
      title: 'Delete agreement',
      message: `Delete "${a.title}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      tone: 'danger',
      onConfirm: async () => {
        const res = await fetch(
          `/api/crm/agreements/${a.id}?clientId=${encodeURIComponent(clientId)}`,
          { method: 'DELETE' },
        )
        const json = await res.json()
        if (!json.success) {
          toast.error(json.error || 'Could not delete the agreement.')
          return
        }
        setAgreements((prev) => prev.filter((x) => x.id !== a.id))
        setConfirm(null)
      },
    })
  }

  // Draft copy of any agreement: same content, lead, signers, CC and
  // invoice, so a mistake never means retyping the document.
  const createDraftCopy = async (a: Agreement, title: string): Promise<Agreement | null> => {
    const res = await fetch('/api/crm/agreements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId,
        templateId: a.template_id,
        leadId: a.lead_id,
        title,
        bodyHtml: a.body_html,
        signers: a.signers.map((s) => s.email),
        ccEmails: a.cc_emails || [],
        invoiceConfig: a.invoice_config,
      }),
    })
    const json = await res.json()
    if (!json.success) {
      toast.error(json.error || 'Could not create a copy.')
      return null
    }
    return json.agreement as Agreement
  }

  // Duplicate (signed or any doc): new draft, original stays untouched.
  const duplicateAgreement = async (a: Agreement) => {
    const copy = await createDraftCopy(a, `Copy of ${a.title}`)
    if (!copy) return
    void loadAll()
    openCompose({ draft: copy })
  }

  // Edit & resend (sent, unsigned only): copy the content into a fresh
  // draft, delete the sent original so its signing links stop working,
  // then open the draft. Same document, no retyping, clean resend.
  const recallAndEdit = (a: Agreement) => {
    setConfirm({
      title: 'Edit & resend',
      message: `"${a.title}" will be taken back: the link your signers received stops working and the document opens as a draft to edit and resend.`,
      confirmLabel: 'Edit & resend',
      tone: 'danger',
      onConfirm: async () => {
        const copy = await createDraftCopy(a, a.title)
        if (!copy) {
          setConfirm(null)
          return
        }
        const res = await fetch(
          `/api/crm/agreements/${a.id}?clientId=${encodeURIComponent(clientId)}`,
          { method: 'DELETE' },
        )
        const json = await res.json()
        if (!json.success) {
          // The copy exists either way; the worst case is the sent original
          // lingers in the list next to the new draft.
          toast.error(json.error || 'Could not remove the sent copy.')
        }
        setAgreements((prev) => prev.filter((x) => x.id !== a.id))
        setConfirm(null)
        void loadAll()
        openCompose({ draft: copy })
      },
    })
  }

  // ----- export helpers (kebab inside the editor toolbar) -----

  const buildDocHtml = useCallback((title: string, bodyHtml: string) => {
    return (
      '<!doctype html><html><head><meta charset="utf-8"><title>' +
      title.replace(/</g, '&lt;') +
      '</title>' +
      `<link rel="stylesheet" href="${DOC_FONTS_URL}">` +
      `<style>${AGREEMENT_DOC_CSS} body{margin:0;background:#fff;font-family:Arial,sans-serif;}` +
      '.agreement-page{border:0;box-shadow:none;margin:0 auto;}</style></head>' +
      `<body><div class="agreement-doc agreement-page">${bodyHtml}</div></body></html>`
    )
  }, [])

  const downloadFile = (filename: string, mime: string, content: string) => {
    const blob = new Blob([content], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  const safeFilename = (title: string) =>
    (title.trim() || 'agreement').replace(/[^\w-]+/g, '-').slice(0, 60)

  const exportDoc = (kind: 'pdf' | 'html' | 'doc', title: string, bodyHtml: string) => {
    const html = buildDocHtml(title || 'Agreement', bodyHtml)
    if (kind === 'html') {
      downloadFile(`${safeFilename(title)}.html`, 'text/html', html)
    } else if (kind === 'doc') {
      // Word opens HTML saved with a .doc extension natively.
      downloadFile(`${safeFilename(title)}.doc`, 'application/msword', html)
    } else {
      // PDF goes through the browser's print dialog (Save as PDF).
      const w = window.open('', '_blank')
      if (!w) {
        toast.error('Allow pop-ups to download as PDF.')
        return
      }
      w.document.write(html.replace('</body>', '<script>window.onload=()=>window.print()</script></body>'))
      w.document.close()
    }
  }

  const saveAsTemplate = async (name: string, bodyHtml: string) => {
    const res = await fetch('/api/crm/agreements/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, name: name.trim() || 'Untitled template', bodyHtml }),
    })
    const json = await res.json()
    if (!json.success) {
      toast.error(json.error || 'Could not save the template.')
      return
    }
    const created = json.template as Template
    toast.success('Saved as template.', {
      action: { label: 'Open', onClick: () => openTemplate(created) },
    })
    void loadAll()
  }

  const makeCopyDraft = async () => {
    const res = await fetch('/api/crm/agreements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId,
        leadId: composeLeadId || null,
        title: `Copy of ${composeTitle.trim() || 'Agreement'}`,
        bodyHtml: composeBody,
        signers: signerEmails,
        ccEmails,
      }),
    })
    const json = await res.json()
    if (!json.success) {
      toast.error(json.error || 'Could not make a copy.')
      return
    }
    const created = json.agreement as Agreement
    toast.success('Copy saved as a draft.', {
      action: { label: 'Open', onClick: () => openCompose({ draft: created }) },
    })
    void loadAll()
  }

  // Delete the document currently open in the editor. Unsaved work is just
  // discarded; autosaved drafts / existing templates are removed for real.
  const deleteFromEditor = () => {
    const v = viewRef.current
    const isTemplate = v.kind === 'template'
    setConfirm({
      title: isTemplate ? 'Delete template' : 'Delete agreement',
      message: 'Delete this document? This cannot be undone.',
      confirmLabel: 'Delete',
      tone: 'danger',
      onConfirm: async () => {
        if (autosaveTimer.current) clearTimeout(autosaveTimer.current)
        const url =
          v.kind === 'compose' && v.draft
            ? `/api/crm/agreements/${v.draft.id}?clientId=${encodeURIComponent(clientId)}`
            : v.kind === 'template' && v.template
              ? `/api/crm/agreements/templates/${v.template.id}?clientId=${encodeURIComponent(clientId)}`
              : null
        if (url) {
          const res = await fetch(url, { method: 'DELETE' })
          const json = await res.json()
          if (!json.success) {
            toast.error(json.error || 'Could not delete.')
            return
          }
        }
        clearDraftSnapshot(snapshotKey)
        lastSavedRef.current = ''
        setSync('idle')
        setConfirm(null)
        setView({ kind: 'list' })
        void loadAll()
      },
    })
  }

  const copyLink = (a: Agreement) => {
    const url = `${window.location.origin}/agreement/${a.public_token}`
    void navigator.clipboard.writeText(url)
    toast.success('View link copied.')
  }

  const leadLabel = (l: Lead) => {
    const d = l.data || {}
    return (
      (typeof d.name === 'string' && d.name) ||
      (typeof d.email === 'string' && d.email) ||
      'Unnamed lead'
    )
  }

  const signerSummary = (a: Agreement) => {
    if (a.signers.length === 0) return a.recipient_email || 'No signers yet'
    if (a.signers.length === 1) return a.signers[0].name || a.signers[0].email
    return `${a.signers[0].email} +${a.signers.length - 1} more`
  }

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  const confirmModal = (
    <ConfirmModal
      open={confirm !== null}
      title={confirm?.title || ''}
      message={confirm?.message || ''}
      confirmLabel={confirm?.confirmLabel}
      tone={confirm?.tone}
      onConfirm={confirm?.onConfirm || (() => {})}
      onClose={() => setConfirm(null)}
    />
  )

  if (loading) {
    return (
      <div className="p-3 sm:p-4 lg:p-6 min-h-full">
        <div className="flex items-center justify-between gap-2 pt-2 pb-5">
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-8 w-44 rounded-full" />
        </div>
        <Skeleton className="h-4 w-28 mb-3" />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-8">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-4 w-28 mb-3" />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  // ----- template editor view -----
  if (view.kind === 'template') {
    return (
      <div className="px-3 sm:px-4 lg:px-6 pb-3 sm:pb-4 lg:pb-6 min-h-full animate-in fade-in">
        {/* Full-bleed sticky action bar: back pinned to the left corner,
            actions pinned to the right. */}
        <div className="sticky top-0 z-30 -mx-3 sm:-mx-4 lg:-mx-6 px-3 sm:px-4 lg:px-6 flex h-[52px] items-center justify-between gap-2 bg-[var(--bg-primary)]/95 backdrop-blur">
          <button
            type="button"
            onClick={() => void closeEditor()}
            className="flex items-center gap-1.5 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Back to agreements</span>
          </button>
          <div className="ml-auto flex items-center gap-1.5">
              {syncLabel && (
                <span className="hidden sm:inline text-xs text-[var(--text-tertiary)] mr-1">{syncLabel}</span>
              )}
              <Pill primary onClick={() => void saveTemplate()} disabled={savingTpl}>
                {savingTpl ? 'Saving…' : 'Save template'}
              </Pill>
              <KebabMenu
                items={[
                  {
                    label: 'Make a copy',
                    onClick: () => void saveAsTemplate(`Copy of ${tplName || 'template'}`, tplBody),
                  },
                  { type: 'section', label: 'Download' },
                  { label: 'PDF', onClick: () => exportDoc('pdf', tplName, tplBody) },
                  { label: 'HTML', onClick: () => exportDoc('html', tplName, tplBody) },
                  { label: 'Word (.doc)', onClick: () => exportDoc('doc', tplName, tplBody) },
                  { label: 'Delete', onClick: deleteFromEditor, tone: 'destructive' },
                ]}
              />
            </div>
        </div>
        <div className="max-w-[920px] mx-auto space-y-3 pt-3">
          <input
            value={tplName}
            onChange={(e) => setTplName(e.target.value)}
            placeholder="Template name (e.g. Service agreement)"
            className="w-full rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-4 py-2.5 text-sm text-[var(--text-primary)] outline-none focus:border-[#2B79F7]"
          />
          <RichTextEditor
            value={tplBody}
            onChange={setTplBody}
            placeholders={placeholders}
            docKey={view.template?.id || 'new-template'}
          />
        </div>
        {confirmModal}
      </div>
    )
  }

  // ----- compose view -----
  if (view.kind === 'compose') {
    // Send needs a real title and at least one signer; until then the
    // button is greyed out with the reason on hover.
    const sendBlocker = !composeTitle.trim()
      ? 'Give the agreement a title to send'
      : signerEmails.length === 0
        ? 'Add at least one signer to send'
        : ''
    const actionPills = (
      <>
        <Pill onClick={() => setPreviewing((p) => !p)}>{previewing ? 'Edit' : 'Preview'}</Pill>
        <Pill onClick={() => submitAgreement(false)} disabled={savingDraft || sending}>
          {savingDraft ? 'Saving…' : 'Save draft'}
        </Pill>
        <Pill
          primary
          onClick={() => submitAgreement(true)}
          disabled={sending || savingDraft || !!sendBlocker}
          title={sendBlocker || undefined}
        >
          {sending ? 'Sending…' : 'Send'}
        </Pill>
        <KebabMenu
          items={[
            {
              label: 'Save as template',
              onClick: () => void saveAsTemplate(composeTitle, composeBody),
            },
            { label: 'Make a copy', onClick: () => void makeCopyDraft() },
            { type: 'section', label: 'Download' },
            { label: 'PDF', onClick: () => exportDoc('pdf', composeTitle, filled.html) },
            { label: 'HTML', onClick: () => exportDoc('html', composeTitle, filled.html) },
            { label: 'Word (.doc)', onClick: () => exportDoc('doc', composeTitle, filled.html) },
            { label: 'Delete', onClick: deleteFromEditor, tone: 'destructive' },
          ]}
        />
      </>
    )

    return (
      <div className="px-3 sm:px-4 lg:px-6 pb-3 sm:pb-4 lg:pb-6 min-h-full animate-in fade-in">
        { }
        <link rel="stylesheet" href={DOC_FONTS_URL} />
        <style dangerouslySetInnerHTML={{ __html: AGREEMENT_DOC_CSS }} />
        {/* Full-bleed sticky action bar: back pinned to the left corner,
            actions pinned to the right. */}
        <div className="sticky top-0 z-30 -mx-3 sm:-mx-4 lg:-mx-6 px-3 sm:px-4 lg:px-6 flex h-[52px] items-center justify-between gap-2 bg-[var(--bg-primary)]/95 backdrop-blur">
          <button
            type="button"
            onClick={() => void closeEditor()}
            className="flex items-center gap-1.5 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Back to agreements</span>
          </button>
          <div className="ml-auto flex items-center gap-1.5">
            {syncLabel && (
              <span className="hidden sm:inline text-xs text-[var(--text-tertiary)] mr-1">
                {syncLabel}
              </span>
            )}
            {actionPills}
          </div>
        </div>
        <div className="max-w-[920px] mx-auto space-y-3 pt-3">
          {previewing && (
            <div>
              {filled.missing.length > 0 && (
                <p className="mx-auto max-w-[816px] text-xs text-amber-600 dark:text-amber-400">
                  No value yet for: {filled.missing.join(', ')}. Pick a lead or fill these on
                  the lead before sending.
                </p>
              )}
              <div className="pt-2 pb-10">
                <div
                  className="agreement-doc agreement-page mx-auto"
                  dangerouslySetInnerHTML={{ __html: filled.html }}
                />
              </div>
            </div>
          )}
          {/* The editor stays MOUNTED while previewing, only hidden:
              unmounting it would throw away the undo/redo history and
              caret, wiping the session's edit trail on every preview. */}
          <div className={previewing ? 'hidden' : undefined}>
            <RichTextEditor
              value={composeBody}
              onChange={setComposeBody}
              placeholders={placeholders}
              docKey={view.draft?.id || 'new-compose'}
            />
          </div>
        </div>

        {/* Floating collapsible details panel: title, lead, signers, CC.
            Signers and CC stack vertically so neither stretches the other.
            Sits mid-screen so it never covers the toolbar or actions, and
            collapses into an edge tab. */}
        <div className="fixed left-0 top-[30vh] z-30">
          {sidebarOpen ? (
            <div className="ml-2 w-72 max-h-[60vh] overflow-y-auto rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] shadow-xl p-4 space-y-5 origin-left animate-in fade-in zoom-in-95 slide-in-from-left-3 duration-200">
              <div className="flex items-start justify-between gap-2">
                {editingTitle ? (
                  <input
                    autoFocus
                    value={composeTitle}
                    onChange={(e) => setComposeTitle(e.target.value)}
                    onBlur={() => setEditingTitle(false)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === 'Escape') setEditingTitle(false)
                    }}
                    placeholder="Untitled agreement"
                    className="w-full bg-transparent text-base font-bold text-[var(--text-primary)] outline-none border-b border-[#2B79F7] pb-0.5"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setEditingTitle(true)}
                    title="Tap to rename"
                    className="min-w-0 text-left"
                  >
                    <h2
                      className={`text-base font-bold truncate ${
                        composeTitle.trim()
                          ? 'text-[var(--text-primary)]'
                          : 'text-[var(--text-tertiary)]'
                      }`}
                    >
                      {composeTitle.trim() || 'Untitled agreement'}
                    </h2>
                  </button>
                )}
                <button
                  type="button"
                  title="Hide details"
                  onClick={() => setSidebarOpen(false)}
                  className="shrink-0 p-1.5 rounded-full text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
                >
                  <PanelLeftClose className="h-4 w-4" />
                </button>
              </div>

              <div>
                <p className="text-[11px] font-semibold text-[var(--text-tertiary)] mb-1.5">
                  Fill fields from lead
                </p>
                <LeadPicker
                  leads={leads}
                  value={composeLeadId}
                  onChange={onPickLead}
                  labelFor={leadLabel}
                />
              </div>

              <div>
                <p className="text-[11px] font-semibold text-[var(--text-tertiary)]">Signers</p>
                <p className="text-[10px] text-[var(--text-tertiary)] mb-2">
                  Everyone listed gets their own signing link.
                </p>
                <EmailAvatarsInput
                  value={signerEmails}
                  onChange={setSignerEmails}
                  saved={savedEmails}
                  knownAvatars={knownAvatars}
                />
              </div>

              <div>
                <p className="text-[11px] font-semibold text-[var(--text-tertiary)]">CC</p>
                <p className="text-[10px] text-[var(--text-tertiary)] mb-2">
                  Gets a copy by email, no signature needed.
                </p>
                <EmailAvatarsInput
                  value={ccEmails}
                  onChange={setCcEmails}
                  saved={savedEmails}
                  knownAvatars={knownAvatars}
                />
              </div>

              <div>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] font-semibold text-[var(--text-tertiary)]">Invoice</p>
                  <Toggle checked={invoiceOn} onChange={setInvoiceOn} />
                </div>
                <p className="text-[10px] text-[var(--text-tertiary)] mt-0.5">
                  Created and sent automatically once everyone has signed.
                </p>
                {invoiceOn && (
                  <div className="mt-2 space-y-2">
                    {invoiceItems.map((li, i) => (
                      <div key={i} className="space-y-1">
                        <input
                          value={li.description}
                          onChange={(e) =>
                            setInvoiceItems((prev) =>
                              prev.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)),
                            )
                          }
                          placeholder="Line item description"
                          className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-[#2B79F7]"
                        />
                        <div className="flex items-center gap-1.5">
                          <input
                            value={li.quantity}
                            onChange={(e) =>
                              setInvoiceItems((prev) =>
                                prev.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)),
                              )
                            }
                            placeholder="Qty"
                            inputMode="decimal"
                            className="w-14 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-[#2B79F7]"
                          />
                          <input
                            value={li.unit_price}
                            onChange={(e) =>
                              setInvoiceItems((prev) =>
                                prev.map((x, j) => (j === i ? { ...x, unit_price: e.target.value } : x)),
                              )
                            }
                            placeholder="Unit price"
                            inputMode="decimal"
                            className="min-w-0 flex-1 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-[#2B79F7]"
                          />
                          {invoiceItems.length > 1 && (
                            <button
                              type="button"
                              title="Remove line item"
                              onClick={() =>
                                setInvoiceItems((prev) => prev.filter((_, j) => j !== i))
                              }
                              className="shrink-0 rounded-full p-1 text-red-500 hover:bg-red-500/10"
                            >
                              <Plus className="h-3.5 w-3.5 rotate-45" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() =>
                        setInvoiceItems((prev) => [
                          ...prev,
                          { description: '', quantity: '1', unit_price: '' },
                        ])
                      }
                      className="text-[11px] font-semibold text-[#2B79F7] hover:underline"
                    >
                      + Add line item
                    </button>
                    <div className="flex items-center gap-1.5">
                      <input
                        value={invoiceCurrency}
                        onChange={(e) => setInvoiceCurrency(e.target.value.toUpperCase().slice(0, 5))}
                        placeholder="USD"
                        className="w-16 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-[#2B79F7]"
                      />
                      <span className="text-[10px] text-[var(--text-tertiary)]">due</span>
                      <input
                        value={invoiceDueDays}
                        onChange={(e) => setInvoiceDueDays(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
                        inputMode="numeric"
                        className="w-12 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1.5 text-center text-xs text-[var(--text-primary)] outline-none focus:border-[#2B79F7]"
                      />
                      <span className="text-[10px] text-[var(--text-tertiary)]">days after signing</span>
                    </div>
                    <input
                      value={invoicePaymentLink}
                      onChange={(e) => setInvoicePaymentLink(e.target.value)}
                      placeholder="Payment link (optional)"
                      className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-[#2B79F7]"
                    />
                    <p className="text-xs font-bold text-[var(--text-primary)] tabular-nums">
                      Total: {invoiceCurrency.trim().toUpperCase() || 'USD'}{' '}
                      {invoiceTotalNum.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            // Collapsed: a slim tab hugging the screen edge, Grammarly-style.
            <button
              type="button"
              title="Agreement details"
              onClick={() => setSidebarOpen(true)}
              className="flex h-16 w-9 items-center justify-center rounded-r-2xl border border-l-0 border-[var(--border-primary)] bg-[var(--bg-secondary)] shadow-xl text-[var(--text-secondary)] hover:text-[#2B79F7] hover:w-10 transition-all animate-in fade-in slide-in-from-left-2 duration-200"
            >
              <PanelLeftOpen className="h-5 w-5" />
            </button>
          )}
        </div>
        {confirmModal}
      </div>
    )
  }

  // ----- list view -----

  const agreementSubtitle = (a: Agreement) =>
    `${signerSummary(a)}${
      a.status === 'signed' && a.signed_at
        ? ` · Signed ${fmtDate(a.signed_at)}`
        : a.status === 'sent' && a.sent_at
          ? ` · Sent ${fmtDate(a.sent_at)}`
          : ` · Created ${fmtDate(a.created_at)}`
    }`

  const openAgreement = (a: Agreement) => {
    if (a.status === 'draft' && canEditRecords) {
      openCompose({ draft: a })
    } else {
      touchAgreement(a.id, a.status)
      window.open(`/agreement/${a.public_token}`, '_blank', 'noopener')
    }
  }

  // Anything carrying a real signature (signed, or partially signed by one
  // of several signers) is a record: no Delete offered, and the server
  // rejects it anyway.
  const hasSignature = (a: Agreement) =>
    a.status === 'signed' || a.signers.some((s) => s.signed_at)

  const agreementMenu = (a: Agreement): KebabMenuItem[] => [
    ...(canEditRecords && a.status === 'draft'
      ? [{ label: 'Edit & send', onClick: () => openCompose({ draft: a }) }]
      : []),
    // Sent but unsigned: take it back and fix it without retyping.
    ...(canEditRecords && a.status !== 'draft' && !hasSignature(a)
      ? [{ label: 'Edit & resend', onClick: () => recallAndEdit(a) }]
      : []),
    ...(a.status !== 'draft'
      ? [
          { label: 'Open signing page', onClick: () => window.open(`/agreement/${a.public_token}`, '_blank', 'noopener') },
          { label: 'Copy view link', onClick: () => copyLink(a) },
        ]
      : []),
    // Any doc can seed a new draft; the original stays untouched. This is
    // the only edit path off a signed document.
    ...(canEditRecords
      ? [{ label: 'Duplicate', onClick: () => void duplicateAgreement(a) }]
      : []),
    ...(canEditRecords && !hasSignature(a)
      ? [{ label: 'Delete', onClick: () => deleteAgreement(a), tone: 'destructive' as const }]
      : []),
  ]

  const statusLabel = (value: string) =>
    leadStatusOptions.find((o) => o.value === value)?.label || value

  const addAutomation = async (templateId: string, triggerStatus: string) => {
    const res = await fetch('/api/crm/agreements/automations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, templateId, triggerStatus }),
    })
    const json = await res.json()
    if (!json.success) {
      toast.error(json.error || 'Could not save the trigger.')
      return
    }
    setAutomations((prev) => [
      json.automation as Automation,
      ...prev.filter((a) => a.id !== (json.automation as Automation).id),
    ])
    setAutoStatus('')
    toast.success('Trigger saved.')
  }

  const removeAutomation = async (id: string) => {
    const res = await fetch(
      `/api/crm/agreements/automations?clientId=${encodeURIComponent(clientId)}&id=${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    )
    const json = await res.json()
    if (!json.success) {
      toast.error(json.error || 'Could not remove the trigger.')
      return
    }
    setAutomations((prev) => prev.filter((a) => a.id !== id))
  }

  const templateMenu = (t: Template): KebabMenuItem[] => [
    ...(canEditRecords
      ? [
          { label: 'Edit', onClick: () => openTemplate(t) },
          {
            label: 'Status trigger',
            onClick: () => {
              setAutoStatus('')
              setAutoTpl(t)
            },
          },
          { label: 'Delete', onClick: () => deleteTemplate(t), tone: 'destructive' as const },
        ]
      : []),
  ]

  // Section banners bleed to the screen edges (cancel the page padding).
  // The floating search/toggle (z-30) rides on top of them when scrolled.
  const sectionHeader = (label: string) => (
    <div className="sticky top-0 z-20 -mx-3 sm:-mx-4 lg:-mx-6 px-3 sm:px-4 lg:px-6 py-2.5 bg-[var(--bg-primary)]/95 backdrop-blur">
      <h2 className="text-sm font-semibold text-[var(--text-secondary)]">{label}</h2>
    </div>
  )

  const gridCls = 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 pt-4 pb-8'

  const q = search.trim().toLowerCase()
  const visibleTemplates = q
    ? templates.filter((t) => t.name.toLowerCase().includes(q))
    : templates
  const visibleAgreements = q
    ? agreements.filter(
        (a) =>
          a.title.toLowerCase().includes(q) ||
          a.signers.some(
            (s) =>
              s.email.toLowerCase().includes(q) ||
              (s.name || '').toLowerCase().includes(q) ||
              (s.signer_name || '').toLowerCase().includes(q),
          ),
      )
    : agreements

  const createRow = (onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center justify-center gap-2 rounded-full border border-dashed border-slate-400 dark:border-[var(--border-primary)] bg-[var(--bg-secondary)] px-4 py-2.5 text-sm font-semibold text-[var(--text-secondary)] hover:border-[#2B79F7] hover:text-[#2B79F7] transition-colors"
    >
      <Plus className="h-4 w-4" /> Create
    </button>
  )

  return (
    // Horizontal padding only - the sticky toolbar owns the top edge so the
    // full-bleed banners sit flush against it.
    <div className="px-3 sm:px-4 lg:px-6 pb-3 sm:pb-4 lg:pb-6 min-h-full animate-in fade-in">
      {/* Doc typography + fonts power the miniature card previews. */}
      <link rel="stylesheet" href={DOC_FONTS_URL} />
      <style dangerouslySetInnerHTML={{ __html: AGREEMENT_DOC_CSS }} />

      {/* Floating sticky controls: search + grid/list toggle. No banner of
          their own - they ride on top of the section banners when scrolled. */}
      <div className="sticky top-2 z-30 flex items-center justify-between gap-2 pt-2 pb-5">
        <p className="hidden sm:block text-sm text-[var(--text-tertiary)] truncate">
          Send contracts and collect signatures online
        </p>
        <div className="relative w-full max-w-[260px] sm:ml-auto">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-tertiary)]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search agreements"
            className="w-full rounded-full border border-[var(--border-primary)] bg-[var(--bg-secondary)] pl-9 pr-4 py-1.5 text-sm text-[var(--text-primary)] outline-none focus:border-[#2B79F7]"
          />
        </div>
        <div className="inline-flex shrink-0 rounded-full bg-[var(--bg-secondary)] border border-[var(--border-primary)] p-1">
          <button
            type="button"
            title="Grid view"
            onClick={() => setViewMode('grid')}
            className={`p-1.5 rounded-full transition-colors ${
              viewMode === 'grid'
                ? 'bg-[#2B79F7] text-white'
                : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
            }`}
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="List view"
            onClick={() => setViewMode('list')}
            className={`p-1.5 rounded-full transition-colors ${
              viewMode === 'list'
                ? 'bg-[#2B79F7] text-white'
                : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
            }`}
          >
            <ListIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Templates */}
      {sectionHeader('Templates')}
      <SlidingViews
        mode={viewMode}
        grid={
          <div className={gridCls}>
            {canEditRecords && <CreateTile onClick={() => openTemplate(null)} />}
            {visibleTemplates.map((t) => (
              <DocCard
                key={t.id}
                bodyHtml={t.body_html}
                title={t.name}
                subtitle={`Updated ${fmtDate(t.updated_at)}`}
                menu={templateMenu(t)}
                onOpen={() => (canEditRecords ? openTemplate(t) : undefined)}
                footerExtra={
                  canEditRecords ? (
                    <Button size="sm" className="rounded-full" onClick={() => openCompose({ template: t })}>
                      Use
                    </Button>
                  ) : undefined
                }
              />
            ))}
          </div>
        }
        list={
          <div className="space-y-2 pt-4 pb-8">
            {canEditRecords && createRow(() => openTemplate(null))}
            {visibleTemplates.map((t) => (
              <Card key={t.id}>
                <CardContent className="p-4 flex items-center justify-between gap-2">
                  <button type="button" onClick={() => canEditRecords && openTemplate(t)} className="min-w-0 text-left">
                    <p className="font-medium text-sm text-[var(--text-primary)] truncate">{t.name}</p>
                    <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
                      Updated {fmtDate(t.updated_at)}
                    </p>
                  </button>
                  <div className="flex items-center gap-1 shrink-0">
                    <KebabMenu items={templateMenu(t)} />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        }
      />

      {/* All agreements */}
      {sectionHeader('All agreements')}
      <SlidingViews
        mode={viewMode}
        grid={
          <div className={gridCls}>
            {canEditRecords && <CreateTile onClick={() => openCompose({})} />}
            {visibleAgreements.map((a) => (
              <DocCard
                key={a.id}
                bodyHtml={a.body_html}
                title={a.title}
                subtitle={agreementSubtitle(a)}
                tag={statusPill(a)}
                menu={agreementMenu(a)}
                onOpen={() => openAgreement(a)}
              />
            ))}
          </div>
        }
        list={
          <div className="space-y-2 pt-4 pb-8">
            {canEditRecords && createRow(() => openCompose({}))}
            {agreements.length === 0 && !canEditRecords && (
              <Card>
                <CardContent className="py-10 text-center">
                  <PenLine className="h-8 w-8 mx-auto text-[var(--text-tertiary)]" />
                  <p className="mt-3 text-sm font-medium text-[var(--text-primary)]">No agreements yet</p>
                </CardContent>
              </Card>
            )}
            {visibleAgreements.map((a) => (
              <Card key={a.id}>
                <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
                  <button type="button" onClick={() => openAgreement(a)} className="min-w-0 text-left">
                    <p className="font-medium text-sm text-[var(--text-primary)] truncate">
                      {a.title}
                    </p>
                    <p className="text-xs text-[var(--text-tertiary)] mt-1">{agreementSubtitle(a)}</p>
                  </button>
                  <div className="flex items-center gap-2 shrink-0">
                    {statusPill(a)}
                    {a.status !== 'draft' && (
                      <>
                        <button
                          type="button"
                          title="Copy view link"
                          onClick={() => copyLink(a)}
                          className="p-2 rounded-full text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
                        >
                          <Copy className="h-4 w-4" />
                        </button>
                        <a
                          href={`/agreement/${a.public_token}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Open"
                          className="p-2 rounded-full text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      </>
                    )}
                    {canEditRecords && <KebabMenu items={agreementMenu(a)} />}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        }
      />
      {confirmModal}

      {/* Status trigger rules for a template: when a lead enters the chosen
          status, a draft is staged from this template (filled from the lead,
          signer prefilled) and the team is notified to review & send. */}
      {autoTpl && (
        <div
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setAutoTpl(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-5 shadow-2xl animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="text-base font-bold text-[var(--text-primary)] truncate">
                  Status trigger
                </h3>
                <p className="mt-0.5 text-xs text-[var(--text-tertiary)] truncate">
                  {autoTpl.name}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAutoTpl(null)}
                className="shrink-0 rounded-full p-1.5 text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
              >
                ✕
              </button>
            </div>

            <p className="mt-3 text-xs text-[var(--text-secondary)] leading-relaxed">
              When a lead enters the chosen status, a draft of this template is
              prepared for that lead and you get notified to review and send.
              Nothing sends without your confirmation.
            </p>

            {leadStatusOptions.length === 0 ? (
              <p className="mt-4 text-xs text-[var(--text-tertiary)]">
                No lead statuses found. Set up status options on the Leads page first.
              </p>
            ) : (
              <div className="mt-4 flex items-center gap-2">
                <select
                  value={autoStatus}
                  onChange={(e) => setAutoStatus(e.target.value)}
                  className="min-w-0 flex-1 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[#2B79F7]"
                >
                  <option value="">When status becomes...</option>
                  {leadStatusOptions
                    .filter(
                      (o) =>
                        !automations.some(
                          (a) => a.template_id === autoTpl.id && a.trigger_status === o.value,
                        ),
                    )
                    .map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                </select>
                <Button
                  size="sm"
                  className="rounded-full shrink-0"
                  disabled={!autoStatus}
                  onClick={() => void addAutomation(autoTpl.id, autoStatus)}
                >
                  Add
                </Button>
              </div>
            )}

            <div className="mt-4 space-y-1.5">
              {automations
                .filter((a) => a.template_id === autoTpl.id)
                .map((a) => (
                  <div
                    key={a.id}
                    className="flex items-center justify-between gap-2 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2"
                  >
                    <span className="min-w-0 truncate text-sm text-[var(--text-primary)]">
                      When status becomes{' '}
                      <span className="font-semibold text-[#2B79F7]">
                        {statusLabel(a.trigger_status)}
                      </span>
                    </span>
                    <button
                      type="button"
                      title="Remove trigger"
                      onClick={() => void removeAutomation(a.id)}
                      className="shrink-0 rounded-full p-1 text-red-500 hover:bg-red-500/10"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              {automations.filter((a) => a.template_id === autoTpl.id).length === 0 && (
                <p className="text-xs text-[var(--text-tertiary)]">No triggers yet.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
