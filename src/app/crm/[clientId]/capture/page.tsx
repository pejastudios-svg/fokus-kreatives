'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { FileUpload } from '@/components/ui/FileUpload'
import { createClient } from '@/lib/supabase/client'
import {
  saveDraftSnapshot,
  loadDraftSnapshot,
  clearDraftSnapshot,
} from '@/lib/draftSnapshot'
import { Skeleton } from '@/components/ui/Loading'
import { Toggle } from '@/components/ui/Toggle'
import { useCrmRole } from '@/components/crm/CrmRoleContext'
import {
  Plus,
  Link as LinkIcon,
  Globe,
  Edit3,
  Trash2,
  CheckCircle,
  X,
  Search,
  Image as ImageIcon,
  ChevronDown,
  Type,
  CircleDot,
  Calendar,
  Package,
  ListChecks,
  FileDown,
  Info,
  RotateCcw,
} from 'lucide-react'
import { KebabMenu } from '@/components/ui/KebabMenu'
import { Tooltip } from '@/components/ui/Tooltip'
import type {
  CaptureReportPage,
  CaptureReportSubmission,
} from '@/components/reports/CaptureReport'
import { LAYOUT_TEMPLATES } from '@/components/capture/layouts'
import { LayoutThumb } from '@/components/capture/LayoutThumb'
import { CapturePagePreview } from '@/components/capture/CapturePagePreview'
import { BrandImageUpload } from '@/components/capture/BrandImageUpload'
import { ThemePicker } from '@/components/capture/ThemePicker'
import { CaptureFieldRow } from '@/components/capture/CaptureFieldRow'
import { CaptureAdvancedAnalytics } from '@/components/capture/CaptureAdvancedAnalytics'
import type { LayoutTemplate, PackageOption } from '@/components/capture/types'

type FieldType =
  | 'text' | 'email' | 'phone' | 'url' | 'textarea'
  | 'select' | 'radio' | 'date' | 'time' | 'embed' | 'package'

type CaptureField = {
  id: string
  type: FieldType
  label: string
  required: boolean
  placeholder?: string
  description?: string
  options?: string[]
  embedUrl?: string
  embedHeight?: number
  repeatable?: boolean
  mapToLead?: boolean
  packages?: PackageOption[]
  sectionId?: string
}

type CaptureSection = {
  id: string
  title?: string
  description?: string
}

const DEFAULT_SECTION_ID = 'section-1'
const MAX_SECTIONS = 10
const makeDefaultSections = (): CaptureSection[] => [
  { id: DEFAULT_SECTION_ID, title: '', description: '' },
]

function normalizeSections(raw: unknown): CaptureSection[] {
  if (Array.isArray(raw) && raw.length) {
    return raw.map((s, i) => {
      const o = (s ?? {}) as Record<string, unknown>
      return {
        id: String(o.id || `section-${i + 1}`),
        title: o.title ? String(o.title) : '',
        description: o.description ? String(o.description) : '',
      }
    })
  }
  return makeDefaultSections()
}

// Make sure every field belongs to a section that exists; orphans land in
// the first section so nothing disappears from the form.
function assignFieldsToSections(
  fields: CaptureField[],
  sections: CaptureSection[],
): CaptureField[] {
  const known = new Set(sections.map((s) => s.id))
  const fallback = sections[0]?.id || DEFAULT_SECTION_ID
  return fields.map((f) => ({
    ...f,
    sectionId: f.sectionId && known.has(f.sectionId) ? f.sectionId : fallback,
  }))
}

type CaptureTheme = {
  background: { type: 'solid' | 'gradient'; color?: string; from?: string; to?: string; direction?: string }
  textMode: 'auto' | 'custom'
  textColor?: string
  fontFamily: 'system' | 'inter' | 'poppins'
}

type MeetingIntegration = 'calendly' | 'google_meet' | 'zoom' | null

interface CapturePage {
  id: string
  client_id: string
  name: string
  slug: string
  headline: string | null
  description: string | null
  lead_magnet_url: string | null
  is_active: boolean
  logo_url: string | null
  banner_url: string | null
  include_meeting: boolean
  calendly_url: string | null
  meeting_integration: MeetingIntegration
  /** Label shown on the success-state CTA button. Null falls back to
   *  "Access Your Free Resource" at render time so existing pages
   *  don't change their copy. */
  success_button_text: string | null
  success_message: string | null
  accent_color: string | null
  /** When true, the public submit endpoint rejects a second submission
   *  from an email that's already been captured on this page. Default
   *  false (allow + dedupe leads). */
  block_duplicate_emails: boolean
  /** Per-page meeting length (minutes) for Google Meet + Zoom flows.
   *  Drives slot generation in the availability picker. */
  meeting_duration_minutes: number
  fields: CaptureField[] | null
  sections: CaptureSection[] | null
  theme: CaptureTheme | null
  layout_template: LayoutTemplate | null
  created_at: string
}

interface SubmissionRow {
  id: string
  capture_page_id: string
  client_id: string
  name: string | null
  email: string | null
  phone: string | null
  notes: string | null
  data: Record<string, unknown>
  /** Snapshot of {fieldId: label} the page had at submission time.
   *  Used by the detail modal so renamed/removed fields still render
   *  with their original labels. Older submissions captured before
   *  this column existed have null here and fall back to the page's
   *  current fields. */
  field_labels: Record<string, string> | null
  /** The visit (capture_sessions row) that produced this submission.
   *  Null for legacy submissions captured before the link existed, or
   *  when the visitor had no session. Deleting the submission also
   *  deletes this session so analytics stays truthful. */
  session_id: string | null
  created_at: string
}

function makeDefaultFields(): CaptureField[] {
  return [
    { id: 'name', type: 'text', label: 'Name', required: true, placeholder: 'Your name' },
    { id: 'email', type: 'email', label: 'Email', required: true, placeholder: 'you@example.com' },
    { id: 'phone', type: 'phone', label: 'Phone', required: true, placeholder: '+1 234 567 890' },
    { id: 'notes', type: 'textarea', label: 'Notes', required: false, placeholder: 'Anything you’d like to share?' },
  ]
}

function makeDefaultTheme(): CaptureTheme {
  return {
    background: { type: 'solid', color: '#f9fafb' },
    textMode: 'auto',
    fontFamily: 'system',
  }
}

function normalizeTheme(t: unknown): CaptureTheme {
  const d = makeDefaultTheme()
  if (!t) return d

  // Supabase JSONB columns sometimes come back as a string (when fetched
  // raw without a parsed type), sometimes as a parsed object. Handle
  // both - mirror what /api/capture/info does for the public page.
  // Without this branch, a string-encoded theme falls through to the
  // typeof !== 'object' check below and we silently revert to defaults,
  // losing the saved cardColor + background + everything else.
  let parsed: unknown = t
  if (typeof t === 'string') {
    try {
      parsed = JSON.parse(t)
    } catch {
      return d
    }
  }
  if (!parsed || typeof parsed !== 'object') return d

  // Spread preserves any property present on the parsed theme - including
  // `cardColor` which isn't in the local CaptureTheme type but rides
  // through at runtime so the picker can read it back. The shared
  // CaptureTheme type (used by ThemePicker) carries the cardColor field.
  const theme = parsed as Partial<CaptureTheme> & { cardColor?: string | null }
  return {
    ...d,
    ...theme,
    background: {
      ...d.background,
      ...(theme.background && typeof theme.background === 'object' ? theme.background : {}),
    },
  }
}

interface RawField {
  id?: unknown;
  type?: unknown;
  label?: unknown;
  required?: unknown;
  placeholder?: unknown;
  description?: unknown;
  options?: unknown;
  embedUrl?: unknown;
  embedHeight?: unknown;
  repeatable?: unknown;
  mapToLead?: unknown;
  packages?: unknown;
  sectionId?: unknown;
}

function normalizeFields(f: unknown): CaptureField[] {
  const d = makeDefaultFields()
  if (!Array.isArray(f) || f.length === 0) return d

  // Ensure required is always boolean and options array is valid when needed
  return (f as RawField[]).map((x) => ({
    id: String(x.id || `field-${Date.now()}`),
    type: (x.type as FieldType) || 'text',
    label: String(x.label || 'Field'),
    required: !!x.required,
    placeholder: x.placeholder ? String(x.placeholder) : undefined,
    description: x.description ? String(x.description) : undefined,
    options: Array.isArray(x.options) ? (x.options as unknown[]).map(String) : undefined,
    embedUrl: x.embedUrl ? String(x.embedUrl) : undefined,
    embedHeight: x.embedHeight ? Number(x.embedHeight) : undefined,
    repeatable: x.repeatable ? true : undefined,
    mapToLead: x.mapToLead ? true : undefined,
    packages: Array.isArray(x.packages)
      ? (x.packages as Array<Record<string, unknown>>).map((p, i) => ({
          id: String(p.id || `pkg-${i}`),
          name: String(p.name || ''),
          subtitle: p.subtitle ? String(p.subtitle) : undefined,
          price: p.price ? String(p.price) : undefined,
          features: Array.isArray(p.features)
            ? (p.features as unknown[]).map(String)
            : undefined,
        }))
      : undefined,
    sectionId: x.sectionId ? String(x.sectionId) : undefined,
  }))
}

// The account's "main scheduling page" URL, derived from any event type's
// scheduling URL (Calendly events live at calendly.com/<user>/<event>, so
// dropping the event slug yields the host page that lists every event).
// Used so the "Main scheduling page" option embeds a real URL instead of
// nothing.
function deriveMainSchedulingUrl(
  eventTypes: { scheduling_url: string }[] | null,
): string {
  const first = eventTypes?.[0]?.scheduling_url
  if (!first) return ''
  try {
    const u = new URL(first)
    const parts = u.pathname.split('/').filter(Boolean)
    if (parts.length >= 2) parts.pop()
    return `${u.origin}/${parts.join('/')}`.replace(/\/$/, '')
  } catch {
    return ''
  }
}

// Trim + drop blank lines from the "one per line" lists right before saving.
// The editor keeps them raw while typing (so Space/Enter aren't eaten); this
// is where they get tidied so the stored data and public page stay clean.
function cleanFieldsForSave(fields: CaptureField[]): CaptureField[] {
  return fields.map((f) => {
    const out: CaptureField = { ...f }
    if (out.options) {
      out.options = out.options.map((o) => o.trim()).filter(Boolean)
    }
    if (out.packages) {
      out.packages = out.packages.map((p) => ({
        ...p,
        name: (p.name || '').trim(),
        subtitle: p.subtitle?.trim() || undefined,
        price: p.price?.trim() || undefined,
        features: (p.features || []).map((x) => x.trim()).filter(Boolean),
      }))
    }
    return out
  })
}

export default function CRMCapturePages() {
  const params = useParams()
  const clientId = (params?.clientId || params?.clientid) as string
  // Deep-link from the Inbox: `?tab=submissions&focus=<submissionId>`
  // switches to the Submissions tab on mount + opens the detail modal
  // for that submission once submissions load. Tracked in a ref-like
  // state so we only consume it once - subsequent navigations within
  // the page (manual tab switches, search) shouldn't re-trigger it.
  const searchParams = useSearchParams()
  const initialTab = searchParams?.get('tab')
  const initialFocus = searchParams?.get('focus')
  const supabase = createClient()

  const [tab, setTab] = useState<'pages' | 'submissions'>(
    initialTab === 'submissions' ? 'submissions' : 'pages',
  )
  const [pendingFocusSubmissionId, setPendingFocusSubmissionId] = useState<string | null>(
    initialTab === 'submissions' ? initialFocus : null,
  )
  const [selectedSubmission, setSelectedSubmission] = useState<SubmissionRow | null>(null)
  // Capture pages are workspace structure (they shape lead intake), so
  // editing is manager+ - matches the leads custom-fields gate.
  // Employees see pages + submissions but can't create / edit / delete.
  // Role comes from the CrmRoleProvider in CRMLayout (sourced from the
  // service-role auth route, so it's correct even for users whose
  // membership row is RLS-hidden from a browser query).
  const { canEditWorkspace: canEditCapture, workspaceName } = useCrmRole()
  const [isExporting, setIsExporting] = useState(false)

  // pages
  const [pages, setPages] = useState<CapturePage[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingPage, setEditingPage] = useState<CapturePage | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [notification, setNotification] = useState<string | null>(null)
  const [copyingId, setCopyingId] = useState<string | null>(null)
  const [pageToDelete, setPageToDelete] = useState<CapturePage | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  // slug validation
  const [slugError, setSlugError] = useState<string | null>(null)

  // submissions
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [submissions, setSubmissions] = useState<SubmissionRow[]>([])
  const [submissionToDelete, setSubmissionToDelete] = useState<SubmissionRow | null>(null)
  const [deletingSubmission, setDeletingSubmission] = useState(false)
  const [subLoading, setSubLoading] = useState(false)
  const [subSearch, setSubSearch] = useState('')
  const [subPageId, setSubPageId] = useState<string>('') // filter by page
  const [stats, setStats] = useState({ submissions: 0, leads: 0, meetings: 0 })
  // Bumped after a delete / reset so the advanced analytics panel refetches
  // its session-derived metrics instead of showing the pre-delete numbers.
  const [analyticsRefreshKey, setAnalyticsRefreshKey] = useState(0)
  const [confirmResetAnalytics, setConfirmResetAnalytics] = useState(false)
  const [resettingAnalytics, setResettingAnalytics] = useState(false)

  // Public capture URL base. On localhost we ALWAYS use the current
  // window origin so dev links open the local dev server (e.g.
  // http://localhost:3000/capture/<slug>). Anywhere else we prefer the
  // canonical NEXT_PUBLIC_APP_URL so prod / preview deploys hand out
  // the right domain in the Copy Link button.
  const appUrl = (() => {
    if (typeof window === 'undefined') return process.env.NEXT_PUBLIC_APP_URL || ''
    const host = window.location.hostname
    const isLocal = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local')
    if (isLocal) return window.location.origin
    return process.env.NEXT_PUBLIC_APP_URL || window.location.origin
  })()

  const [form, setForm] = useState<{
    name: string
    slug: string
    headline: string
    description: string
    lead_magnet_url: string
    logo_url: string
    banner_url: string
    is_active: boolean
    include_meeting: boolean
    calendly_url: string
    meeting_integration: MeetingIntegration
    success_button_text: string
    success_message: string
    accent_color: string
    block_duplicate_emails: boolean
    meeting_duration_minutes: number
    fields: CaptureField[]
    sections: CaptureSection[]
    theme: CaptureTheme
    layout_template: LayoutTemplate
  }>({
    name: '',
    slug: '',
    headline: '',
    description: '',
    lead_magnet_url: '',
    logo_url: '',
    banner_url: '',
    is_active: true,
    include_meeting: false,
    calendly_url: '',
    meeting_integration: null,
    success_button_text: '',
    success_message: '',
    accent_color: '',
    block_duplicate_emails: false,
    meeting_duration_minutes: 30,
    fields: assignFieldsToSections(normalizeFields(makeDefaultFields()), makeDefaultSections()),
    sections: makeDefaultSections(),
    theme: normalizeTheme(makeDefaultTheme()),
    layout_template: 'compact',
  })

  // Connected meeting integrations for THIS CRM. Used by the editor's
  // Meeting section to populate the integration picker (only providers
  // that are actually wired up appear as selectable). Loaded once per
  // CRM via /api/integrations/list.
  const [connectedIntegrations, setConnectedIntegrations] = useState<
    Array<'calendly' | 'google_meet' | 'zoom'>
  >([])

  // Calendly event types belonging to the connected account. Loaded
  // lazily the first time Calendly is picked as the meeting provider
  // so we don't hit Calendly's API on every modal open. Lets users
  // embed a SPECIFIC event (e.g. "Onboarding Call") instead of their
  // main scheduling page (which lists every event).
  interface CalendlyEventTypeBrief {
    uri: string
    name: string
    slug: string
    scheduling_url: string
    duration: number
  }
  const [calendlyEventTypes, setCalendlyEventTypes] = useState<CalendlyEventTypeBrief[] | null>(null)
  const [loadingEventTypes, setLoadingEventTypes] = useState(false)
  const mainSchedulingUrl = deriveMainSchedulingUrl(calendlyEventTypes)

  useEffect(() => {
    if (!clientId) return
    let cancelled = false
    fetch(`/api/integrations/list?clientId=${encodeURIComponent(clientId)}`, {
      cache: 'no-store',
    })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled || !data?.success) return
        const connected = (data.integrations as Array<{ provider: string; status: string }>)
          .filter((i) => i.status === 'connected')
          .map((i) => i.provider as 'calendly' | 'google_meet' | 'zoom')
        setConnectedIntegrations(connected)
      })
      .catch(() => {
        // Non-fatal: the picker just shows "none" if list fails.
      })
    return () => {
      cancelled = true
    }
  }, [clientId])

  // Fetch event types the first time Calendly is selected. We cache
  // the result for the lifetime of the page; the editor refreshes
  // when the user navigates away and back.
  useEffect(() => {
    if (form.meeting_integration !== 'calendly') return
    if (calendlyEventTypes !== null) return
    if (loadingEventTypes) return
    if (!connectedIntegrations.includes('calendly')) return
    setLoadingEventTypes(true)
    fetch(`/api/integrations/calendly/event-types?clientId=${encodeURIComponent(clientId)}`, {
      cache: 'no-store',
    })
      .then((r) => r.json())
      .then((data) => {
        if (data?.success) setCalendlyEventTypes(data.eventTypes || [])
        else setCalendlyEventTypes([])
      })
      .catch(() => setCalendlyEventTypes([]))
      .finally(() => setLoadingEventTypes(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.meeting_integration, connectedIntegrations])

  // Default to the main scheduling page once event types load: with Calendly
  // selected and no specific event chosen, fill calendly_url with the host
  // page so the preview (and the saved/public page) actually embed it instead
  // of rendering nothing.
  useEffect(() => {
    if (form.meeting_integration !== 'calendly') return
    if (!mainSchedulingUrl) return
    if (form.calendly_url) return
    setForm((prev) =>
      prev.meeting_integration === 'calendly' && !prev.calendly_url
        ? { ...prev, calendly_url: mainSchedulingUrl }
        : prev,
    )
  }, [form.meeting_integration, form.calendly_url, mainSchedulingUrl])

  useEffect(() => {
    if (clientId) loadPages()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId])

  const loadPages = async () => {
    setIsLoading(true)
    const { data, error } = await supabase
      .from('capture_pages')
      .select('*')
      .eq('client_id', clientId)
      // Newest first so a freshly created page lands at the top of the list.
      .order('created_at', { ascending: false })

    if (error) console.error('Failed to load capture pages:', error)
    setPages((data || []) as CapturePage[])
    setIsLoading(false)
  }

  const checkSlugAvailability = async (slug: string) => {
    if (!slug || editingPage) return
    const { data, error } = await supabase
      .from('capture_pages')
      .select('id')
      .eq('slug', slug)
      .eq('client_id', clientId)

    if (error) {
      console.error('Error checking slug:', error)
      return
    }

    if (data && data.length > 0) setSlugError(`Slug "${slug}" is already taken.`)
    else setSlugError(null)
  }

  const handleSlugChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setForm((prev) => ({ ...prev, slug: value }))
    setTimeout(() => checkSlugAvailability(value), 350)
  }

  const openNewModal = () => {
    setEditingPage(null)
    setSlugError(null)
    setForm({
      name: '',
      slug: '',
      headline: '',
      description: '',
      lead_magnet_url: '',
      logo_url: '',
      banner_url: '',
      is_active: true,
      include_meeting: false,
      calendly_url: '',
      meeting_integration: null,
      success_button_text: '',
      success_message: '',
      accent_color: '',
      block_duplicate_emails: false,
      meeting_duration_minutes: 30,
      fields: assignFieldsToSections(makeDefaultFields(), makeDefaultSections()),
      sections: makeDefaultSections(),
      theme: makeDefaultTheme(),
      layout_template: 'compact',
    })
    setShowModal(true)
  }

  const openEditModal = (page: CapturePage) => {
    setEditingPage(page)
    setSlugError(null)
    setForm({
      name: page.name || '',
      slug: page.slug || '',
      headline: page.headline || '',
      description: page.description || '',
      lead_magnet_url: page.lead_magnet_url || '',
      logo_url: page.logo_url || '',
      banner_url: page.banner_url || '',
      is_active: page.is_active,
      include_meeting: page.include_meeting ?? false,
      calendly_url: page.calendly_url || '',
      meeting_integration: page.meeting_integration ?? null,
      success_button_text: page.success_button_text || '',
      success_message: page.success_message || '',
      accent_color: page.accent_color || '',
      block_duplicate_emails: !!page.block_duplicate_emails,
      meeting_duration_minutes:
        typeof page.meeting_duration_minutes === 'number'
          ? page.meeting_duration_minutes
          : 30,
      fields: assignFieldsToSections(normalizeFields(page.fields), normalizeSections(page.sections)),
      sections: normalizeSections(page.sections),
      theme: normalizeTheme(page.theme),
      layout_template: (page.layout_template ?? 'compact') as LayoutTemplate,
    })
    setShowModal(true)
  }

  const handleFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target
    setForm((prev) => ({ ...prev, [name]: value }))

    if (!editingPage && name === 'name' && !form.slug) {
      const slug = value
        .toLowerCase()
        .trim()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
      setForm((prev) => ({ ...prev, slug }))
      setTimeout(() => checkSlugAvailability(slug), 350)
    }
  }

  // ----- Field builder helpers -----
  const addField = (type: FieldType, sectionId: string) => {
    const id = `field-${Date.now()}`
    const base: CaptureField = {
      id,
      type,
      label:
        type === 'text' ? 'Text' :
        type === 'email' ? 'Email' :
        type === 'phone' ? 'Phone' :
        type === 'url' ? 'Link' :
        type === 'textarea' ? 'Long text' :
        type === 'select' ? 'Dropdown' :
        type === 'radio' ? 'Options' :
        type === 'date' ? 'Date' :
        type === 'time' ? 'Time' :
        type === 'package' ? 'Choose a package' :
        'Embed',
      required: false,
      placeholder: type === 'url' ? 'https://…' : 'Type here…',
      options: (type === 'select' || type === 'radio') ? ['Option 1', 'Option 2'] : undefined,
      embedUrl: type === 'embed' ? 'https://www.loom.com/share/your-video-id' : undefined,
      embedHeight: type === 'embed' ? 520 : undefined,
      packages:
        type === 'package'
          ? [
              {
                id: crypto.randomUUID(),
                name: 'Starter',
                subtitle: 'Individual',
                price: '$29/mo',
                features: ['Feature one', 'Feature two', 'Feature three'],
              },
              {
                id: crypto.randomUUID(),
                name: 'Premium',
                subtitle: 'Business',
                price: '$49/mo',
                features: ['Everything in Starter', 'Priority support', 'Custom reports'],
              },
            ]
          : undefined,
      sectionId,
    }

    setForm((prev) => ({ ...prev, fields: [...prev.fields, base] }))
  }

  // ----- Section helpers -----
  const addSection = () => {
    setForm((prev) => {
      if (prev.sections.length >= MAX_SECTIONS) return prev
      const id = `section-${Date.now()}`
      return { ...prev, sections: [...prev.sections, { id, title: '', description: '' }] }
    })
  }

  const updateSection = (id: string, patch: Partial<CaptureSection>) => {
    setForm((prev) => ({
      ...prev,
      sections: prev.sections.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    }))
  }

  const removeSection = (id: string) => {
    setForm((prev) => {
      if (prev.sections.length <= 1) return prev
      const idx = prev.sections.findIndex((s) => s.id === id)
      // Move this section's fields into a neighbour so nothing is lost.
      const fallback = (prev.sections[idx === 0 ? 1 : idx - 1] ?? prev.sections[0]).id
      return {
        ...prev,
        sections: prev.sections.filter((s) => s.id !== id),
        fields: prev.fields.map((f) => (f.sectionId === id ? { ...f, sectionId: fallback } : f)),
      }
    })
  }

  const moveFieldToSection = (fieldId: string, sectionId: string) => {
    setForm((prev) => ({
      ...prev,
      fields: prev.fields.map((f) => (f.id === fieldId ? { ...f, sectionId } : f)),
    }))
  }

  const updateField = (id: string, patch: Partial<CaptureField>) => {
    setForm((prev) => ({
      ...prev,
      fields: prev.fields.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    }))
  }

  const removeField = (id: string) => {
    setForm((prev) => ({ ...prev, fields: prev.fields.filter((f) => f.id !== id) }))
  }

  const moveField = (id: string, dir: -1 | 1) => {
    setForm((prev) => {
      const idx = prev.fields.findIndex((f) => f.id === id)
      if (idx < 0) return prev
      // Swap with the nearest field in the SAME section so reordering stays
      // inside the step the field belongs to.
      const sec = prev.fields[idx].sectionId
      let j = idx + dir
      while (j >= 0 && j < prev.fields.length && prev.fields[j].sectionId !== sec) j += dir
      if (j < 0 || j >= prev.fields.length) return prev
      const copy = [...prev.fields]
      ;[copy[idx], copy[j]] = [copy[j], copy[idx]]
      return { ...prev, fields: copy }
    })
  }

  // ---- Drag-to-reorder fields. Parent owns the drag state so the
  // dragged-row + drop-target highlights stay in sync across the
  // list. The global useDragAutoScroll hook (mounted in (app)/layout)
  // scrolls the modal's left pane when the cursor nears the edge. ---
  const [draggedFieldId, setDraggedFieldId] = useState<string | null>(null)
  const [dragOverFieldId, setDragOverFieldId] = useState<string | null>(null)

  const handleFieldDragStart = (id: string) => {
    setDraggedFieldId(id)
  }
  const handleFieldDragOver = (id: string) => {
    if (draggedFieldId && draggedFieldId !== id) {
      setDragOverFieldId(id)
    }
  }
  const handleFieldDropOn = (targetId: string) => {
    if (!draggedFieldId || draggedFieldId === targetId) {
      setDraggedFieldId(null)
      setDragOverFieldId(null)
      return
    }
    setForm((prev) => {
      const fromIdx = prev.fields.findIndex((f) => f.id === draggedFieldId)
      const toIdx = prev.fields.findIndex((f) => f.id === targetId)
      if (fromIdx < 0 || toIdx < 0) return prev
      const copy = [...prev.fields]
      const [picked] = copy.splice(fromIdx, 1)
      copy.splice(toIdx, 0, picked)
      return { ...prev, fields: copy }
    })
    setDraggedFieldId(null)
    setDragOverFieldId(null)
  }
  const handleFieldDragEnd = () => {
    setDraggedFieldId(null)
    setDragOverFieldId(null)
  }

  // ---- Refresh/offline insurance for the editor modal. The working form
  // snapshots to localStorage on every change: a refresh or crash reopens
  // the modal with everything intact, and a failed save retries by itself
  // when the connection comes back. Explicit close (X) discards. ----
  const captureSnapshotKey = `fk:capture:editor:${clientId}`
  const captureRestoredRef = useRef(false)
  const pendingRetryRef = useRef(false)
  const handleSaveRef = useRef<() => void>(() => {})

  useEffect(() => {
    if (!showModal) return
    const t = setTimeout(() => {
      saveDraftSnapshot(captureSnapshotKey, {
        editingPageId: editingPage?.id || null,
        form,
      })
    }, 350)
    return () => clearTimeout(t)
  }, [showModal, editingPage, form, captureSnapshotKey])

  useEffect(() => {
    if (isLoading || captureRestoredRef.current) return
    captureRestoredRef.current = true
    const snap = loadDraftSnapshot<{ editingPageId: string | null; form: typeof form }>(
      captureSnapshotKey,
    )
    if (!snap?.form) return
    setEditingPage(
      snap.editingPageId ? pages.find((p) => p.id === snap.editingPageId) || null : null,
    )
    setForm(snap.form)
    setShowModal(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, pages])

  useEffect(() => {
    const onOnline = () => {
      if (pendingRetryRef.current && showModal) {
        pendingRetryRef.current = false
        handleSaveRef.current()
      }
    }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [showModal])

  const handleSave = async () => {
    if (!form.name || !form.slug) return
    if (slugError) return

    setIsSaving(true)
    try {
      if (editingPage) {
        const { error } = await supabase
          .from('capture_pages')
          .update({
            name: form.name,
            slug: form.slug,
            headline: form.headline || null,
            description: form.description || null,
            lead_magnet_url: form.lead_magnet_url || null,
            logo_url: form.logo_url || null,
            banner_url: form.banner_url || null,
            is_active: form.is_active,
            include_meeting: form.include_meeting,
            calendly_url: form.calendly_url || null,
            meeting_integration: form.meeting_integration,
            success_button_text: form.success_button_text || null,
            success_message: form.success_message || null,
            accent_color: form.accent_color || null,
            block_duplicate_emails: form.block_duplicate_emails,
            meeting_duration_minutes: form.meeting_duration_minutes || 30,
            fields: cleanFieldsForSave(form.fields),
            sections: form.sections,
            theme: form.theme,
            layout_template: form.layout_template,
          })
          .eq('id', editingPage.id)

        if (error) {
          // Some Postgrest error shapes have non-enumerable fields,
          // which makes a naive console.error print `{}`. We pull the
          // common fields explicitly AND fall back to JSON.stringify
          // with the Error-property reflector so nothing is lost
          // regardless of how the SDK packaged the failure.
          const errBag = {
            message: error.message,
            code: error.code,
            details: error.details,
            hint: error.hint,
            raw: JSON.stringify(error, Object.getOwnPropertyNames(error)),
          }
          console.error('Update capture page error:', errBag)
          // Likely offline: the working copy stays snapshotted on this
          // device and the save retries when the connection returns.
          pendingRetryRef.current = true
          setNotification(`Error: ${error.message || error.details || 'Update failed - check console'}`)
          setTimeout(() => setNotification(null), 4000)
        } else {
          clearDraftSnapshot(captureSnapshotKey)
          setNotification('Capture page updated')
          setTimeout(() => setNotification(null), 3000)
          setShowModal(false)
          await loadPages()
        }
      } else {
        // slug uniqueness check
        const { data: existing } = await supabase
          .from('capture_pages')
          .select('id')
          .eq('slug', form.slug)
          .eq('client_id', clientId)

        if (existing && existing.length > 0) {
          setNotification(`Slug "${form.slug}" is already taken.`)
          setTimeout(() => setNotification(null), 3000)
          setIsSaving(false)
          return
        }

        const { error } = await supabase.from('capture_pages').insert({
          client_id: clientId,
          name: form.name,
          slug: form.slug,
          headline: form.headline || null,
          description: form.description || null,
          lead_magnet_url: form.lead_magnet_url || null,
          logo_url: form.logo_url || null,
          banner_url: form.banner_url || null,
          is_active: form.is_active,
          include_meeting: form.include_meeting,
          calendly_url: form.calendly_url || null,
          meeting_integration: form.meeting_integration,
          success_button_text: form.success_button_text || null,
          success_message: form.success_message || null,
          accent_color: form.accent_color || null,
          block_duplicate_emails: form.block_duplicate_emails,
          meeting_duration_minutes: form.meeting_duration_minutes || 30,
          fields: cleanFieldsForSave(form.fields),
          sections: form.sections,
          theme: form.theme,
          layout_template: form.layout_template,
        })

        if (error) {
          console.error('Create capture page error:', {
            message: error.message,
            code: error.code,
            details: error.details,
            hint: error.hint,
          })
          pendingRetryRef.current = true
          setNotification(`Error: ${error.message || 'Create failed'}`)
          setTimeout(() => setNotification(null), 3000)
        } else {
          clearDraftSnapshot(captureSnapshotKey)
          setNotification('Capture page created')
          setTimeout(() => setNotification(null), 3000)
          setShowModal(false)
          await loadPages()
        }
      }
    } finally {
      setIsSaving(false)
    }
  }

  // Keep the online-retry hook pointed at the latest save closure.
  useEffect(() => {
    handleSaveRef.current = () => void handleSave()
  })

  const handleDelete = async () => {
    if (!pageToDelete) return
    setIsDeleting(true)

    const id = pageToDelete.id
    const prev = pages
    setPages((p) => p.filter((x) => x.id !== id))

    const { error } = await supabase.from('capture_pages').delete().eq('id', id)
    if (error) {
      console.error('Delete capture page error:', error)
      setPages(prev)
    }

    setIsDeleting(false)
    setPageToDelete(null)
  }

  const handleCopyLink = async (page: CapturePage) => {
    const url = `${appUrl}/capture/${page.slug}`
    await navigator.clipboard.writeText(url)
    setCopyingId(page.id)
    setTimeout(() => setCopyingId(null), 2000)
  }

  // ----- Submissions tab -----
  const loadSubmissions = async () => {
    setSubLoading(true)
    try {
      let q = supabase
        .from('capture_submissions')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })

      if (subPageId) q = q.eq('capture_page_id', subPageId)

      const { data, error } = await q
      if (error) {
        console.error('Load submissions error:', error)
        setSubmissions([])
      } else {
        setSubmissions((data || []) as SubmissionRow[])
      }
    } finally {
      setSubLoading(false)
    }
  }

  const loadStatsForPage = async (pageId: string) => {
    const page = pages.find((p) => p.id === pageId)
    if (!page) {
      setStats({ submissions: 0, leads: 0, meetings: 0 })
      return
    }

    const slug = page.slug
    const source = `capture:${slug}`

    // submissions count for this page
    const { data: subRows } = await supabase
      .from('capture_submissions')
      .select('id')
      .eq('client_id', clientId)
      .eq('capture_page_id', pageId)

    const submissionsCount = subRows ? subRows.length : 0

    // leads created from this capture page
    const { data: leadsRows } = await supabase
      .from('leads')
      .select('id')
      .eq('client_id', clientId)
      .filter('data->>source', 'eq', source)

    const leadsCount = leadsRows ? leadsRows.length : 0

    // meetings created from this capture page (based on title pattern you already use)
    const { data: meetingRows } = await supabase
      .from('meetings')
      .select('id')
      .eq('client_id', clientId)
      .ilike('title', `%from ${slug}%`)

    const meetingsCount = meetingRows ? meetingRows.length : 0

    setStats({ submissions: submissionsCount, leads: leadsCount, meetings: meetingsCount })
  }

  useEffect(() => {
    if (tab === 'submissions') {
      loadSubmissions()
      if (subPageId) loadStatsForPage(subPageId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, subPageId])

  // Once submissions resolve, pop the detail modal for the
  // deep-linked submission (?focus=<id> from Inbox). Consume the
  // pending id so we don't re-open the modal if the user closes it.
  useEffect(() => {
    if (!pendingFocusSubmissionId) return
    const match = submissions.find((s) => s.id === pendingFocusSubmissionId)
    if (match) {
      setSelectedSubmission(match)
      setPendingFocusSubmissionId(null)
    }
  }, [submissions, pendingFocusSubmissionId])

  const filteredSubmissions = useMemo(() => {
    const q = subSearch.trim().toLowerCase()
    if (!q) return submissions
    return submissions.filter((s) => {
      const hay = `${s.name || ''} ${s.email || ''} ${s.phone || ''} ${s.notes || ''} ${JSON.stringify(s.data || {})}`.toLowerCase()
      return hay.includes(q)
    })
  }, [submissions, subSearch])

  function buildFieldLabelMap(fields: CaptureField[] | null | undefined): Record<string, string> {
  const map: Record<string, string> = {}
  if (!Array.isArray(fields)) return map
  for (const f of fields) {
    if (!f?.id) continue
    map[String(f.id)] = String(f.label || f.id)
  }
  return map
}

function prettyKey(k: string) {
  return k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

const deleteSubmission = async () => {
  if (!submissionToDelete) return
  setDeletingSubmission(true)

  const id = submissionToDelete.id
  const sessionId = submissionToDelete.session_id
  const prev = submissions
  setSubmissions((s) => s.filter((x) => x.id !== id))

  try {
    const { error } = await supabase
      .from('capture_submissions')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Delete submission error:', error)
      setSubmissions(prev) // rollback
    } else {
      // Full cascade: remove the visit that produced this submission so
      // Visits / Unique Visitors / Avg Time / conversion drop with it.
      // Best-effort - legacy rows have no session_id, nothing to clean up.
      if (sessionId) {
        const { error: sessErr } = await supabase
          .from('capture_sessions')
          .delete()
          .eq('id', sessionId)
        if (sessErr) console.error('Delete linked session error:', sessErr)
      }

      // Refresh stats either way: removing the row changes the submission
      // count + trend even when there's no linked session to delete.
      setAnalyticsRefreshKey((k) => k + 1)
      if (subPageId) loadStatsForPage(subPageId)
    }
  } finally {
    setDeletingSubmission(false)
    setSubmissionToDelete(null)
  }
}

// Wipe the visit analytics (capture_sessions) for the current page. Used
// to zero out legacy data that predates the submission<->session link, or
// to clear a clean slate. Leaves submission rows (captured leads) intact -
// once sessions are gone the Submissions stat reflects the actual rows.
const resetAnalytics = async () => {
  if (!subPageId || !canEditCapture) return
  setResettingAnalytics(true)
  try {
    const { error } = await supabase
      .from('capture_sessions')
      .delete()
      .eq('capture_page_id', subPageId)
    if (error) {
      console.error('Reset analytics error:', error)
    } else {
      setAnalyticsRefreshKey((k) => k + 1)
      loadStatsForPage(subPageId)
    }
  } finally {
    setResettingAnalytics(false)
    setConfirmResetAnalytics(false)
  }
}

  // ---- PDF export -----------------------------------------------------

  const handleExportPdf = async () => {
    if (isExporting) return
    setIsExporting(true)
    try {
      const [{ pdf }, { CaptureReport }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('@/components/reports/CaptureReport'),
      ])

      const subsByPage = new Map<string, number>()
      for (const s of submissions) {
        subsByPage.set(
          s.capture_page_id,
          (subsByPage.get(s.capture_page_id) || 0) + 1,
        )
      }

      const reportPages: CaptureReportPage[] = pages.map((p) => ({
        name: p.name,
        slug: p.slug,
        isActive: p.is_active,
        submissionCount: subsByPage.get(p.id) || 0,
        createdDate: p.created_at,
      }))

      const pageNameById = new Map(pages.map((p) => [p.id, p.name]))

      // Latest 50 submissions, most recent first.
      const sortedSubs = [...submissions].sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      )
      const reportSubs: CaptureReportSubmission[] = sortedSubs
        .slice(0, 50)
        .map((s) => ({
          pageName: pageNameById.get(s.capture_page_id) || '-',
          name: s.name,
          email: s.email,
          phone: s.phone,
          whenIso: s.created_at,
        }))

      const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
      const submissions30d = submissions.filter(
        (s) => new Date(s.created_at).getTime() >= thirtyDaysAgo,
      ).length

      const blob = await pdf(
        <CaptureReport
          workspaceName={workspaceName}
          filters={[]}
          metrics={{
            totalPages: pages.length,
            activePages: pages.filter((p) => p.is_active).length,
            totalSubmissions: submissions.length,
            submissions30d,
          }}
          pages={reportPages}
          submissions={reportSubs}
        />,
      ).toBlob()

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const stamp = new Date().toISOString().slice(0, 10)
      a.download = `${workspaceName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-capture-${stamp}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (err) {
      console.error('Capture PDF export failed:', err)
      alert('Could not generate PDF. Check the console for details.')
    } finally {
      setIsExporting(false)
    }
  }

function CaptureSkeleton() {
  // Renders inside the Pages tab body - the page-level header and
  // the Pages/Submissions tab strip are already shown above by the
  // real component, so we only mirror the page card rows here. Each
  // row shows three icon-button skeletons (copy-link, edit, delete)
  // matching the icon-only treatment.
  return (
    <div className="space-y-3 animate-in fade-in">
      {[1, 2, 3].map((i) => (
        <Card key={i} className="bg-[var(--bg-card)] border-[var(--border-primary)]">
          <CardContent className="p-5 flex items-start justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0 flex-1">
              <Skeleton className="h-11 w-11 rounded-lg bg-[var(--bg-card-hover)] shrink-0" />
              <div className="space-y-2 min-w-0 flex-1">
                <div className="flex gap-2">
                  <Skeleton className="h-4 w-24 sm:w-32 bg-[var(--bg-card-hover)]" />
                  <Skeleton className="h-4 w-12 sm:w-16 rounded-full bg-[var(--bg-card-hover)]" />
                </div>
                <Skeleton className="h-3 w-32 sm:w-48 bg-[var(--bg-card-hover)]" />
                <Skeleton className="hidden sm:block h-3 w-64 bg-[var(--bg-card-hover)]" />
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Skeleton className="h-8 w-8 rounded-lg bg-[var(--bg-card-hover)]" />
              <Skeleton className="h-8 w-8 rounded-lg bg-[var(--bg-card-hover)]" />
              <Skeleton className="h-8 w-8 rounded-lg bg-[var(--bg-card-hover)]" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

  return <div className="p-3 sm:p-4 lg:p-6 min-h-full">
        {notification && (
          <div className="mb-4 p-3 rounded-lg bg-green-50 text-green-700 flex items-center gap-2">
            <CheckCircle className="h-4 w-4" />
            <span className="text-sm">{notification}</span>
          </div>
        )}

        {/* Header: copy on the left, kebab on the right. The
            Pages/Submissions switch lives below as proper underline
            tabs (replacing the pill-button pair). New Capture Page
            moved into the kebab so the top bar stays clean. */}
        <div className="flex items-center justify-between gap-3 mb-4">
          <p className="text-xs text-[var(--text-tertiary)]">Build pages to capture leads</p>
          <KebabMenu
            items={[
              ...(canEditCapture
                ? [
                    {
                      label: 'New Capture Page',
                      icon: <Plus className="h-4 w-4" />,
                      onClick: openNewModal,
                    },
                  ]
                : []),
              {
                label: isExporting ? 'Generating PDF…' : 'Export as PDF',
                icon: <FileDown className="h-4 w-4" />,
                disabled: isExporting,
                onClick: handleExportPdf,
              },
            ]}
          />
        </div>

        <div className="flex items-center gap-6 border-b border-[var(--border-primary)] mb-5">
          {(['pages', 'submissions'] as const).map((t) => {
            const active = tab === t
            return (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`relative pb-3 text-sm font-medium capitalize transition-colors ${
                  active
                    ? 'text-[#2B79F7]'
                    : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
                }`}
              >
                {t}
                {active && (
                  <span className="absolute -bottom-px left-0 right-0 h-0.5 bg-[#2B79F7] rounded-full" />
                )}
              </button>
            )
          })}
        </div>

        {tab === 'pages' && (
          <>
            {isLoading ? (
              <CaptureSkeleton />
            ) : pages.length === 0 ? (
              <Card>
                <CardContent className="py-10 text-center text-[var(--text-tertiary)]">
                  <p className="text-sm">No capture pages yet. Create one to start collecting leads.</p>
                  {canEditCapture && (
                    <div className="mt-4 flex justify-center">
                      <Button onClick={openNewModal}>
                        <Plus className="h-4 w-4 mr-1.5" />
                        New Capture Page
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {pages.map((page) => {
                  const publicUrl = `${appUrl}/capture/${page.slug}`
                  return (
                    <Card key={page.id} className="bg-[var(--bg-card)] border-[var(--border-primary)]">
                      <CardContent className="p-5 flex items-start justify-between gap-4">
                        <div className="flex items-start gap-3 min-w-0">
                          <div className="p-3 rounded-lg bg-[var(--bg-secondary)] shrink-0">
                            <Globe className="h-5 w-5 text-[#2B79F7]" />
                          </div>

                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2 mb-1">
                              <h3 className="text-[var(--text-primary)] font-semibold truncate">{page.name}</h3>
                              <span
                                className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                                  page.is_active
                                    ? 'bg-green-500/20 text-green-400'
                                    : 'bg-gray-500/20 text-[var(--text-tertiary)]'
                                }`}
                              >
                                {page.is_active ? 'Active' : 'Inactive'}
                              </span>
                              {page.banner_url && (
                                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-purple-500/20 text-purple-300">
                                  Banner
                                </span>
                              )}
                              {page.logo_url && (
                                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-500/20 text-blue-300">
                                  Logo
                                </span>
                              )}
                              {page.include_meeting && (
                                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-orange-500/20 text-orange-300">
                                  Meeting
                                </span>
                              )}
                            </div>

                            <p className="text-xs text-[var(--text-tertiary)] mb-2">
                              Slug: <code>{page.slug}</code>
                            </p>

                            {page.headline && <p className="text-sm text-[var(--text-secondary)]">{page.headline}</p>}

                            <p className="text-xs text-[var(--text-tertiary)] mt-2 break-all">
                              Public URL: <span className="text-[#93C5FD]">{publicUrl}</span>
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={() => handleCopyLink(page)}
                            className="p-2 rounded-lg bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] transition-colors"
                            title={copyingId === page.id ? 'Copied!' : 'Copy public link'}
                          >
                            {copyingId === page.id ? (
                              <CheckCircle className="h-4 w-4 text-green-500" />
                            ) : (
                              <LinkIcon className="h-4 w-4" />
                            )}
                          </button>
                          {canEditCapture && (
                            <button
                              onClick={() => openEditModal(page)}
                              className="p-2 rounded-lg bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] transition-colors"
                              title="Edit"
                            >
                              <Edit3 className="h-4 w-4" />
                            </button>
                          )}
                          {canEditCapture && (
                            <button
                              onClick={() => setPageToDelete(page)}
                              className="p-2 rounded-lg bg-[var(--bg-secondary)] text-[var(--text-tertiary)] hover:text-red-400 hover:bg-red-500/10 transition-colors"
                              title="Delete"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            )}
          </>
        )}

        {tab === 'submissions' && (
          <div className="space-y-4">
            {/* Filters */}
            <Card className="bg-[var(--bg-card)] border-[var(--border-primary)]">
              <CardContent className="p-4 space-y-3">
                <div className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
                  <div className="min-w-0">
                    <label className="block text-xs font-medium text-[var(--text-tertiary)] mb-1">Filter by page</label>
                    <select
                      value={subPageId}
                      onChange={(e) => setSubPageId(e.target.value)}
                      className="w-full md:w-96 px-4 py-2.5 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-primary)]"
                    >
                      <option value="">All pages</option>
                      {pages.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} - /capture/{p.slug}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="min-w-0">
                    <label className="block text-xs font-medium text-[var(--text-tertiary)] mb-1">Search</label>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-tertiary)]" />
                      <input
                        value={subSearch}
                        onChange={(e) => setSubSearch(e.target.value)}
                        placeholder="Search submissions..."
                        className="w-full md:w-80 pl-9 pr-3 py-2.5 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-primary)]"
                      />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Stats */}
            {subPageId && (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Card className="bg-[var(--bg-card)] border-[var(--border-primary)]">
                    <CardContent className="p-4">
                      <p className="text-xs text-[var(--text-tertiary)]">Submissions</p>
                      <p className="text-2xl font-bold text-[var(--text-primary)] mt-1">{stats.submissions}</p>
                    </CardContent>
                  </Card>
                  <Card className="bg-[var(--bg-card)] border-[var(--border-primary)]">
                    <CardContent className="p-4">
                      <p className="text-xs text-[var(--text-tertiary)]">Leads Created</p>
                      <p className="text-2xl font-bold text-[var(--text-primary)] mt-1">{stats.leads}</p>
                    </CardContent>
                  </Card>
                  <Card className="bg-[var(--bg-card)] border-[var(--border-primary)]">
                    <CardContent className="p-4">
                      <p className="text-xs text-[var(--text-tertiary)]">Meetings Booked</p>
                      <p className="text-2xl font-bold text-[var(--text-primary)] mt-1">{stats.meetings}</p>
                    </CardContent>
                  </Card>
                </div>

                {/* Advanced toggle + panel. Drops below the basic
                    stats so the simple view stays at the top. */}
                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => setShowAdvanced((v) => !v)}
                    className="inline-flex items-center gap-2 text-sm font-medium text-[#2B79F7] hover:text-[#1E54B7] transition-colors"
                  >
                    {showAdvanced ? 'Hide advanced' : 'Show advanced'}
                    <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-[#2B79F7]/10 text-[#2B79F7]">
                      Beta
                    </span>
                  </button>
                  {canEditCapture && (
                    <button
                      type="button"
                      onClick={() => setConfirmResetAnalytics(true)}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--text-tertiary)] hover:text-red-500 transition-colors"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Reset analytics
                    </button>
                  )}
                </div>

                {showAdvanced && (
                  <CaptureAdvancedAnalytics
                    clientId={clientId}
                    pageId={subPageId}
                    refreshKey={analyticsRefreshKey}
                  />
                )}
              </>
            )}

            {/* Table */}
            <Card className="bg-[var(--bg-card)] border-[var(--border-primary)]">
              <CardContent className="p-0">
                {subLoading ? (
                  <div className="p-8 text-center text-[var(--text-tertiary)]">Loading submissions…</div>
                ) : filteredSubmissions.length === 0 ? (
                  <div className="p-8 text-center text-[var(--text-tertiary)]">No submissions found.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-[var(--bg-secondary)] border-b border-[var(--border-primary)]">
                        <tr>
                          <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--text-tertiary)] uppercase">When</th>
                          <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--text-tertiary)] uppercase">Name</th>
                          <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--text-tertiary)] uppercase">Email</th>
                          <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--text-tertiary)] uppercase">Phone</th>
                          <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--text-tertiary)] uppercase">Meeting</th>
                          <th className="w-16 px-4 py-3 text-xs font-semibold text-[var(--text-tertiary)] uppercase"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border-primary)]">
                        {filteredSubmissions.map((s) => {
                          const d = s.data || {}
                          const hasMeeting = !!(d.meeting_date && d.meeting_time)
                          return (
                            <tr
                            key={s.id}
                            className="hover:bg-[var(--bg-card-hover)] cursor-pointer transition-colors"
                            onClick={() => setSelectedSubmission(s)}
                            >
                              <td className="px-4 py-3 text-sm text-[var(--text-secondary)]">
                                {new Date(s.created_at).toLocaleString()}
                              </td>
                              <td className="px-4 py-3 text-sm text-[var(--text-secondary)]">{s.name || '-'}</td>
                              <td className="px-4 py-3 text-sm text-[var(--text-secondary)]">{s.email || '-'}</td>
                              <td className="px-4 py-3 text-sm text-[var(--text-secondary)]">{s.phone || '-'}</td>
                              <td className="px-4 py-3 text-sm">
                                {hasMeeting ? (
                                  <span className="px-2 py-1 rounded-full text-xs bg-green-500/20 text-green-400">
                                    Yes
                                  </span>
                                ) : (
                                  <span className="px-2 py-1 rounded-full text-xs bg-gray-500/20 text-[var(--text-tertiary)]">
                                    No
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-right">
                               {canEditCapture && (
                               <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setSubmissionToDelete(s) }}
                              className="p-2 rounded-lg text-[var(--text-tertiary)] hover:text-red-400 hover:bg-red-500/10"
                                title="Delete submission"
                                   >
                                   <Trash2 className="h-4 w-4" />
                                     </button>
                                       )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Builder Modal - split-view: builder on left, live preview on
            right. Preview reflects the current form state in real time
            so you see exactly what visitors will see before saving. */}
        {showModal && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
            <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border-primary)] w-full max-w-7xl h-[92vh] shadow-2xl flex flex-col overflow-hidden">
              <div className="flex items-center justify-between gap-4 px-6 py-4 border-b border-[var(--border-primary)] shrink-0">
                <h3 className="text-lg font-semibold text-[var(--text-primary)]">
                  {editingPage ? 'Edit Capture Page' : 'New Capture Page'}
                </h3>

                {/* Active toggle pinned in the header so it's always
                    one click away. The info icon explains what off
                    does without taking up modal space. */}
                <div className="flex items-center gap-3 ml-auto">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium text-[var(--text-primary)]">
                      Active
                    </span>
                    <Tooltip
                      content="When off, the public capture page returns a 'no longer available' message. New leads can't submit. Existing leads are kept."
                      position="bottom"
                      maxWidth={280}
                    >
                      <span className="inline-flex text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] cursor-help">
                        <Info className="h-3.5 w-3.5" />
                      </span>
                    </Tooltip>
                  </div>
                  <Toggle
                    checked={form.is_active}
                    onChange={(v) => setForm((prev) => ({ ...prev, is_active: v }))}
                  />
                  <button
                    onClick={() => {
                      // Explicit close = intentional discard of the working copy.
                      clearDraftSnapshot(captureSnapshotKey)
                      setShowModal(false)
                    }}
                    className="p-2 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </div>

              <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 min-h-0">
                {/* Left pane: form builder (scrolls internally) */}
                <div className="px-6 py-5 space-y-6 overflow-y-auto scrollbar-none lg:border-r border-[var(--border-primary)]">
                  {/* Layout picker - 6 thumbnails. Click one and the
                      preview pane on the right snaps to that shell. */}
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <ImageIcon className="h-4 w-4 text-[#2B79F7]" />
                      <span className="text-sm font-semibold text-[var(--text-primary)]">Layout</span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {LAYOUT_TEMPLATES.map((t) => {
                        const active = form.layout_template === t.key
                        return (
                          <button
                            key={t.key}
                            type="button"
                            onClick={() => setForm((prev) => ({ ...prev, layout_template: t.key }))}
                            className={`text-left rounded-lg border p-2.5 transition-colors ${
                              active
                                ? 'border-[#2B79F7] bg-[#2B79F7]/5'
                                : 'border-[var(--border-primary)] hover:border-[var(--text-tertiary)]'
                            }`}
                          >
                            <LayoutThumb kind={t.key} active={active} />
                            <div className={`mt-1.5 text-xs font-medium ${active ? 'text-[#2B79F7]' : 'text-[var(--text-primary)]'}`}>
                              {t.label}
                            </div>
                            <div className="text-[10px] text-[var(--text-tertiary)] leading-tight">
                              {t.description}
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </div>

                {/* Basic */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Input
                    label="Internal Name"
                    name="name"
                    value={form.name}
                    onChange={handleFormChange}
                    placeholder="Free guide, webinar signup…"
                  />
                  <Input
                    label="Slug (URL)"
                    name="slug"
                    value={form.slug}
                    onChange={handleSlugChange}
                    placeholder="free-guide"
                    error={slugError ?? undefined}
                  />
                </div>

                <Input
                  label="Headline"
                  name="headline"
                  value={form.headline}
                  onChange={handleFormChange}
                  placeholder="Get your free guide to XYZ"
                />

                <div>
                  <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">Description</label>
                  <textarea
                    name="description"
                    value={form.description}
                    onChange={handleFormChange}
                    rows={3}
                    className="w-full px-4 py-2.5 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[#2B79F7] resize-none"
                    placeholder="Short description that appears on the page..."
                  />
                </div>

                <Input
                  label="Lead Magnet URL (optional)"
                  name="lead_magnet_url"
                  value={form.lead_magnet_url}
                  onChange={handleFormChange}
                  placeholder="https://example.com/your-pdf-or-video"
                />

                {/* CTA label after the visitor submits successfully.
                    Only shows when a lead-magnet URL is set (the
                    button itself is conditional on URL presence).
                    Empty falls back to the legacy default at render. */}
                {form.lead_magnet_url && (
                  <Input
                    label="Success button text"
                    name="success_button_text"
                    value={form.success_button_text}
                    onChange={handleFormChange}
                    placeholder="Access Your Free Resource"
                  />
                )}

                {/* Custom success-state confirmation message. Empty
                    falls back to "You're in! Let's Keep Going.". */}
                <Input
                  label="Success message"
                  name="success_message"
                  value={form.success_message}
                  onChange={handleFormChange}
                  placeholder="You're in! Let's Keep Going."
                />

                {/* Accent color drives every accented element on the public
                    page: Next/Submit + success buttons, and the package picker
                    (selected outline, check tick, and the Select button).
                    Native color input for the browser's swatches; empty falls
                    back to the default blue. */}
                <div>
                  <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">
                    Accent color
                  </label>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={form.accent_color || '#2B79F7'}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, accent_color: e.target.value }))
                      }
                      className="h-10 w-14 rounded-lg border border-[var(--border-primary)] bg-transparent cursor-pointer"
                    />
                    <Input
                      name="accent_color"
                      value={form.accent_color}
                      onChange={handleFormChange}
                      placeholder="#2B79F7"
                      className="flex-1"
                    />
                    {form.accent_color && (
                      <button
                        type="button"
                        onClick={() =>
                          setForm((prev) => ({ ...prev, accent_color: '' }))
                        }
                        className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)] px-2"
                      >
                        Reset
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-[var(--text-tertiary)] mt-1 leading-snug">
                    Applies to the Next/Submit buttons, the package picker (tick, outline &amp; Select){form.lead_magnet_url ? ', and the success-state button' : ''}.
                  </p>
                </div>

                {/* One-submission-per-email gate. Off by default - most
                    forms benefit from being retry-friendly (network
                    blips, "I want to update my answer"). Turn on for
                    one-shot signups (giveaways, event RSVPs) where a
                    duplicate is almost always a mistake. */}
                <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-3">
                  <Toggle
                    checked={form.block_duplicate_emails}
                    onChange={(v) =>
                      setForm((prev) => ({ ...prev, block_duplicate_emails: v }))
                    }
                    label="Block duplicate submissions per email"
                    description="When on, a second submission from the same email shows a friendly 'you've already submitted' message. Off by default - duplicates are allowed and your leads list dedupes them automatically."
                  />
                </div>

                {/* Branding: Banner + Logo. The banner upload shows a
                    LIVE thumbnail of the current image with a hover-
                    replace overlay, plus a layout-aware size hint so
                    the user knows what dimensions look best with their
                    currently-selected layout. */}
                <div className="border-t border-[var(--border-primary)] pt-5 space-y-4">
                  <div className="flex items-center gap-2 text-[var(--text-primary)] font-semibold">
                    <ImageIcon className="h-4 w-4 text-[#2B79F7]" />
                    Branding
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4">
                    {(() => {
                      const cfg = LAYOUT_TEMPLATES.find((t) => t.key === form.layout_template)
                      const hint = cfg?.usesBanner
                        ? `Recommended: ${cfg.bannerSize} · ${cfg.bannerAspect}`
                        : 'This layout doesn’t use the banner image.'
                      return (
                        <BrandImageUpload
                          label="Banner image (optional)"
                          folder="capture-banners"
                          value={form.banner_url}
                          onChange={(url) => setForm((prev) => ({ ...prev, banner_url: url }))}
                          sizeHint={hint}
                          aspect={form.layout_template === 'banner-top' ? '8 / 3' : '16 / 9'}
                        />
                      )
                    })()}
                    <div className="md:w-40">
                      <BrandImageUpload
                        label="Logo (optional)"
                        folder="capture-logos"
                        value={form.logo_url}
                        onChange={(url) => setForm((prev) => ({ ...prev, logo_url: url }))}
                        sizeHint="Square. 512×512 px or larger."
                        aspect="1 / 1"
                        circle
                      />
                    </div>
                  </div>
                </div>

                {/* Colors / theme. Picker controls the PAGE background.
                    Card surface stays the app palette so submit/fields
                    stay readable across themes. */}
                <div className="border-t border-[var(--border-primary)] pt-5">
                  <ThemePicker
                    value={form.theme}
                    onChange={(next) => setForm((prev) => ({ ...prev, theme: next }))}
                  />
                </div>

                {/* Fields - rounded-full pills with icons make the
                    add-field action feel like a single decision (which kind?)
                    instead of a list of similar text buttons. */}
                <div className="border-t border-[var(--border-primary)] pt-5 space-y-4">
                  <div className="flex items-center gap-2">
                    <ListChecks className="h-4 w-4 text-[#2B79F7]" />
                    <span className="text-sm font-semibold text-[var(--text-primary)]">Form fields</span>
                  </div>

                  {form.sections.length > 1 && (
                    <p className="text-xs text-[var(--text-tertiary)]">
                      Visitors move through one section per step (Next). The last section has the
                      submit button.
                    </p>
                  )}

                  {form.sections.map((section, sIdx) => {
                    const sectionFields = form.fields.filter((f) => f.sectionId === section.id)
                    const multi = form.sections.length > 1
                    return (
                      <div
                        key={section.id}
                        className={
                          multi
                            ? 'rounded-xl border border-[var(--border-primary)] p-3 space-y-3'
                            : 'space-y-3'
                        }
                      >
                        {multi && (
                          <div className="space-y-2">
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
                                Section {sIdx + 1}
                                {sIdx === form.sections.length - 1 ? ' · has submit' : ''}
                              </span>
                              <button
                                type="button"
                                onClick={() => removeSection(section.id)}
                                title="Remove section (its fields move to the previous section)"
                                className="ml-auto p-1 rounded-md text-[var(--text-tertiary)] hover:text-red-500 hover:bg-red-500/10"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                            <input
                              type="text"
                              value={section.title || ''}
                              onChange={(e) => updateSection(section.id, { title: e.target.value })}
                              placeholder="Section title (optional)"
                              className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                            />
                            <input
                              type="text"
                              value={section.description || ''}
                              onChange={(e) => updateSection(section.id, { description: e.target.value })}
                              placeholder="Section description (optional)"
                              className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                            />
                          </div>
                        )}

                        <div className="space-y-2">
                          {sectionFields.map((f, idx) => (
                            <div key={f.id} className="space-y-1">
                              {multi && (
                                <div className="flex justify-end">
                                  <select
                                    value={f.sectionId || section.id}
                                    onChange={(e) => moveFieldToSection(f.id, e.target.value)}
                                    title="Move this field to another section"
                                    className="text-[11px] px-2 py-1 rounded-md bg-[var(--bg-secondary)] border border-[var(--border-primary)] text-[var(--text-tertiary)] focus:outline-none"
                                  >
                                    {form.sections.map((s, i) => (
                                      <option key={s.id} value={s.id}>
                                        Section {i + 1}
                                        {s.title ? `: ${s.title}` : ''}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              )}
                              <CaptureFieldRow
                                field={f}
                                index={idx}
                                total={sectionFields.length}
                                onUpdate={updateField}
                                onMove={moveField}
                                onRemove={removeField}
                                isDragging={draggedFieldId === f.id}
                                isDragOver={dragOverFieldId === f.id}
                                onDragStartField={handleFieldDragStart}
                                onDragOverField={handleFieldDragOver}
                                onDropOnField={handleFieldDropOn}
                                onDragEndField={handleFieldDragEnd}
                              />
                            </div>
                          ))}
                          {sectionFields.length === 0 && (
                            <p className="text-xs text-[var(--text-tertiary)] py-1">
                              No fields here yet. Add one below.
                            </p>
                          )}
                        </div>

                        <div className="flex flex-wrap gap-2">
                          {([
                            { type: 'text' as FieldType, label: 'Text', icon: Type },
                            { type: 'url' as FieldType, label: 'Link', icon: Globe },
                            { type: 'select' as FieldType, label: 'Dropdown', icon: ChevronDown },
                            { type: 'radio' as FieldType, label: 'Options', icon: CircleDot },
                            { type: 'date' as FieldType, label: 'Date', icon: Calendar },
                            { type: 'embed' as FieldType, label: 'Embed', icon: LinkIcon },
                            { type: 'package' as FieldType, label: 'Package', icon: Package },
                          ]).map((opt) => (
                            <button
                              key={opt.type}
                              type="button"
                              onClick={() => addField(opt.type, section.id)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full bg-[var(--bg-card)] border border-[var(--border-primary)] text-[var(--text-primary)] hover:border-[#2B79F7] hover:text-[#2B79F7] transition-colors"
                            >
                              <opt.icon className="h-3.5 w-3.5" />
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )
                  })}

                  {form.sections.length < MAX_SECTIONS && (
                    <button
                      type="button"
                      onClick={addSection}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full border border-dashed border-[var(--border-primary)] text-[var(--text-secondary)] hover:border-[#2B79F7] hover:text-[#2B79F7] transition-colors"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add section
                    </button>
                  )}
                </div>

                {/* Meeting + Active - proper Toggles instead of native
                    checkboxes so the modal has consistent control vocabulary. */}
                <div className="border-t border-[var(--border-primary)] pt-5 space-y-4">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-[#2B79F7]" />
                    <span className="text-sm font-semibold text-[var(--text-primary)]">Meeting</span>
                  </div>
                  <Toggle
                    checked={form.include_meeting}
                    onChange={(v) => setForm((prev) => ({ ...prev, include_meeting: v }))}
                    label="Include meeting date & time"
                    description="Adds a date + time picker to the form so leads can pick when they'd like to talk."
                  />
                  {form.include_meeting && (
                    <>
                      {/* Integration picker. When a CRM-wide integration
                          (Calendly today; Google Meet / Zoom next) is
                          connected on the Settings page, picking it here
                          replaces the date/time inputs with the provider's
                          live scheduler. Bookings flow into the meetings
                          table via the provider webhook, so the host
                          doesn't have to re-enter the time the visitor
                          chose. */}
                      <div>
                        <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">
                          Meeting provider
                        </label>
                        <select
                          value={form.meeting_integration ?? ''}
                          onChange={(e) => {
                            const next = (e.target.value || null) as MeetingIntegration
                            setForm((prev) => ({
                              ...prev,
                              meeting_integration: next,
                              // Clear stale Calendly URL when switching
                              // off Calendly. Calendly is the only
                              // provider that uses calendly_url; for
                              // Google Meet / none, a leftover URL
                              // would render a phantom Calendly embed
                              // on the public page.
                              calendly_url:
                                next === 'calendly' ? prev.calendly_url : '',
                            }))
                          }}
                          className="w-full px-4 py-2.5 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                        >
                          <option value="">None - manual date/time only</option>
                          <option
                            value="calendly"
                            disabled={!connectedIntegrations.includes('calendly')}
                          >
                            Calendly
                            {connectedIntegrations.includes('calendly')
                              ? ''
                              : ' (not connected - see Settings)'}
                          </option>
                          <option
                            value="google_meet"
                            disabled={!connectedIntegrations.includes('google_meet')}
                          >
                            Google Meet
                            {connectedIntegrations.includes('google_meet')
                              ? ''
                              : ' (not connected - see Settings)'}
                          </option>
                          <option
                            value="zoom"
                            disabled={!connectedIntegrations.includes('zoom')}
                          >
                            Zoom
                            {connectedIntegrations.includes('zoom')
                              ? ''
                              : ' (not connected - see Settings)'}
                          </option>
                        </select>
                        <p className="text-xs text-[var(--text-tertiary)] mt-1 leading-snug">
                          {form.meeting_integration === 'calendly'
                            ? 'Visitors see your Calendly scheduler. Bookings auto-log into the meetings table.'
                            : form.meeting_integration === 'google_meet'
                            ? 'Visitors pick a date/time below. On submit we create a Google Calendar event with a Meet link and email the invite.'
                            : form.meeting_integration === 'zoom'
                            ? 'Visitors pick a date/time below. On submit we create a Zoom meeting and include the join link in the notification email.'
                            : 'No integration selected. You can still paste a Calendly URL below for the legacy embed.'}
                        </p>
                      </div>

                      {/* Per-page event-type override. Picking one
                          embeds that event's scheduler directly so
                          visitors don't have to scroll a list of every
                          Calendly event the host has. Leaving on
                          "main scheduling page" embeds the user's
                          home Calendly URL (legacy default). */}
                      {form.meeting_integration === 'calendly' && (
                        <div>
                          <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">
                            Specific event
                          </label>
                          {loadingEventTypes ? (
                            <div className="text-xs text-[var(--text-tertiary)]">
                              Loading events from Calendly…
                            </div>
                          ) : calendlyEventTypes && calendlyEventTypes.length > 0 ? (
                            <>
                              <select
                                value={form.calendly_url || ''}
                                onChange={(e) =>
                                  setForm((prev) => ({ ...prev, calendly_url: e.target.value }))
                                }
                                className="w-full px-4 py-2.5 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                              >
                                <option value={mainSchedulingUrl}>
                                  Main scheduling page (visitor picks an event)
                                </option>
                                {calendlyEventTypes.map((et) => (
                                  <option key={et.uri} value={et.scheduling_url}>
                                    {et.name} ({et.duration} min)
                                  </option>
                                ))}
                              </select>
                              <p className="text-xs text-[var(--text-tertiary)] mt-1 leading-snug">
                                Pick one to skip the event-list step and send
                                visitors straight to the date picker.
                              </p>
                            </>
                          ) : (
                            <p className="text-xs text-[var(--text-tertiary)] leading-snug">
                              No active event types found on this Calendly
                              account. Create one in Calendly to enable this.
                            </p>
                          )}
                        </div>
                      )}

                      {!form.meeting_integration && (
                        <Input
                          label="Calendly URL (optional)"
                          name="calendly_url"
                          value={form.calendly_url}
                          onChange={handleFormChange}
                          placeholder="https://calendly.com/your-link"
                        />
                      )}

                      {/* Meeting duration controls slot length in the
                          public availability picker. Only relevant when
                          we're the ones creating the meeting (Google
                          Meet / Zoom) - Calendly's own scheduler owns
                          duration for those events. */}
                      {(form.meeting_integration === 'google_meet' ||
                        form.meeting_integration === 'zoom') && (
                        <div>
                          <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">
                            Meeting duration
                          </label>
                          <select
                            value={form.meeting_duration_minutes}
                            onChange={(e) =>
                              setForm((prev) => ({
                                ...prev,
                                meeting_duration_minutes: parseInt(e.target.value, 10) || 30,
                              }))
                            }
                            className="w-full px-4 py-2.5 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                          >
                            <option value={15}>15 minutes</option>
                            <option value={30}>30 minutes</option>
                            <option value={45}>45 minutes</option>
                            <option value={60}>1 hour</option>
                            <option value={90}>1 hour 30 minutes</option>
                            <option value={120}>2 hours</option>
                          </select>
                          <p className="text-xs text-[var(--text-tertiary)] mt-1 leading-snug">
                            How long each meeting runs. The availability picker
                            shows slots in this length and hides any that
                            overlap an existing booking.
                          </p>
                        </div>
                      )}
                    </>
                  )}
                </div>

                </div>

                {/* Right pane: live preview. Renders the actual
                    CaptureLayout with the current form state so what
                    you see here IS what visitors will see when you
                    publish. Scaled down so the desktop layout fits in
                    the pane.
                    The pane background mirrors the preview's own
                    background so any space below the scaled content
                    blends into the same color - no dark strip at the
                    bottom. */}
                <div
                  className="hidden lg:block overflow-hidden relative"
                  style={(() => {
                    const bg = form.theme?.background
                    if (bg?.type === 'gradient') {
                      const from = bg.from || '#2B79F7'
                      const to = bg.to || '#143A80'
                      const dir = bg.direction || '135deg'
                      return { background: `linear-gradient(${dir}, ${from}, ${to})` }
                    }
                    return { background: bg?.color || '#f9fafb' }
                  })()}
                >
                  <div className="absolute top-2 left-3 z-10 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] mix-blend-difference">
                    Live preview
                  </div>
                  <div className="h-full overflow-y-auto scrollbar-none">
                    <CapturePagePreview form={form} />
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3 px-6 py-4 border-t border-[var(--border-primary)] shrink-0">
                <Button onClick={handleSave} isLoading={isSaving} disabled={!canEditCapture || !!slugError || !form.name || !form.slug}>
                  Save
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Delete confirm */}
        {pageToDelete && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
            <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border-primary)] w-full max-w-md max-h-[90vh] overflow-y-auto scrollbar-none shadow-2xl">
              <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-primary)]">
                <h3 className="text-lg font-semibold text-[var(--text-primary)]">Delete Capture Page</h3>
                <button
                  onClick={() => setPageToDelete(null)}
                  className="p-2 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="px-6 py-4 space-y-3">
                <p className="text-sm text-[var(--text-secondary)]">
                  Delete <span className="font-semibold text-[var(--text-primary)]">&quot;{pageToDelete.name}&quot;</span>?
                </p>
                <p className="text-xs text-[var(--text-tertiary)]">
                  This removes the configuration. Submissions already collected remain stored.
                </p>
              </div>

              <div className="flex justify-end gap-3 px-6 py-4 border-t border-[var(--border-primary)]">
                <Button variant="outline" onClick={() => setPageToDelete(null)} disabled={isDeleting}>
                  Cancel
                </Button>
                <Button onClick={handleDelete} isLoading={isDeleting} className="bg-red-600 hover:bg-red-500">
                  Delete
                </Button>
              </div>
            </div>
          </div>
        )}
         {selectedSubmission && (
  <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
    <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border-primary)] w-full max-w-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
      <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-primary)]">
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">Submission Details</h3>
        <button
          onClick={() => setSelectedSubmission(null)}
          className="p-2 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="px-6 py-4 space-y-4">
        <p className="text-xs text-[var(--text-tertiary)]">
          Submitted: {new Date(selectedSubmission.created_at).toLocaleString()}
        </p>

        <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4">
          <p className="text-sm font-semibold text-[var(--text-primary)] mb-3">All fields</p>
          <div className="space-y-2">
            {(() => {
  const page = pages.find((p) => p.id === selectedSubmission.capture_page_id)
  const currentLabels = buildFieldLabelMap(page?.fields)
  // Snapshot taken at submission time wins - if a field was renamed
  // since, we still show the original label the visitor actually saw.
  // Fall back to the page's CURRENT labels for legacy submissions
  // that pre-date the field_labels column.
  const snapshot = selectedSubmission.field_labels || {}
  const labelMap: Record<string, string> = { ...currentLabels, ...snapshot }

  return Object.entries(selectedSubmission.data || {}).map(([k, v]) => {
    const label = labelMap[k] || prettyKey(k)

    return (
      <div key={k} className="flex gap-3 text-sm">
        <div className="w-48 text-[var(--text-tertiary)] break-all">{label}</div>
        <div className="flex-1 text-[var(--text-primary)] break-words whitespace-pre-line">
          {v === null || v === undefined || String(v) === '' ? '-' : String(v)}
        </div>
      </div>
    )
  })
})()}
          </div>
        </div>
      </div>
    </div>
  </div>
)}
{submissionToDelete && (
  <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
    <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border-primary)] w-full max-w-md shadow-2xl">
      <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-primary)]">
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">Delete Submission</h3>
        <button
          onClick={() => setSubmissionToDelete(null)}
          className="p-2 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="px-6 py-4 text-sm text-[var(--text-secondary)]">
        Are you sure you want to delete this submission? This cannot be undone.
      </div>

      <div className="flex justify-end gap-3 px-6 py-4 border-t border-[var(--border-primary)]">
        <Button variant="outline" onClick={() => setSubmissionToDelete(null)} disabled={deletingSubmission}>
          Cancel
        </Button>
        <Button
          onClick={deleteSubmission}
          isLoading={deletingSubmission}
          className="bg-red-600 hover:bg-red-500"
        >
          Delete
        </Button>
      </div>
    </div>
  </div>
)}

{confirmResetAnalytics && (
  <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
    <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border-primary)] w-full max-w-md shadow-2xl">
      <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-primary)]">
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">Reset analytics</h3>
        <button
          onClick={() => setConfirmResetAnalytics(false)}
          className="p-2 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="px-6 py-4 text-sm text-[var(--text-secondary)]">
        This clears all visit analytics for this page: Visits, Unique Visitors,
        Avg Time, conversion, and the trend chart all reset to zero. Your
        submissions (captured leads) are kept. This cannot be undone.
      </div>

      <div className="flex justify-end gap-3 px-6 py-4 border-t border-[var(--border-primary)]">
        <Button variant="outline" onClick={() => setConfirmResetAnalytics(false)} disabled={resettingAnalytics}>
          Cancel
        </Button>
        <Button
          onClick={resetAnalytics}
          isLoading={resettingAnalytics}
          className="bg-red-600 hover:bg-red-500"
        >
          Reset analytics
        </Button>
      </div>
    </div>
  </div>
)}
</div>
}