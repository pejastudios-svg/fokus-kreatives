'use client'

import { useState, useEffect, useMemo } from 'react'
import { useParams } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { FileUpload } from '@/components/ui/FileUpload'
import { createClient } from '@/lib/supabase/client'
import {
  Plus,
  Link as LinkIcon,
  Globe,
  Edit3,
  Trash2,
  Copy,
  CheckCircle,
  X,
  Search,
  BarChart3,
  List,
  Image as ImageIcon,
  Type,
  ChevronDown,
} from 'lucide-react'

type FieldType = 'text' | 'email' | 'phone' | 'textarea' | 'select' | 'radio' | 'date' | 'time' | 'embed'

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
}

type CaptureTheme = {
  background: { type: 'solid' | 'gradient'; color?: string; from?: string; to?: string; direction?: string }
  textMode: 'auto' | 'custom'
  textColor?: string
  fontFamily: 'system' | 'inter' | 'poppins'
}

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
  fields: CaptureField[] | null
  theme: CaptureTheme | null
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
  data: any
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

function normalizeTheme(t: any): CaptureTheme {
  const d = makeDefaultTheme()
  if (!t || typeof t !== 'object') return d

  return {
    ...d,
    ...t,
    background: {
      ...d.background,
      ...(t.background && typeof t.background === 'object' ? t.background : {}),
    },
  }
}

function normalizeFields(f: any): CaptureField[] {
  const d = makeDefaultFields()
  if (!Array.isArray(f) || f.length === 0) return d

  // Ensure required is always boolean and options array is valid when needed
  return f.map((x: any) => ({
    id: String(x.id || `field-${Date.now()}`),
    type: (x.type as FieldType) || 'text',
    label: String(x.label || 'Field'),
    required: !!x.required,
    placeholder: x.placeholder ? String(x.placeholder) : undefined,
    description: x.description ? String(x.description) : undefined,
    options: Array.isArray(x.options) ? x.options.map(String) : undefined,
    embedUrl: x.embedUrl ? String(x.embedUrl) : undefined,
    embedHeight: x.embedHeight ? Number(x.embedHeight) : undefined,
  }))
}

export default function CRMCapturePages() {
  const params = useParams()
  const clientId = ((params as any).clientid || (params as any).clientId) as string
  const supabase = createClient()

  const [tab, setTab] = useState<'pages' | 'submissions'>('pages')
  const [selectedSubmission, setSelectedSubmission] = useState<SubmissionRow | null>(null)
const [crmRole, setCrmRole] = useState<'admin' | 'manager'>('manager')
const [roleReady, setRoleReady] = useState(false)
const [isClientUser, setIsClientUser] = useState(false)

// ✅ This controls Create/Edit/Delete in Capture Pages
const canEditCapture = crmRole === 'admin' || isClientUser

useEffect(() => {
  let cancelled = false
  setRoleReady(false)

  ;(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || !clientId) return

      const { data: userRow, error: userErr } = await supabase
        .from('users')
        .select('role, is_agency_user, client_id')
        .eq('id', user.id)
        .single()

      if (userErr) {
        console.error('Capture role load user error:', userErr)
        return
      }

      const isClient = userRow?.role === 'client'
      if (!cancelled) setIsClientUser(isClient)

      // ✅ Clients are full admins in their own CRM
      if (isClient) {
        if (!cancelled) setCrmRole('admin')
        return
      }

      // ✅ Agency admins are admins everywhere
      if (userRow?.role === 'admin' && userRow?.is_agency_user) {
        if (!cancelled) setCrmRole('admin')
        return
      }

      // ✅ Everyone else: membership role
      const { data: mem, error: memErr } = await supabase
        .from('client_memberships')
        .select('role')
        .eq('client_id', clientId)
        .eq('user_id', user.id)
        .maybeSingle()

      if (memErr) console.error('Capture role load membership error:', memErr)

      if (!cancelled) setCrmRole(mem?.role === 'admin' ? 'admin' : 'manager')
    } catch (e) {
      console.error('Capture role load exception:', e)
    } finally {
      if (!cancelled) setRoleReady(true)
    }
  })()

  return () => {
    cancelled = true
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [clientId])

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
  const [submissions, setSubmissions] = useState<SubmissionRow[]>([])
  const [submissionToDelete, setSubmissionToDelete] = useState<SubmissionRow | null>(null)
  const [deletingSubmission, setDeletingSubmission] = useState(false)
  const [subLoading, setSubLoading] = useState(false)
  const [subSearch, setSubSearch] = useState('')
  const [subPageId, setSubPageId] = useState<string>('') // filter by page
  const [stats, setStats] = useState({ submissions: 0, leads: 0, meetings: 0 })

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    (typeof window !== 'undefined' ? window.location.origin : '')

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
    fields: CaptureField[]
    theme: CaptureTheme
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
    fields: normalizeFields(makeDefaultFields()),
    theme: normalizeTheme(makeDefaultTheme()),
  })

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
      .order('created_at', { ascending: true })

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
      fields: makeDefaultFields(),
      theme: makeDefaultTheme(),
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
      fields: normalizeFields(page.fields),
      theme: normalizeTheme(page.theme),
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
  const addField = (type: FieldType) => {
    const id = `field-${Date.now()}`
    const base: CaptureField = {
      id,
      type,
      label:
        type === 'text' ? 'Text' :
        type === 'email' ? 'Email' :
        type === 'phone' ? 'Phone' :
        type === 'textarea' ? 'Long text' :
        type === 'select' ? 'Dropdown' :
        type === 'radio' ? 'Options' :
        type === 'date' ? 'Date' :
        type === 'time' ? 'Time' :
        'Embed',
      required: false,
      placeholder: type === 'textarea' ? 'Type here…' : 'Type here…',
      options: (type === 'select' || type === 'radio') ? ['Option 1', 'Option 2'] : undefined,
      embedUrl: type === 'embed' ? 'https://calendly.com/your-link' : undefined,
      embedHeight: type === 'embed' ? 520 : undefined,
    }

    setForm((prev) => ({ ...prev, fields: [...prev.fields, base] }))
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
      const next = idx + dir
      if (next < 0 || next >= prev.fields.length) return prev
      const copy = [...prev.fields]
      const [picked] = copy.splice(idx, 1)
      copy.splice(next, 0, picked)
      return { ...prev, fields: copy }
    })
  }

  // ----- Theme helpers -----
  const setTheme = (patch: Partial<CaptureTheme>) => {
    setForm((prev) => ({ ...prev, theme: { ...prev.theme, ...patch } }))
  }

  const setBg = (patch: Partial<CaptureTheme['background']>) => {
    setForm((prev) => ({ ...prev, theme: { ...prev.theme, background: { ...prev.theme.background, ...patch } } }))
  }

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
            fields: form.fields,
            theme: null,
          })
          .eq('id', editingPage.id)

        if (error) {
          console.error('Update capture page error:', error)
          setNotification(`Error: ${error.message}`)
          setTimeout(() => setNotification(null), 3000)
        } else {
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
          fields: form.fields,
          theme: form.theme,
        })

        if (error) {
          console.error('Create capture page error:', error)
          setNotification(`Error: ${error.message}`)
          setTimeout(() => setNotification(null), 3000)
        } else {
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

  const filteredSubmissions = useMemo(() => {
    const q = subSearch.trim().toLowerCase()
    if (!q) return submissions
    return submissions.filter((s) => {
      const hay = `${s.name || ''} ${s.email || ''} ${s.phone || ''} ${s.notes || ''} ${JSON.stringify(s.data || {})}`.toLowerCase()
      return hay.includes(q)
    })
  }, [submissions, subSearch])

  function buildFieldLabelMap(fields: any): Record<string, string> {
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
    }
  } finally {
    setDeletingSubmission(false)
    setSubmissionToDelete(null)
  }
}

  return <div className="p-6 lg:p-8 min-h-full">
        {notification && (
          <div className="mb-4 p-3 rounded-lg bg-green-50 text-green-700 flex items-center gap-2">
            <CheckCircle className="h-4 w-4" />
            <span className="text-sm">{notification}</span>
          </div>
        )}

        {/* Header + tabs */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">Capture Pages</h1>
            <p className="text-gray-400 mt-1">
               (Build pages to capture leads)
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setTab('pages')}
              className={`px-3 py-2 rounded-xl text-sm border ${
                tab === 'pages'
                  ? 'bg-[#2B79F7] text-white border-[#2B79F7]'
                  : 'bg-[#1E293B] text-gray-300 border-[#334155]'
              }`}
            >
              <List className="h-4 w-4 inline mr-2" />
              Pages
            </button>

            <button
              type="button"
              onClick={() => setTab('submissions')}
              className={`px-3 py-2 rounded-xl text-sm border ${
                tab === 'submissions'
                  ? 'bg-[#2B79F7] text-white border-[#2B79F7]'
                  : 'bg-[#1E293B] text-gray-300 border-[#334155]'
              }`}
            >
              <BarChart3 className="h-4 w-4 inline mr-2" />
              Submissions
            </button>

            {canEditCapture && (
  <Button onClick={openNewModal}>
    <Plus className="h-4 w-4 mr-2" />
    New Capture Page
  </Button>
)}
          </div>
        </div>

        {tab === 'pages' && (
          <>
            {isLoading ? (
              <Card>
                <CardContent className="py-10 text-center text-gray-400">Loading...</CardContent>
              </Card>
            ) : pages.length === 0 ? (
              <Card>
                <CardContent className="py-10 text-center text-gray-400">
                  No capture pages yet. Create one to start collecting leads.
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {pages.map((page) => {
                  const publicUrl = `${appUrl}/capture/${page.slug}`
                  return (
                    <Card key={page.id} className="bg-[#1E293B] border-[#334155]">
                      <CardContent className="p-5 flex items-start justify-between gap-4">
                        <div className="flex items-start gap-3 min-w-0">
                          <div className="p-3 rounded-lg bg-[#0F172A] flex-shrink-0">
                            <Globe className="h-5 w-5 text-[#2B79F7]" />
                          </div>

                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2 mb-1">
                              <h3 className="text-white font-semibold truncate">{page.name}</h3>
                              <span
                                className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                                  page.is_active
                                    ? 'bg-green-500/20 text-green-400'
                                    : 'bg-gray-500/20 text-gray-400'
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

                            <p className="text-xs text-gray-400 mb-2">
                              Slug: <code>{page.slug}</code>
                            </p>

                            {page.headline && <p className="text-sm text-gray-300">{page.headline}</p>}

                            <p className="text-xs text-gray-500 mt-2 break-all">
                              Public URL: <span className="text-[#93C5FD]">{publicUrl}</span>
                            </p>
                          </div>
                        </div>

                        <div className="flex flex-col items-end gap-2 flex-shrink-0">
                          <Button variant="outline" size="sm" onClick={() => handleCopyLink(page)}>
                            {copyingId === page.id ? (
                              <>
                                <CheckCircle className="h-4 w-4 mr-1" />
                                Copied
                              </>
                            ) : (
                              <>
                                <LinkIcon className="h-4 w-4 mr-1" />
                                Copy Link
                              </>
                            )}
                          </Button>

                          <div className="flex items-center gap-2">
                            {canEditCapture && (
                            <button
                              onClick={() => openEditModal(page)}
                              className="p-2 rounded-lg bg-[#0F172A] text-gray-300 hover:text-white hover:bg-[#111827] transition-colors"
                              title="Edit"
                            >
                              <Edit3 className="h-4 w-4" />
                            </button>
                )}
                {canEditCapture && (
                            <button
                              onClick={() => setPageToDelete(page)}
                              className="p-2 rounded-lg bg-[#0F172A] text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                              title="Delete"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                )}
                          </div>
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
            <Card className="bg-[#1E293B] border-[#334155]">
              <CardContent className="p-4 space-y-3">
                <div className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
                  <div className="min-w-0">
                    <label className="block text-xs font-medium text-gray-400 mb-1">Filter by page</label>
                    <select
                      value={subPageId}
                      onChange={(e) => setSubPageId(e.target.value)}
                      className="w-full md:w-96 px-4 py-2.5 rounded-lg border border-[#334155] bg-[#0F172A] text-white"
                    >
                      <option value="">All pages</option>
                      {pages.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} — /capture/{p.slug}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="min-w-0">
                    <label className="block text-xs font-medium text-gray-400 mb-1">Search</label>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
                      <input
                        value={subSearch}
                        onChange={(e) => setSubSearch(e.target.value)}
                        placeholder="Search submissions..."
                        className="w-full md:w-80 pl-9 pr-3 py-2.5 rounded-lg border border-[#334155] bg-[#0F172A] text-white"
                      />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Stats */}
            {subPageId && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="bg-[#1E293B] border-[#334155]">
                  <CardContent className="p-4">
                    <p className="text-xs text-gray-400">Submissions</p>
                    <p className="text-2xl font-bold text-white mt-1">{stats.submissions}</p>
                  </CardContent>
                </Card>
                <Card className="bg-[#1E293B] border-[#334155]">
                  <CardContent className="p-4">
                    <p className="text-xs text-gray-400">Leads Created</p>
                    <p className="text-2xl font-bold text-white mt-1">{stats.leads}</p>
                  </CardContent>
                </Card>
                <Card className="bg-[#1E293B] border-[#334155]">
                  <CardContent className="p-4">
                    <p className="text-xs text-gray-400">Meetings Booked</p>
                    <p className="text-2xl font-bold text-white mt-1">{stats.meetings}</p>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Table */}
            <Card className="bg-[#1E293B] border-[#334155]">
              <CardContent className="p-0">
                {subLoading ? (
                  <div className="p-8 text-center text-gray-400">Loading submissions…</div>
                ) : filteredSubmissions.length === 0 ? (
                  <div className="p-8 text-center text-gray-400">No submissions found.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-[#0F172A] border-b border-[#334155]">
                        <tr>
                          <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase">When</th>
                          <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Name</th>
                          <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Email</th>
                          <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Phone</th>
                          <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Meeting</th>
                          <th className="w-16 px-4 py-3 text-xs font-semibold text-gray-400 uppercase"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#334155]">
                        {filteredSubmissions.map((s) => {
                          const d = s.data || {}
                          const hasMeeting = !!(d.meeting_date && d.meeting_time)
                          return (
                            <tr
                            key={s.id}
                            className="hover:bg-[#24324A] cursor-pointer"
                            onClick={() => setSelectedSubmission(s)}
                            >
                              <td className="px-4 py-3 text-sm text-gray-300">
                                {new Date(s.created_at).toLocaleString()}
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-300">{s.name || '—'}</td>
                              <td className="px-4 py-3 text-sm text-gray-300">{s.email || '—'}</td>
                              <td className="px-4 py-3 text-sm text-gray-300">{s.phone || '—'}</td>
                              <td className="px-4 py-3 text-sm">
                                {hasMeeting ? (
                                  <span className="px-2 py-1 rounded-full text-xs bg-green-500/20 text-green-400">
                                    Yes
                                  </span>
                                ) : (
                                  <span className="px-2 py-1 rounded-full text-xs bg-gray-500/20 text-gray-400">
                                    No
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-right">
                               {canEditCapture && (
                               <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setSubmissionToDelete(s) }}
                              className="p-2 rounded-lg text-gray-400 hover:text-red-400 hover:bg-red-500/10"
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

        {/* Builder Modal */}
        {showModal && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
            <div className="bg-[#1E293B] rounded-2xl border border-[#334155] w-full max-w-3xl shadow-2xl max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between px-6 py-4 border-b border-[#334155]">
                <h3 className="text-lg font-semibold text-white">
                  {editingPage ? 'Edit Capture Page' : 'New Capture Page'}
                </h3>
                <button
                  onClick={() => setShowModal(false)}
                  className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-[#334155]"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="px-6 py-5 space-y-6">
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
                  <label className="block text-sm font-medium text-gray-100 mb-1">Description</label>
                  <textarea
                    name="description"
                    value={form.description}
                    onChange={handleFormChange}
                    rows={3}
                    className="w-full px-4 py-2.5 rounded-lg border border-[#334155] bg-[#0F172A] text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#2B79F7] resize-none"
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

                {/* Branding: Banner + Logo */}
                <div className="border-t border-[#334155] pt-5 space-y-4">
                  <div className="flex items-center gap-2 text-white font-semibold">
                    <ImageIcon className="h-4 w-4 text-[#2B79F7]" />
                    Branding
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <p className="text-sm text-gray-200 font-medium">Banner image (optional)</p>
                      <FileUpload
                        label="Upload banner"
                        folder="capture-banners"
                        accept="image/*"
                        onUpload={(url) => setForm((prev) => ({ ...prev, banner_url: url }))}
                      />
                      <Input
                        label="Or banner URL"
                        name="banner_url"
                        value={form.banner_url}
                        onChange={handleFormChange}
                        placeholder="https://.../banner.png"
                      />
                    </div>

                    <div className="space-y-2">
                      <p className="text-sm text-gray-200 font-medium">Logo (optional)</p>
                      <FileUpload
                        label="Upload logo"
                        folder="capture-logos"
                        accept="image/*"
                        onUpload={(url) => setForm((prev) => ({ ...prev, logo_url: url }))}
                      />
                      <Input
                        label="Or logo URL"
                        name="logo_url"
                        value={form.logo_url}
                        onChange={handleFormChange}
                        placeholder="https://.../logo.png"
                      />
                    </div>
                  </div>

                  <p className="text-xs text-gray-400">
                    Upload one or both
                  </p>
                </div>

                {/* Fields */}
                <div className="border-t border-[#334155] pt-5 space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-white font-semibold flex items-center gap-2">
                      <ChevronDown className="h-4 w-4 text-[#2B79F7]" />
                      Form fields
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => addField('text')}
                        className="px-3 py-1.5 text-xs rounded-lg border border-[#334155] text-gray-200 hover:border-[#2B79F7]"
                      >
                        + Text
                      </button>
                      <button
                        type="button"
                        onClick={() => addField('select')}
                        className="px-3 py-1.5 text-xs rounded-lg border border-[#334155] text-gray-200 hover:border-[#2B79F7]"
                      >
                        + Dropdown
                      </button>
                      <button
                        type="button"
                        onClick={() => addField('radio')}
                        className="px-3 py-1.5 text-xs rounded-lg border border-[#334155] text-gray-200 hover:border-[#2B79F7]"
                      >
                        + Options
                      </button>
                      <button
                        type="button"
                        onClick={() => addField('embed')}
                        className="px-3 py-1.5 text-xs rounded-lg border border-[#334155] text-gray-200 hover:border-[#2B79F7]"
                      >
                        + Embed
                      </button>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {form.fields.map((f, idx) => (
                      <div key={f.id} className="rounded-xl border border-[#334155] bg-[#0F172A] p-4 space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="text-xs text-gray-400">
                            Field #{idx + 1} · <code>{f.id}</code>
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => moveField(f.id, -1)}
                              className="px-2 py-1 text-xs rounded border border-[#334155] text-gray-200 hover:border-[#2B79F7]"
                              title="Move up"
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              onClick={() => moveField(f.id, 1)}
                              className="px-2 py-1 text-xs rounded border border-[#334155] text-gray-200 hover:border-[#2B79F7]"
                              title="Move down"
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              onClick={() => removeField(f.id)}
                              className="p-2 rounded-lg text-gray-400 hover:text-red-400 hover:bg-red-500/10"
                              title="Delete field"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          <div className="md:col-span-2">
                            <Input
                              label="Label"
                              value={f.label}
                              onChange={(e) => updateField(f.id, { label: e.target.value })}
                              placeholder="Field label"
                            />
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-gray-200 mb-1">Type</label>
                            <select
                              value={f.type}
                              onChange={(e) => updateField(f.id, { type: e.target.value as any })}
                              className="w-full px-4 py-2.5 rounded-lg border border-[#334155] bg-[#0F172A] text-white"
                            >
                              <option value="text">Text</option>
                              <option value="email">Email</option>
                              <option value="phone">Phone</option>
                              <option value="textarea">Long text</option>
                              <option value="select">Dropdown</option>
                              <option value="radio">Options</option>
                              <option value="date">Date</option>
                              <option value="time">Time</option>
                              <option value="embed">Embed</option>
                            </select>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <label className="flex items-center gap-2 text-sm text-gray-200">
                            <input
                              type="checkbox"
                              checked={!!f.required}
                              onChange={(e) => updateField(f.id, { required: e.target.checked })}
                              className="h-4 w-4 rounded border-[#334155] bg-[#0F172A] text-[#2B79F7]"
                            />
                            Required
                          </label>

                          {f.type !== 'embed' && (
                            <Input
                              label="Placeholder (optional)"
                              value={f.placeholder || ''}
                              onChange={(e) => updateField(f.id, { placeholder: e.target.value })}
                              placeholder="Type here..."
                            />
                          )}
                        </div>

                        <Input
                          label="Helper text (optional)"
                          value={f.description || ''}
                          onChange={(e) => updateField(f.id, { description: e.target.value })}
                          placeholder="Small note shown under the field"
                        />

                        {(f.type === 'select' || f.type === 'radio') && (
                          <div>
                            <label className="block text-sm font-medium text-gray-200 mb-1">
                              Options (one per line)
                            </label>
                            <textarea
                              value={(f.options || []).join('\n')}
                              onChange={(e) =>
                                updateField(f.id, {
                                  options: e.target.value
                                    .split('\n')
                                    .map((x) => x.trim())
                                    .filter(Boolean),
                                })
                              }
                              rows={4}
                              className="w-full px-4 py-2.5 rounded-lg border border-[#334155] bg-[#0F172A] text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#2B79F7] resize-none"
                            />
                          </div>
                        )}

                        {f.type === 'embed' && (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <Input
                              label="Embed URL"
                              value={f.embedUrl || ''}
                              onChange={(e) => updateField(f.id, { embedUrl: e.target.value })}
                              placeholder="https://..."
                            />
                            <Input
                              label="Embed height (px)"
                              type="number"
                              value={String(f.embedHeight || 520)}
                              onChange={(e) => updateField(f.id, { embedHeight: Number(e.target.value) || 520 })}
                              placeholder="520"
                            />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Meeting config (existing behavior) */}
                <div className="border-t border-[#334155] pt-5 space-y-3">
                  <label className="flex items-center gap-2 text-sm text-gray-200">
                    <input
                      type="checkbox"
                      checked={form.include_meeting}
                      onChange={() => setForm((prev) => ({ ...prev, include_meeting: !prev.include_meeting }))}
                      className="h-4 w-4 rounded border-[#334155] bg-[#0F172A] text-[#2B79F7]"
                    />
                    Include meeting date & time field
                  </label>

                  {form.include_meeting && (
                    <Input
                      label="Calendly URL (optional)"
                      name="calendly_url"
                      value={form.calendly_url}
                      onChange={handleFormChange}
                      placeholder="https://calendly.com/your-link"
                    />
                  )}
                </div>

                {/* Active toggle */}
                <label className="flex items-center gap-2 text-sm text-gray-200">
                  <input
                    type="checkbox"
                    checked={form.is_active}
                    onChange={() => setForm((prev) => ({ ...prev, is_active: !prev.is_active }))}
                    className="h-4 w-4 rounded border-[#334155] bg-[#0F172A] text-[#2B79F7]"
                  />
                  Active
                </label>
              </div>

              <div className="flex justify-end gap-3 px-6 py-4 border-t border-[#334155]">
                <Button variant="outline" onClick={() => setShowModal(false)} disabled={isSaving}>
                  Cancel
                </Button>
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
            <div className="bg-[#1E293B] rounded-2xl border border-[#334155] w-full max-w-md shadow-2xl">
              <div className="flex items-center justify-between px-6 py-4 border-b border-[#334155]">
                <h3 className="text-lg font-semibold text-white">Delete Capture Page</h3>
                <button
                  onClick={() => setPageToDelete(null)}
                  className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-[#334155]"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="px-6 py-4 space-y-3">
                <p className="text-sm text-gray-300">
                  Delete <span className="font-semibold text-white">"{pageToDelete.name}"</span>?
                </p>
                <p className="text-xs text-gray-500">
                  This removes the configuration. Submissions already collected remain stored.
                </p>
              </div>

              <div className="flex justify-end gap-3 px-6 py-4 border-t border-[#334155]">
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
    <div className="bg-[#1E293B] rounded-2xl border border-[#334155] w-full max-w-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#334155]">
        <h3 className="text-lg font-semibold text-white">Submission Details</h3>
        <button
          onClick={() => setSelectedSubmission(null)}
          className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-[#334155]"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="px-6 py-4 space-y-4">
        <p className="text-xs text-gray-400">
          Submitted: {new Date(selectedSubmission.created_at).toLocaleString()}
        </p>

        <div className="rounded-xl border border-[#334155] bg-[#0F172A] p-4">
          <p className="text-sm font-semibold text-white mb-3">All fields</p>
          <div className="space-y-2">
            {(() => {
  const page = pages.find((p) => p.id === selectedSubmission.capture_page_id)
  const labelMap = buildFieldLabelMap(page?.fields)

  return Object.entries(selectedSubmission.data || {}).map(([k, v]) => {
    const label = labelMap[k] || prettyKey(k)

    return (
      <div key={k} className="flex gap-3 text-sm">
        <div className="w-48 text-gray-400 break-words">{label}</div>
        <div className="flex-1 text-gray-200 break-words">
          {v === null || v === undefined || String(v) === '' ? '—' : String(v)}
        </div>
      </div>
    )
  })
})()}
          </div>
        </div>

        <div className="rounded-xl border border-[#334155] bg-[#0F172A] p-4">
          <p className="text-sm font-semibold text-white mb-2">Raw JSON</p>
          <pre className="text-xs text-gray-300 whitespace-pre-wrap break-words">
            {JSON.stringify(selectedSubmission.data || {}, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  </div>
)}
{submissionToDelete && (
  <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
    <div className="bg-[#1E293B] rounded-2xl border border-[#334155] w-full max-w-md shadow-2xl">
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#334155]">
        <h3 className="text-lg font-semibold text-white">Delete Submission</h3>
        <button
          onClick={() => setSubmissionToDelete(null)}
          className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-[#334155]"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="px-6 py-4 text-sm text-gray-300">
        Are you sure you want to delete this submission? This cannot be undone.
      </div>

      <div className="flex justify-end gap-3 px-6 py-4 border-t border-[#334155]">
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
</div>  
}