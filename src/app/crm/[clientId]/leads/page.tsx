'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Loading'
import { toast } from '@/components/ui/Toast'
import { 
  Plus, 
  GripVertical, 
  Trash2, 
  X,
  Search,
  Table2,
  Kanban,
  BarChart3,
  Calendar,
  Mail,
  Phone,
  Hash,
  Link as LinkIcon,
  Type,
  List,
  Tag,
  Settings2,
  Check,
  ExternalLink,
  FileDown,
  CheckSquare,
  ChevronDown,
  CheckCircle2,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock'
import { Tooltip } from '@/components/ui/Tooltip'
import { KebabMenu } from '@/components/ui/KebabMenu'
import { DonutChart, ChartLegend } from '@/components/charts/MiniCharts'
import {
  StatusStackedBar,
  type SeriesDef,
} from '@/components/charts/StatusCharts'
import { BucketToggle } from '@/components/charts/BucketToggle'
import { LeadFilter, type LeadOption } from '@/components/crm/LeadFilter'
import { useCrmRole } from '@/components/crm/CrmRoleContext'
import type { LeadsReportRow, LeadsReportStatus } from '@/components/reports/LeadsReport'
import {
  bucketize,
  type BucketMode,
  type ChartEvent,
} from '@/lib/charts/bucketize'

// Types
interface CustomField {
  id: string
  field_name: string
  field_key: string
  field_type: string
  options: StatusOption[] | null
  position: number
  is_default: boolean
  is_required: boolean
  url_display_type?: 'button' | 'link' | 'hyperlink'
}

interface StatusOption {
  value: string
  label: string
  color: string
}

interface Lead {
  id: string
  data: Record<string, unknown>
  position: number
  created_at: string
  updated_at?: string
}

// Color palette
const colorPalette = [
  { value: '#3B82F6', name: 'Blue' },
  { value: '#10B981', name: 'Green' },
  { value: '#F59E0B', name: 'Amber' },
  { value: '#EF4444', name: 'Red' },
  { value: '#8B5CF6', name: 'Purple' },
  { value: '#EC4899', name: 'Pink' },
  { value: '#F97316', name: 'Orange' },
  { value: '#06B6D4', name: 'Cyan' },
  { value: '#6366F1', name: 'Indigo' },
  { value: '#84CC16', name: 'Lime' },
  { value: '#64748B', name: 'Slate' },
  { value: '#0EA5E9', name: 'Sky' },
]

// Default fields
const defaultFields: Omit<CustomField, 'id'>[] = [
  { field_name: 'Name', field_key: 'name', field_type: 'text', options: [], position: 0, is_default: true, is_required: true },
  { field_name: 'Email', field_key: 'email', field_type: 'email', options: [], position: 1, is_default: true, is_required: false },
  { field_name: 'Phone', field_key: 'phone', field_type: 'phone', options: [], position: 2, is_default: true, is_required: false },
  { 
    field_name: 'Status', 
    field_key: 'status', 
    field_type: 'status', 
    options: [
      { value: 'new', label: 'New', color: '#3B82F6' },
      { value: 'contacted', label: 'Contacted', color: '#F59E0B' },
      { value: 'qualified', label: 'Qualified', color: '#8B5CF6' },
      { value: 'proposal', label: 'Proposal', color: '#EC4899' },
      { value: 'negotiation', label: 'Negotiation', color: '#F97316' },
      { value: 'closed', label: 'Closed', color: '#10B981' },
      { value: 'lost', label: 'Lost', color: '#EF4444' },
    ], 
    position: 3, 
    is_default: true, 
    is_required: false 
  },
  { field_name: 'Date Added', field_key: 'date_added', field_type: 'date', options: [], position: 4, is_default: true, is_required: false },
]

// Field type config
const fieldTypeConfig: Record<string, { icon: React.ElementType; label: string }> = {
  text: { icon: Type, label: 'Text' },
  email: { icon: Mail, label: 'Email' },
  phone: { icon: Phone, label: 'Phone' },
  number: { icon: Hash, label: 'Number' },
  url: { icon: LinkIcon, label: 'URL' },
  date: { icon: Calendar, label: 'Date' },
  select: { icon: List, label: 'Select' },
  status: { icon: Tag, label: 'Status' },
  checkbox: { icon: CheckSquare, label: 'Checkbox' },
}

// Helper function to safely get options from a field and remove duplicates.
// Filters out the URL-label sentinel entry so URL field metadata never
// shows up as if it were a status option.
const getFieldOptions = (field: CustomField): StatusOption[] => {
  if (!field.options) return []

  const validOptions = field.options.filter((opt): opt is StatusOption =>
    opt !== null &&
    opt !== undefined &&
    typeof opt === 'object' &&
    'value' in opt &&
    'label' in opt &&
    'color' in opt &&
    opt.value !== '__url_display_text__' &&
    opt.value !== '__url_default_url__',
  )

  // Remove duplicates by value
  const seen = new Set<string>()
  return validOptions.filter(opt => {
    if (seen.has(opt.value)) return false
    seen.add(opt.value)
    return true
  })
}

// Field-level metadata for URL fields - both the display text and a
// default URL. Stored inside the `options` JSON (otherwise unused for
// URL fields) using two sentinel entries so we don't need new DB
// columns. Each lead's per-cell value can still override these.
//
// Display fallback chain:
//   per-cell text → field-level text → field name → generic
//   per-cell url  → field-level url  → "-" (empty state)
const URL_LABEL_SENTINEL = '__url_display_text__'
const URL_DEFAULT_SENTINEL = '__url_default_url__'
function getFieldUrlLabel(field: CustomField): string {
  const entry = (field.options || []).find(
    (o) => o.value === URL_LABEL_SENTINEL,
  )
  return entry?.label || ''
}
function getFieldUrlDefault(field: CustomField): string {
  const entry = (field.options || []).find(
    (o) => o.value === URL_DEFAULT_SENTINEL,
  )
  return entry?.label || ''
}
function buildUrlMetaOptions(label: string, url: string): StatusOption[] {
  const out: StatusOption[] = []
  if (label) out.push({ value: URL_LABEL_SENTINEL, label, color: '' })
  if (url) out.push({ value: URL_DEFAULT_SENTINEL, label: url, color: '' })
  return out
}

// URL field values can be either a plain URL string (legacy / new
// fields where no display text is set) or a JSON object of the form
// { url: string, text?: string }. We always serialize to a string so
// the per-row update path stays unchanged.
function parseUrlValue(raw: string): { url: string; text: string } {
  if (!raw) return { url: '', text: '' }
  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && typeof parsed.url === 'string') {
        return {
          url: parsed.url,
          text: typeof parsed.text === 'string' ? parsed.text : '',
        }
      }
    } catch {
      // Not JSON - treat the whole thing as a URL.
    }
  }
  return { url: raw, text: '' }
}
function serializeUrlValue(url: string, text: string): string {
  if (!url) return ''
  return text ? JSON.stringify({ url, text }) : url
}

export default function CRMLeads() {
  const params = useParams()
  const clientId = (params?.clientId || params?.clientid) as string
  // ?focus=<leadId> from the Inbox navigation. The matching row gets
  // a temporary `focus-pulse` class and scrolls into view so the
  // user can see exactly which lead the notification was about.
  const searchParams = useSearchParams()
  const focusedLeadId = searchParams?.get('focus') || null
  const supabase = createClient()
  // Workspace-structure edits (custom fields, status options) are
  // manager+ only. Employees can still update field VALUES on a lead.
  const { canEditWorkspace, workspaceName } = useCrmRole()
  const [isExporting, setIsExporting] = useState(false)

  // Data state
  const [fields, setFields] = useState<CustomField[]>([])
  const [leads, setLeads] = useState<Lead[]>([])
  const [isLoading, setIsLoading] = useState(true)
  
  // View state
  const [view, setView] = useState<'table' | 'board' | 'chart'>('table')
  const [searchQuery, setSearchQuery] = useState('')
  // Sort + status filter (driven from the kebab menu).
  // Default to 'newest' (created_at DESC) so the most recently
  // captured lead is at the top - standard CRM pattern, matches
  // "new lead just came in, show it first". 'manual' kicks in
  // automatically the moment the user drags a row, so drag-reorder
  // still works without forcing them to flip the sort menu.
  const [sortBy, setSortBy] = useState<
    'manual' | 'newest' | 'oldest' | 'updated' | 'az' | 'za'
  >('newest')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  
  // Modal state
  const [showAddLead, setShowAddLead] = useState(false)
  const [showAddField, setShowAddField] = useState(false)
  // Hold the field ID, not the snapshot - this way the modal always
  // re-derives `field` from the current fields array, so optimistic
  // updates (e.g. toggling Display Style) reflect immediately instead
  // of waiting for the user to close + reopen.
  const [fieldSettingsId, setFieldSettingsId] = useState<string | null>(null)
  const showFieldSettings = fieldSettingsId
    ? fields.find((f) => f.id === fieldSettingsId) || null
    : null
  const setShowFieldSettings = (f: CustomField | null) =>
    setFieldSettingsId(f ? f.id : null)
  const [showLeadDetail, setShowLeadDetail] = useState<Lead | null>(null)
  const [statusDropdown, setStatusDropdown] = useState<{ leadId: string; fieldKey: string } | null>(null)
  
  // Edit state
  const [editingCell, setEditingCell] = useState<{ leadId: string; fieldKey: string } | null>(null)
  const [editValue, setEditValue] = useState('')
  // Inline-add state: when non-null, the table renders an editable
  // empty row at the bottom that the user types into directly (no
  // modal). Null = placeholder "+ Add a lead" row instead.
  const [inlineDraft, setInlineDraft] = useState<Record<string, string> | null>(null)
  const inlineFirstInputRef = useRef<HTMLInputElement>(null)
  // URL fields store a serialized "{url,text}" pair. While editing we
  // split them into two separate inputs so the user can pick the
  // display text alongside the URL.
  const [editUrlText, setEditUrlText] = useState('')
  
  // Pending state for optimistic updates
  const [pendingLeads, setPendingLeads] = useState<Set<string>>(new Set())
  const [pendingFields, setPendingFields] = useState<Set<string>>(new Set())
  
  // Form state
    const [newLead, setNewLead] = useState<Record<string, string>>({})
  const [newField, setNewField] = useState({
    name: '',
    type: 'text',
    urlDisplayType: 'link' as 'button' | 'link' | 'hyperlink',
    // Field-level display text - used when display style is hyperlink
    // or button. Empty = fall back to the field name at render time.
    urlLabel: '',
    // Field-level default URL - the link every cell points to unless
    // a per-cell override is set. Empty = no default; cells start blank.
    urlDefault: '',
  })
  
  // Drag state
  const [draggedLead, setDraggedLead] = useState<Lead | null>(null)
  const [dragOverStatus, setDragOverStatus] = useState<string | null>(null)
  // Table-view drag-to-reorder state. Separate from the board's
  // status drag so the two modes don't interfere.
  const [draggedRowId, setDraggedRowId] = useState<string | null>(null)
  const [dragOverRowId, setDragOverRowId] = useState<string | null>(null)
  const [draggedColumnId, setDraggedColumnId] = useState<string | null>(null)
  const [dragOverColumnId, setDragOverColumnId] = useState<string | null>(null)

  // Chart-only controls (chart view in this page).
  const [bucketMode, setBucketMode] = useState<BucketMode>('day')
  const [chartLeadIds, setChartLeadIds] = useState<string[]>([])
  
  // Refs
  const editInputRef = useRef<HTMLInputElement>(null)
  const boardScrollRef = useRef<HTMLDivElement | null>(null)

  // Define loading functions with useCallback to fix dependency issues
  const createDefaultFields = useCallback(async () => {
    const toInsert = defaultFields.map(f => ({ 
      ...f, 
      client_id: clientId,
      options: f.options || []
    }))
    
    const { data, error } = await supabase
      .from('custom_fields')
      .insert(toInsert)
      .select()

    if (error) {
      console.error('Error creating default fields:', error)
      return
    }

    if (data) {
      setFields(data)
    }
  }, [clientId, supabase])

  const loadFields = useCallback(async () => {
    const { data, error } = await supabase
      .from('custom_fields')
      .select('*')
      .eq('client_id', clientId)
      .order('position')

    if (error) {
      console.error('Error loading fields:', error)
    }

    if (data && data.length > 0) {
      // Clean up any null options
      const cleanedFields = data.map(field => ({
        ...field,
        options: Array.isArray(field.options) 
          ? (field.options as unknown[]).filter((opt): opt is StatusOption => 
              typeof opt === 'object' && opt !== null && 'value' in opt && 'label' in opt
            )
          : []
      }))
      setFields(cleanedFields)
    } else {
      await createDefaultFields()
    }
  }, [clientId, supabase, createDefaultFields])

  const loadLeads = useCallback(async () => {
    const { data, error } = await supabase
      .from('leads')
      .select('*')
      .eq('client_id', clientId)
      .order('position')

    if (error) {
      console.error('Error loading leads:', error)
    }

    setLeads(data || [])
  }, [clientId, supabase])

  const loadData = useCallback(async () => {
    setIsLoading(true)
    await Promise.all([loadFields(), loadLeads()])
    setIsLoading(false)
  }, [loadFields, loadLeads])

  // Load data
  useEffect(() => {
    if (clientId) loadData()
  }, [clientId, loadData])

  // Focus edit input
  useEffect(() => {
    if (editingCell && editInputRef.current) {
      editInputRef.current.focus()
      editInputRef.current.select()
    }
  }, [editingCell])

  // Optimistic add lead
  // Shared lead-insert path. Used by both the modal flow and the
  // inline-add row. Optimistically prepends a temp row, then swaps in
  // the persisted one (or rolls back on failure).
  const createLead = async (rawData: Record<string, string>) => {
    const tempId = `temp-${Date.now()}`
    const leadData = {
      ...rawData,
      date_added: rawData.date_added || new Date().toISOString().split('T')[0],
      status: rawData.status || 'new',
    }

    const tempLead: Lead = {
      id: tempId,
      data: leadData,
      position: leads.length,
      created_at: new Date().toISOString(),
    }

    setLeads((prev) => [...prev, tempLead])
    setPendingLeads((prev) => new Set(prev).add(tempId))

    try {
      const { data, error } = await supabase
        .from('leads')
        .insert({
          client_id: clientId,
          data: leadData,
          position: leads.length,
        })
        .select()
        .single()

      if (error) throw error
      setLeads((prev) => prev.map((l) => (l.id === tempId ? data : l)))

      // Fire-and-forget in-app notification to every CRM team member.
      // /api/notifications/create gates by each user's notify_new_lead
      // pref so opted-out users see nothing. Failures are swallowed -
      // the lead is already saved.
      const leadName =
        (rawData.name && rawData.name.trim())
          || (rawData.email && rawData.email.trim())
          || 'New lead'
      void fetch('/api/notifications/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          type: 'lead_created',
          data: { leadName, source: 'manual' },
        }),
      }).catch((e) => console.error('lead notification failed:', e))
    } catch (err) {
      console.error('Failed to create lead:', err instanceof Error ? err.message : err)
      setLeads((prev) => prev.filter((l) => l.id !== tempId))
    } finally {
      setPendingLeads((prev) => {
        const next = new Set(prev)
        next.delete(tempId)
        return next
      })
    }
  }

  const handleAddLead = async () => {
    setShowAddLead(false)
    const draft = { ...newLead }
    setNewLead({})
    await createLead(draft)
  }

  // Save the inline draft if it has any user input. Called when the
  // user blurs the row or hits Enter. Empty drafts are dropped silently.
  const commitInlineDraft = async () => {
    if (!inlineDraft) return
    const hasContent = Object.values(inlineDraft).some(
      (v) => typeof v === 'string' && v.trim().length > 0,
    )
    const draft = inlineDraft
    setInlineDraft(null)
    if (hasContent) await createLead(draft)
  }

  // Optimistic update lead
    const handleUpdateLead = useCallback(async (leadId: string, fieldKey: string, value: string) => {
    const lead = leads.find(l => l.id === leadId)
    if (!lead) return

    const updatedData = { ...lead.data, [fieldKey]: value }
    const updatedAt = new Date().toISOString()

    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, data: updatedData, updated_at: updatedAt } : l))
    setPendingLeads(prev => new Set(prev).add(leadId))

    // A transient network / auth-token-refresh blip can make the first write
    // fail with an empty error and then succeed on retry (which is what you
    // saw). Retry a few times with a short backoff before giving up and
    // rolling the optimistic change back.
    let lastError: { message?: string; code?: string; details?: string } | null = null
    let saved = false
    for (let attempt = 0; attempt < 3; attempt++) {
      const { error } = await supabase
        .from('leads')
        .update({ data: updatedData, updated_at: updatedAt })
        .eq('id', leadId)
      if (!error) {
        saved = true
        break
      }
      lastError = error
      if (attempt < 2) await new Promise((r) => setTimeout(r, 300 * (attempt + 1)))
    }

    if (!saved) {
      console.error('Failed to update lead after retries:', {
        message: lastError?.message,
        code: lastError?.code,
        details: lastError?.details,
      })
      setLeads(prev => prev.map(l => l.id === leadId ? lead : l))
      toast.error('Could not save that change. Please try again.')
    }

    setPendingLeads(prev => {
      const next = new Set(prev)
      next.delete(leadId)
      return next
    })

    setEditingCell(null)
    setEditValue('')
    setStatusDropdown(null)
  }, [leads, supabase])

  // Optimistic delete lead
  const handleDeleteLead = async (leadId: string) => {
    const lead = leads.find(l => l.id === leadId)
    if (!lead) return

    setLeads(prev => prev.filter(l => l.id !== leadId))
    setShowLeadDetail(null)

    try {
      const { error } = await supabase.from('leads').delete().eq('id', leadId)
      if (error) throw error
    } catch (err) {
      console.error('Failed to delete lead:', err)
      setLeads(prev => [...prev, lead].sort((a, b) => a.position - b.position))
    }
  }

  // Add field
  const handleAddField = async () => {
    if (!canEditWorkspace) return
    if (!newField.name.trim()) return

    const fieldKey = newField.name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
    const tempId = `temp-${Date.now()}`

    const defaultOptions =
      newField.type === 'status' || newField.type === 'select'
        ? [{ value: 'option1', label: 'Option 1', color: '#3B82F6' }]
        : newField.type === 'url'
          ? buildUrlMetaOptions(
              // Only persist the label when the display style needs it.
              newField.urlDisplayType === 'hyperlink' ||
                newField.urlDisplayType === 'button'
                ? newField.urlLabel.trim()
                : '',
              newField.urlDefault.trim(),
            )
          : []

    const tempField: CustomField = {
      id: tempId,
      field_name: newField.name,
      field_key: fieldKey,
      field_type: newField.type,
      options: defaultOptions,
      position: fields.length,
      is_default: false,
      is_required: false,
      url_display_type: newField.type === 'url' ? newField.urlDisplayType : undefined,
    }

    setFields(prev => [...prev, tempField])
    setPendingFields(prev => new Set(prev).add(tempId))
    setShowAddField(false)
    setNewField({
      name: '',
      type: 'text',
      urlDisplayType: 'link',
      urlLabel: '',
      urlDefault: '',
    })

    try {
      const { data, error } = await supabase
        .from('custom_fields')
        .insert({
          client_id: clientId,
          field_name: newField.name,
          field_key: fieldKey,
          field_type: newField.type,
          // Insert uses the SAME options that the optimistic temp row
          // had (which already encodes the url label sentinel for
          // hyperlink/button URL fields).
          options: defaultOptions,
          position: fields.length,
          is_default: false,
          url_display_type:
            newField.type === 'url' ? newField.urlDisplayType : null,
        })
        .select()
        .single()

      if (error) throw error

      setFields(prev => prev.map(f => f.id === tempId ? data : f))
        } catch (err) {
      console.error('Failed to add field:', err instanceof Error ? err.message : err)
      setFields(prev => prev.filter(f => f.id !== tempId))
    } finally {
      setPendingFields(prev => {
        const next = new Set(prev)
        next.delete(tempId)
        return next
      })
    }
  }

  // Update field
const handleUpdateField = async (fieldId: string, updates: Partial<CustomField>) => {
  const field = fields.find((f) => f.id === fieldId)
  if (!field) return

  // Clean updates - ensure options don't have null values and remove duplicates
  let cleanOptions = updates.options
  if (cleanOptions) {
    // Remove nulls / invalids
    cleanOptions = cleanOptions.filter(
      (opt): opt is StatusOption =>
        !!opt && typeof opt.value === 'string' && typeof opt.label === 'string'
    )

    // Remove duplicates by value
    const seen = new Set<string>()
    cleanOptions = cleanOptions.filter((opt) => {
      if (seen.has(opt.value)) return false
      seen.add(opt.value)
      return true
    })
  }

  // Build updates in a type-safe way
  const cleanUpdates: Partial<CustomField> = { ...updates }

  // Only set options if caller intended to change options
  if (updates.options !== undefined) {
    // Ensure options is never undefined (only array or null)
    cleanUpdates.options =
      cleanOptions && cleanOptions.length > 0 ? cleanOptions : null
  }

  // Optimistic update
  setFields((prev) =>
    prev.map((f) => (f.id === fieldId ? { ...f, ...cleanUpdates } : f))
  )
  setPendingFields((prev) => new Set(prev).add(fieldId))

  try {
    const { error } = await supabase
      .from('custom_fields')
      .update(cleanUpdates)
      .eq('id', fieldId)

    if (error) {
      console.error('Failed to update field:', error)
      // Rollback
      setFields((prev) => prev.map((f) => (f.id === fieldId ? field : f)))
    }
  } catch (err) {
    console.error('Failed to update field:', err)
    setFields((prev) => prev.map((f) => (f.id === fieldId ? field : f)))
  } finally {
    setPendingFields((prev) => {
      const next = new Set(prev)
      next.delete(fieldId)
      return next
    })
  }
}

  // Delete field
  const handleDeleteField = async (fieldId: string) => {
    if (!canEditWorkspace) return
    const field = fields.find(f => f.id === fieldId)
    if (!field || field.is_default) return

    setFields(prev => prev.filter(f => f.id !== fieldId))
    setShowFieldSettings(null)

    try {
      const { error } = await supabase.from('custom_fields').delete().eq('id', fieldId)
      if (error) throw error
    } catch (err) {
      console.error('Failed to delete field:', err)
      setFields(prev => [...prev, field].sort((a, b) => a.position - b.position))
    }
  }

  // Status option handlers
const handleAddStatusOption = async (fieldId: string, option: StatusOption) => {
  const field = fields.find(f => f.id === fieldId)
  if (!field) return
  
  const currentOptions = getFieldOptions(field)
  
  // Check if option with same value already exists
  if (currentOptions.some(o => o.value === option.value)) {
    // Generate unique value
    option.value = `${option.value}_${Date.now()}`
  }
  
  const newOptions = [...currentOptions, option]
  await handleUpdateField(fieldId, { options: newOptions })
}
  const handleUpdateStatusOption = async (fieldId: string, optionValue: string, updates: Partial<StatusOption>) => {
    const field = fields.find(f => f.id === fieldId)
    if (!field) return
    const currentOptions = getFieldOptions(field)
    const newOptions = currentOptions.map(o => o.value === optionValue ? { ...o, ...updates } : o)
    await handleUpdateField(fieldId, { options: newOptions })
  }

  const handleDeleteStatusOption = async (fieldId: string, optionValue: string) => {
    const field = fields.find(f => f.id === fieldId)
    if (!field) return
    const currentOptions = getFieldOptions(field)
    const newOptions = currentOptions.filter(o => o.value !== optionValue)
    await handleUpdateField(fieldId, { options: newOptions })
  }

  const handleReorderStatusOptions = async (fieldId: string, fromIndex: number, toIndex: number) => {
    const field = fields.find(f => f.id === fieldId)
    if (!field) return
    const currentOptions = getFieldOptions(field)
    const newOptions = [...currentOptions]
    const [removed] = newOptions.splice(fromIndex, 1)
    newOptions.splice(toIndex, 0, removed)
    await handleUpdateField(fieldId, { options: newOptions })
  }

  // Cell handlers
    const handleCellClick = (e: React.MouseEvent, leadId: string, fieldKey: string, value: string, fieldType: string) => {
    e.stopPropagation()
    if (fieldType === 'status' || fieldType === 'select') {
      setStatusDropdown({ leadId, fieldKey })
    } else if (fieldType === 'checkbox') {
      // Checkbox is its own input - the click on the cell shouldn't
      // open an edit input. The checkbox itself handles the toggle.
      return
    } else if (fieldType === 'url') {
      const parsed = parseUrlValue(value || '')
      setEditingCell({ leadId, fieldKey })
      setEditValue(parsed.url)
      setEditUrlText(parsed.text)
    } else {
      setEditingCell({ leadId, fieldKey })
      setEditValue(value || '')
      setEditUrlText('')
    }
  }

  const handleCellBlur = () => {
    if (!editingCell) return
    const field = fields.find((f) => f.field_key === editingCell.fieldKey)
    const next =
      field?.field_type === 'url'
        ? serializeUrlValue(editValue.trim(), editUrlText.trim())
        : editValue
    handleUpdateLead(editingCell.leadId, editingCell.fieldKey, next)
  }

  const handleCellKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleCellBlur()
    else if (e.key === 'Escape') {
      setEditingCell(null)
      setEditValue('')
      setEditUrlText('')
    }
  }

  // Drag handlers for board view
  const handleDragStart = (e: React.DragEvent, lead: Lead) => {
    setDraggedLead(lead)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e: React.DragEvent, status: string) => {
    e.preventDefault()
    setDragOverStatus(status)
  }

  const handleDrop = (e: React.DragEvent, status: string) => {
    e.preventDefault()
    const statusKey = fields.find(f => f.field_type === 'status')?.field_key || 'status'
    if (draggedLead && draggedLead.data?.[statusKey] !== status) {
      handleUpdateLead(draggedLead.id, statusKey, status)
    }
    setDraggedLead(null)
    setDragOverStatus(null)
  }

  // ---- Table row reorder ------------------------------------------------

  const handleRowDragStart = (e: React.DragEvent, leadId: string) => {
    setDraggedRowId(leadId)
    e.dataTransfer.effectAllowed = 'move'
    // Drag-reorder only takes effect under manual sort - flip to it
    // automatically so the user's drop sticks instead of being
    // immediately overridden by date / name sorting.
    if (sortBy !== 'manual') setSortBy('manual')
  }
  const handleRowDragOver = (e: React.DragEvent, leadId: string) => {
    if (!draggedRowId || draggedRowId === leadId) return
    e.preventDefault()
    setDragOverRowId(leadId)
  }
  const handleRowDrop = async (e: React.DragEvent, targetLeadId: string) => {
    e.preventDefault()
    if (!draggedRowId || draggedRowId === targetLeadId) {
      setDraggedRowId(null)
      setDragOverRowId(null)
      return
    }
    // Reorder the in-memory array and recompute positions. We send
    // updates only for the rows whose position changed (the contiguous
    // range between source and target) - the rest stay put.
    const ordered = [...leads].sort((a, b) => a.position - b.position)
    const fromIdx = ordered.findIndex((l) => l.id === draggedRowId)
    const toIdx = ordered.findIndex((l) => l.id === targetLeadId)
    if (fromIdx < 0 || toIdx < 0) {
      setDraggedRowId(null)
      setDragOverRowId(null)
      return
    }
    const [moved] = ordered.splice(fromIdx, 1)
    ordered.splice(toIdx, 0, moved)
    const reindexed = ordered.map((l, i) => ({ ...l, position: i }))
    setLeads(reindexed)
    setDraggedRowId(null)
    setDragOverRowId(null)
    // Persist only the ones whose position actually changed.
    const changed = reindexed.filter((l) => {
      const prior = leads.find((p) => p.id === l.id)
      return prior && prior.position !== l.position
    })
    try {
      await Promise.all(
        changed.map((l) =>
          supabase
            .from('leads')
            .update({ position: l.position })
            .eq('id', l.id),
        ),
      )
    } catch (err) {
      console.error('Reorder leads failed:', err)
    }
  }

  // ---- Table column reorder ---------------------------------------------

  const handleColumnDragStart = (e: React.DragEvent, fieldId: string) => {
    if (!canEditWorkspace) return
    setDraggedColumnId(fieldId)
    e.dataTransfer.effectAllowed = 'move'
  }
  const handleColumnDragOver = (e: React.DragEvent, fieldId: string) => {
    if (!draggedColumnId || draggedColumnId === fieldId) return
    e.preventDefault()
    setDragOverColumnId(fieldId)
  }
  const handleColumnDrop = async (e: React.DragEvent, targetFieldId: string) => {
    e.preventDefault()
    if (!draggedColumnId || draggedColumnId === targetFieldId) {
      setDraggedColumnId(null)
      setDragOverColumnId(null)
      return
    }
    const ordered = [...fields].sort((a, b) => a.position - b.position)
    const fromIdx = ordered.findIndex((f) => f.id === draggedColumnId)
    const toIdx = ordered.findIndex((f) => f.id === targetFieldId)
    if (fromIdx < 0 || toIdx < 0) {
      setDraggedColumnId(null)
      setDragOverColumnId(null)
      return
    }
    const [moved] = ordered.splice(fromIdx, 1)
    ordered.splice(toIdx, 0, moved)
    const reindexed = ordered.map((f, i) => ({ ...f, position: i }))
    setFields(reindexed)
    setDraggedColumnId(null)
    setDragOverColumnId(null)
    const changed = reindexed.filter((f) => {
      const prior = fields.find((p) => p.id === f.id)
      return prior && prior.position !== f.position
    })
    try {
      await Promise.all(
        changed.map((f) =>
          supabase
            .from('custom_fields')
            .update({ position: f.position })
            .eq('id', f.id),
        ),
      )
    } catch (err) {
      console.error('Reorder columns failed:', err)
    }
  }

  // While a lead is being dragged across the board, auto-scroll the
  // horizontal container when the cursor approaches its left/right
  // edge. Without this, dropping past the visible columns would
  // require manual scrolling first - which breaks the drag.
  useEffect(() => {
    if (!draggedLead) return
    const container = boardScrollRef.current
    if (!container) return

    const EDGE_PX = 80
    const MAX_SPEED = 18 // px per frame at the very edge
    let dir = 0
    let intensity = 0 // 0 to 1, ramps up as cursor gets closer to edge
    let raf = 0

    const onDragOver = (e: DragEvent) => {
      const rect = container.getBoundingClientRect()
      const x = e.clientX
      const leftDist = x - rect.left
      const rightDist = rect.right - x
      if (leftDist < EDGE_PX && leftDist >= 0) {
        dir = -1
        intensity = 1 - leftDist / EDGE_PX
      } else if (rightDist < EDGE_PX && rightDist >= 0) {
        dir = 1
        intensity = 1 - rightDist / EDGE_PX
      } else {
        dir = 0
      }
    }

    const tick = () => {
      if (dir !== 0) {
        container.scrollLeft += dir * MAX_SPEED * intensity
      }
      raf = requestAnimationFrame(tick)
    }

    document.addEventListener('dragover', onDragOver)
    raf = requestAnimationFrame(tick)
    return () => {
      document.removeEventListener('dragover', onDragOver)
      cancelAnimationFrame(raf)
    }
  }, [draggedLead])

  // Filter leads by search query
  const filteredLeads = (() => {
    const query = searchQuery.toLowerCase().trim()
    const base = leads.filter((lead) => {
      if (statusFilter !== 'all') {
        const status = (lead.data as { status?: unknown } | null)?.status
        if (typeof status !== 'string' || status !== statusFilter) return false
      }
      if (query) {
        const matches = Object.values(lead.data || {}).some(
          (v) =>
            v !== null &&
            v !== undefined &&
            String(v).toLowerCase().includes(query),
        )
        if (!matches) return false
      }
      return true
    })

    const nameOf = (l: Lead) => {
      const d = (l.data || {}) as Record<string, unknown>
      const n =
        (typeof d.name === 'string' && d.name) ||
        (typeof d.email === 'string' && d.email) ||
        ''
      return n.toLowerCase()
    }
    const created = (l: Lead) => new Date(l.created_at).getTime()
    const updated = (l: Lead) =>
      new Date(l.updated_at || l.created_at).getTime()

    const sorted = [...base]
    switch (sortBy) {
      case 'manual':
        // Manual order = whatever the user dragged the rows into.
        sorted.sort((a, b) => a.position - b.position)
        break
      case 'newest':
        sorted.sort((a, b) => created(b) - created(a))
        break
      case 'oldest':
        sorted.sort((a, b) => created(a) - created(b))
        break
      case 'updated':
        sorted.sort((a, b) => updated(b) - updated(a))
        break
      case 'az':
        sorted.sort((a, b) => nameOf(a).localeCompare(nameOf(b)))
        break
      case 'za':
        sorted.sort((a, b) => nameOf(b).localeCompare(nameOf(a)))
        break
    }
    return sorted
  })()

  // Get status field and its options safely
  const statusField = fields.find(f => f.field_type === 'status')
  const statusFieldKey = statusField?.field_key || 'status'
  const statusOptions = statusField ? getFieldOptions(statusField) : []

  // Chart data with null safety
  const chartData = statusOptions.map(status => ({
    ...status,
    count: filteredLeads.filter(l => l.data?.[statusFieldKey] === status.value).length,
  }))

  // ---- PDF export -------------------------------------------------------

  const handleExportPdf = async () => {
    if (isExporting) return
    setIsExporting(true)
    try {
      const [{ pdf }, { LeadsReport }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('@/components/reports/LeadsReport'),
      ])

      const knownStatuses = new Set(statusOptions.map((s) => s.value))
      const closedKeys = statusOptions
        .filter((s) =>
          ['closed', 'won', 'paid'].some((c) =>
            s.value.toLowerCase().includes(c),
          ),
        )
        .map((s) => s.value)
      const closedSet = new Set(closedKeys)

      // Per-status counts within the current filtered view.
      const counts = new Map<string, number>()
      let unsetCount = 0
      let closed = 0
      for (const l of filteredLeads) {
        const raw = (l.data as { status?: unknown } | null)?.status
        const sk =
          typeof raw === 'string' && raw && knownStatuses.has(raw)
            ? raw
            : null
        if (sk == null) {
          unsetCount++
        } else {
          counts.set(sk, (counts.get(sk) || 0) + 1)
          if (closedSet.has(sk)) closed++
        }
      }

      const byStatus: LeadsReportStatus[] = statusOptions
        .map((s) => ({
          value: s.value,
          label: s.label,
          color: s.color,
          count: counts.get(s.value) || 0,
        }))
        .filter((s) => s.count > 0)

      const total = filteredLeads.length
      const conversionPct = total === 0 ? 0 : Math.round((closed / total) * 100)

      // Period split for the week-over-week delta - uses the unfiltered
      // leads list so the trend reflects the workspace, not the
      // currently-typed search.
      const weekMs = 7 * 24 * 60 * 60 * 1000
      const now = Date.now()
      const newThisWeek = leads.filter(
        (l) => new Date(l.created_at).getTime() >= now - weekMs,
      ).length
      const newPriorWeek = leads.filter((l) => {
        const t = new Date(l.created_at).getTime()
        return t < now - weekMs && t >= now - 2 * weekMs
      }).length
      const weekDelta =
        newPriorWeek === 0
          ? newThisWeek === 0
            ? 0
            : 100
          : Math.round(((newThisWeek - newPriorWeek) / newPriorWeek) * 100)

      const rows: LeadsReportRow[] = filteredLeads.map((l) => {
        const data = (l.data || {}) as Record<string, unknown>
        const name =
          (typeof data.name === 'string' && data.name) ||
          (typeof data.email === 'string' && data.email) ||
          'Unnamed lead'
        const email = typeof data.email === 'string' ? data.email : null
        const raw = data[statusFieldKey]
        const sk =
          typeof raw === 'string' && raw && knownStatuses.has(raw)
            ? raw
            : null
        return {
          name,
          email,
          statusValue: sk,
          createdDate: l.created_at,
          updatedDate: l.updated_at || null,
        }
      })

      const filters: string[] = []
      if (searchQuery.trim()) filters.push(`Search: "${searchQuery.trim()}"`)

      const blob = await pdf(
        <LeadsReport
          workspaceName={workspaceName}
          filters={filters}
          metrics={{
            total,
            thisWeek: newThisWeek,
            weekDelta,
            closed,
            conversionPct,
          }}
          byStatus={byStatus}
          unsetCount={unsetCount}
          rows={rows}
        />,
      ).toBlob()

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const stamp = new Date().toISOString().slice(0, 10)
      a.download = `${workspaceName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-leads-${stamp}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (err) {
      console.error('Leads PDF export failed:', err)
      alert('Could not generate PDF. Check the console for details.')
    } finally {
      setIsExporting(false)
    }
  }

  function LeadsSkeleton() {
  return (
    <div className="p-3 sm:p-4 lg:p-6 min-h-full animate-in fade-in">
      <div className="mb-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <Skeleton className="h-3 w-24 bg-[var(--bg-card-hover)]" />
          <Skeleton className="h-8 w-16 rounded-lg sm:hidden bg-[var(--bg-card-hover)]" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 sm:h-10 flex-1 rounded-xl bg-[var(--bg-card-hover)]" />
          <Skeleton className="h-9 sm:h-10 w-32 rounded-xl bg-[var(--bg-card-hover)]" />
          <Skeleton className="hidden sm:block h-10 w-28 rounded-lg bg-[var(--bg-card-hover)]" />
        </div>
      </div>

      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border-primary)] overflow-hidden">
        <div className="border-b border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4 flex gap-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-3 w-24 sm:w-32 bg-[var(--bg-card-hover)] shrink-0" />
          ))}
        </div>
        <div className="divide-y divide-[var(--border-primary)]">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="p-4 flex gap-4">
              <Skeleton className="h-4 w-24 sm:w-32 bg-[var(--bg-card-hover)] shrink-0" />
              <Skeleton className="h-4 w-32 sm:w-48 bg-[var(--bg-card-hover)] shrink-0" />
              <Skeleton className="h-4 w-20 sm:w-24 bg-[var(--bg-card-hover)] shrink-0" />
              <Skeleton className="h-6 w-16 sm:w-20 rounded-full bg-[var(--bg-card-hover)] shrink-0" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

  if (isLoading) {
    return <LeadsSkeleton />
  }

  return <div className="p-3 sm:p-4 lg:p-6 min-h-full">
        {/* Header */}
        <div className="mb-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-[var(--text-tertiary)]">{leads.length} total leads</p>
          </div>

          <div className="flex items-center gap-2">
            {/* Search */}
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-tertiary)]" />
              <input
                type="text"
                placeholder="Search leads..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-3 py-2 sm:py-2.5 bg-[var(--bg-input)] border border-[var(--border-primary)] rounded-xl text-sm text-[var(--text-primary)] placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#2B79F7] focus:border-transparent transition-all"
              />
            </div>

            {/* View Toggle - icons with on-hover tooltip labels */}
            <div className="flex bg-[var(--bg-card)] rounded-xl p-1 border border-[var(--border-primary)] shrink-0">
              <Tooltip content="Table view" position="bottom">
                <button
                  type="button"
                  onClick={() => setView('table')}
                  aria-label="Table view"
                  className={`p-2 sm:p-2.5 rounded-lg transition-all ${
                    view === 'table'
                      ? 'bg-[#2B79F7] text-white shadow-lg'
                      : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]'
                  }`}
                >
                  <Table2 className="h-4 w-4" />
                </button>
              </Tooltip>
              <Tooltip content="Board view" position="bottom">
                <button
                  type="button"
                  onClick={() => setView('board')}
                  aria-label="Board view"
                  className={`p-2 sm:p-2.5 rounded-lg transition-all ${
                    view === 'board'
                      ? 'bg-[#2B79F7] text-white shadow-lg'
                      : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]'
                  }`}
                >
                  <Kanban className="h-4 w-4" />
                </button>
              </Tooltip>
              <Tooltip content="Chart view" position="bottom">
                <button
                  type="button"
                  onClick={() => setView('chart')}
                  aria-label="Chart view"
                  className={`p-2 sm:p-2.5 rounded-lg transition-all ${
                    view === 'chart'
                      ? 'bg-[#2B79F7] text-white shadow-lg'
                      : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]'
                  }`}
                >
                  <BarChart3 className="h-4 w-4" />
                </button>
              </Tooltip>
            </div>

            <KebabMenu
              items={[
                { type: 'section', label: 'Actions' },
                {
                  label: 'Add lead…',
                  icon: <Plus className="h-4 w-4" />,
                  hint: 'Open the form modal',
                  onClick: () => setShowAddLead(true),
                },
                {
                  label: isExporting ? 'Generating PDF…' : 'Export as PDF',
                  icon: <FileDown className="h-4 w-4" />,
                  disabled: isExporting,
                  onClick: handleExportPdf,
                },
                { type: 'section', label: 'Sort by' },
                {
                  label: 'Manual order',
                  hint: 'Drag rows to reorder',
                  active: sortBy === 'manual',
                  onClick: () => setSortBy('manual'),
                },
                {
                  label: 'Newest first',
                  active: sortBy === 'newest',
                  onClick: () => setSortBy('newest'),
                },
                {
                  label: 'Oldest first',
                  active: sortBy === 'oldest',
                  onClick: () => setSortBy('oldest'),
                },
                {
                  label: 'Recently updated',
                  active: sortBy === 'updated',
                  onClick: () => setSortBy('updated'),
                },
                {
                  label: 'Name A → Z',
                  active: sortBy === 'az',
                  onClick: () => setSortBy('az'),
                },
                {
                  label: 'Name Z → A',
                  active: sortBy === 'za',
                  onClick: () => setSortBy('za'),
                },
                { type: 'section', label: 'Filter by status' },
                {
                  label: 'All statuses',
                  active: statusFilter === 'all',
                  onClick: () => setStatusFilter('all'),
                },
                ...statusOptions.map((s) => ({
                  label: s.label,
                  active: statusFilter === s.value,
                  onClick: () => setStatusFilter(s.value),
                })),
              ]}
            />
          </div>
        </div>

        {/* Table View */}
        {view === 'table' && (
          <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border-primary)] overflow-hidden shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]">
                    <th className="w-10 px-3 py-4" />
                    {fields.map((field) => {
                      // Center checkbox column headers so the property
                      // name + icon align directly above the centered
                      // checkboxes in the cells below. The settings cog
                      // is absolutely positioned so its (invisible)
                      // flex space doesn't pull the centered content off
                      // to one side.
                      const isCheckbox = field.field_type === 'checkbox'
                      const isDragging = draggedColumnId === field.id
                      const isDragOver = dragOverColumnId === field.id
                      return (
                        <th
                          key={field.id}
                          draggable={canEditWorkspace}
                          onDragStart={(e) =>
                            handleColumnDragStart(e, field.id)
                          }
                          onDragOver={(e) =>
                            handleColumnDragOver(e, field.id)
                          }
                          onDragLeave={() => {
                            if (dragOverColumnId === field.id)
                              setDragOverColumnId(null)
                          }}
                          onDrop={(e) => handleColumnDrop(e, field.id)}
                          onDragEnd={() => {
                            setDraggedColumnId(null)
                            setDragOverColumnId(null)
                          }}
                          className={`relative px-4 py-4 text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider min-w-[150px] group transition-colors ${
                            isCheckbox ? 'text-center' : 'text-left'
                          } ${pendingFields.has(field.id) ? 'opacity-50' : ''} ${
                            isDragging
                              ? 'opacity-40'
                              : isDragOver
                                ? 'bg-[#2B79F7]/15'
                                : ''
                          } ${canEditWorkspace ? 'cursor-grab active:cursor-grabbing' : ''}`}
                        >
                          {isCheckbox ? (
                            <div className="flex items-center justify-center gap-2">
                              {fieldTypeConfig[field.field_type] && (
                                <span className="text-[var(--text-tertiary)]">
                                  {(() => {
                                    const Icon =
                                      fieldTypeConfig[field.field_type].icon
                                    return <Icon className="h-3.5 w-3.5" />
                                  })()}
                                </span>
                              )}
                              <span>{field.field_name}</span>
                            </div>
                          ) : (
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                {fieldTypeConfig[field.field_type] && (
                                  <span className="text-[var(--text-tertiary)]">
                                    {(() => {
                                      const Icon =
                                        fieldTypeConfig[field.field_type].icon
                                      return <Icon className="h-3.5 w-3.5" />
                                    })()}
                                  </span>
                                )}
                                <span>{field.field_name}</span>
                              </div>
                              {canEditWorkspace && (
                                <button
                                  onClick={() =>
                                    setShowFieldSettings(field)
                                  }
                                  className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-[var(--bg-card-hover)] rounded-lg transition-all"
                                >
                                  <Settings2 className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
                                </button>
                              )}
                            </div>
                          )}
                          {isCheckbox && canEditWorkspace && (
                            <button
                              onClick={() => setShowFieldSettings(field)}
                              className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-1.5 hover:bg-[var(--bg-card-hover)] rounded-lg transition-all"
                            >
                              <Settings2 className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
                            </button>
                          )}
                        </th>
                      )
                    })}
                    <th className="w-12 px-3 py-4 bg-[var(--bg-secondary)]">
                      {canEditWorkspace && (
                        <button
                          onClick={() => setShowAddField(true)}
                          className="p-2 hover:bg-[var(--bg-card-hover)] rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-all"
                          title="Add Property"
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      )}
                    </th>
                    <th className="w-10 px-3 py-4 bg-[var(--bg-secondary)]" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-primary)]">
                  {filteredLeads.map((lead) => (
                    <tr
                      key={lead.id}
                      ref={(el) => {
                        // Scroll the focused row into view + briefly
                        // pulse it. Only fires when the ref node
                        // mounts so the effect runs once per arrival
                        // from a notification deep-link.
                        if (el && focusedLeadId === lead.id) {
                          el.classList.add('focus-pulse')
                          el.scrollIntoView({ behavior: 'smooth', block: 'center' })
                          setTimeout(() => el.classList.remove('focus-pulse'), 3000)
                        }
                      }}
                      className={`group transition-colors cursor-pointer ${
                        pendingLeads.has(lead.id) ? 'opacity-50' : ''
                      } ${
                        draggedRowId === lead.id
                          ? 'opacity-40'
                          : dragOverRowId === lead.id
                            ? 'bg-[#2B79F7]/10'
                            : 'hover:bg-[var(--bg-card-hover)]/50'
                      }`}
                      onClick={() => setShowLeadDetail(lead)}
                      onDragOver={(e) => handleRowDragOver(e, lead.id)}
                      onDragLeave={() => {
                        if (dragOverRowId === lead.id) setDragOverRowId(null)
                      }}
                      onDrop={(e) => handleRowDrop(e, lead.id)}
                    >
                      <td
                        className="px-3 py-3 bg-[var(--bg-card)]"
                        draggable
                        onDragStart={(e) => {
                          // Use the entire row as the drag preview (ClickUp
                          // pattern) instead of just the handle cell. Without
                          // this the browser drags only the <td> the user
                          // grabbed, which looks like a tiny floating sliver.
                          const row = (e.currentTarget as HTMLElement).closest('tr')
                          if (row) {
                            // Offset the image so the cursor sits inside the
                            // row rather than at the top-left corner.
                            e.dataTransfer.setDragImage(row, 20, 20)
                          }
                          handleRowDragStart(e, lead.id)
                        }}
                        onDragEnd={() => {
                          setDraggedRowId(null)
                          setDragOverRowId(null)
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <GripVertical className="h-4 w-4 text-[var(--text-secondary)] opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing" />
                      </td>
                      {fields.map((field) => {
                        const value = (lead.data?.[field.field_key] as string) || ''
                        const isEditing = editingCell?.leadId === lead.id && editingCell?.fieldKey === field.field_key

                        return (
                          <td 
                            key={field.id} 
                            className="px-4 py-3 bg-[var(--bg-card)]"
                            onClick={(e) => handleCellClick(e, lead.id, field.field_key, value, field.field_type)}
                          >
                            {isEditing && field.field_type === 'url' ? (
                              // Wrapper handles the focus boundary so we
                              // only save when the user leaves BOTH inputs
                              // (tabbing between URL and Text doesn't fire
                              // a save). Same blur-to-save UX as before -
                              // no Save / Cancel buttons.
                              <div
                                className="space-y-1.5 min-w-[220px]"
                                onClick={(e) => e.stopPropagation()}
                                onBlur={(e) => {
                                  const next = e.relatedTarget as Node | null
                                  if (!e.currentTarget.contains(next)) {
                                    handleCellBlur()
                                  }
                                }}
                              >
                                {(field.url_display_type === 'hyperlink' ||
                                  field.url_display_type === 'button') && (
                                  <input
                                    type="text"
                                    autoFocus
                                    value={editUrlText}
                                    onChange={(e) =>
                                      setEditUrlText(e.target.value)
                                    }
                                    onKeyDown={handleCellKeyDown}
                                    placeholder="Display text (e.g. Click here)"
                                    className="w-full px-3 py-1.5 bg-[var(--bg-input)] border-2 border-[#2B79F7] rounded-lg text-[var(--text-primary)] focus:outline-none text-sm"
                                  />
                                )}
                                <input
                                  ref={editInputRef}
                                  type="url"
                                  // Only autofocus the URL input when
                                  // there's no text input above it (raw
                                  // link mode).
                                  autoFocus={
                                    field.url_display_type !== 'hyperlink' &&
                                    field.url_display_type !== 'button'
                                  }
                                  value={editValue}
                                  onChange={(e) => setEditValue(e.target.value)}
                                  onKeyDown={handleCellKeyDown}
                                  placeholder={
                                    getFieldUrlDefault(field) ||
                                    'https://...'
                                  }
                                  className={`w-full px-3 py-1.5 bg-[var(--bg-input)] border-2 ${
                                    field.url_display_type === 'hyperlink' ||
                                    field.url_display_type === 'button'
                                      ? 'border-[var(--border-primary)]'
                                      : 'border-[#2B79F7]'
                                  } rounded-lg text-[var(--text-primary)] focus:outline-none focus:border-[#2B79F7] text-sm`}
                                />
                              </div>
                            ) : isEditing ? (
                              <input
                                ref={editInputRef}
                                type={field.field_type === 'email' ? 'email' : field.field_type === 'date' ? 'date' : field.field_type === 'number' ? 'number' : 'text'}
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onBlur={handleCellBlur}
                                onKeyDown={handleCellKeyDown}
                                className="w-full px-3 py-1.5 bg-[var(--bg-input)] border-2 border-[#2B79F7] rounded-lg text-[var(--text-primary)] focus:outline-none text-sm"
                                onClick={(e) => e.stopPropagation()}
                              />
                            ) : field.field_type === 'status' || field.field_type === 'select' ? (
                              <StatusBadge value={value} options={getFieldOptions(field)} />
                            ) : field.field_type === 'url' &&
                              (value || getFieldUrlDefault(field)) ? (
                              <UrlDisplay
                                value={value}
                                displayType={field.url_display_type || 'link'}
                                fieldName={field.field_name}
                                fieldLabel={getFieldUrlLabel(field)}
                                fieldDefaultUrl={getFieldUrlDefault(field)}
                              />
                            ) : field.field_type === 'checkbox' ? (
                            <div className="text-center w-full">
                              <input
                                type="checkbox"
                                checked={value === 'true'}
                                onChange={(e) =>
                                  handleUpdateLead(
                                    lead.id,
                                    field.field_key,
                                    e.target.checked ? 'true' : '',
                                  )
                                }
                                onClick={(e) => e.stopPropagation()}
                                className="h-4 w-4 accent-[#2B79F7] cursor-pointer align-middle"
                              />
                            </div>
                          ) : (
                            <span className="text-[var(--text-primary)] block min-h-6 px-2 py-1 rounded hover:bg-[var(--bg-card-hover)] transition-colors">
                              {(value as string) || <span className="text-[var(--text-tertiary)]">-</span>}
                            </span>
                            )}
                          </td>
                        )
                      })}
                      <td className="bg-[var(--bg-card)]" />
                      <td className="px-3 py-3 bg-[var(--bg-card)]">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleDeleteLead(lead.id)
                          }}
                          className="opacity-0 group-hover:opacity-100 p-2 hover:bg-red-500/20 rounded-lg text-red-400 transition-all"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {/* Inline draft row - editable cells, no modal. */}
                  {inlineDraft && (
                    <tr
                      className="bg-[var(--bg-secondary)]"
                      onBlur={(e) => {
                        const next = e.relatedTarget as Node | null
                        if (!e.currentTarget.contains(next)) {
                          void commitInlineDraft()
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          void commitInlineDraft()
                        } else if (e.key === 'Escape') {
                          setInlineDraft(null)
                        }
                      }}
                    >
                      <td />
                      {fields.map((field, idx) => {
                        const draftValue = inlineDraft[field.field_key] || ''
                        const isStatusLike =
                          field.field_type === 'status' ||
                          field.field_type === 'select'
                        return (
                          <td
                            key={field.id}
                            className="px-4 py-3 bg-[var(--bg-secondary)]"
                          >
                            {isStatusLike ? (
                              <select
                                value={draftValue}
                                onChange={(e) =>
                                  setInlineDraft((prev) => ({
                                    ...(prev || {}),
                                    [field.field_key]: e.target.value,
                                  }))
                                }
                                className="w-full px-2 py-1 bg-[var(--bg-input)] border border-[var(--border-primary)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7] text-sm"
                              >
                                <option value="">Select…</option>
                                {getFieldOptions(field).map((opt, i) => (
                                  <option
                                    key={`${opt.value}-${i}`}
                                    value={opt.value}
                                  >
                                    {opt.label}
                                  </option>
                                ))}
                              </select>
                            ) : field.field_type === 'checkbox' ? (
                              <div className="text-center w-full">
                                <input
                                  type="checkbox"
                                  checked={draftValue === 'true'}
                                  onChange={(e) =>
                                    setInlineDraft((prev) => ({
                                      ...(prev || {}),
                                      [field.field_key]: e.target.checked
                                        ? 'true'
                                        : '',
                                    }))
                                  }
                                  className="h-4 w-4 accent-[#2B79F7] cursor-pointer align-middle"
                                />
                              </div>
                            ) : (
                              <input
                                ref={
                                  idx === 0 ? inlineFirstInputRef : undefined
                                }
                                type={
                                  field.field_type === 'email'
                                    ? 'email'
                                    : field.field_type === 'date'
                                      ? 'date'
                                      : field.field_type === 'number'
                                        ? 'number'
                                        : 'text'
                                }
                                value={draftValue}
                                onChange={(e) =>
                                  setInlineDraft((prev) => ({
                                    ...(prev || {}),
                                    [field.field_key]: e.target.value,
                                  }))
                                }
                                placeholder={field.field_name}
                                className="w-full px-2 py-1 bg-[var(--bg-input)] border border-[var(--border-primary)] rounded-lg text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7] text-sm"
                              />
                            )}
                          </td>
                        )
                      })}
                      <td colSpan={2} />
                    </tr>
                  )}
                  {/* "+ Add a lead" placeholder - always visible. */}
                  <tr className="bg-[var(--bg-secondary)]">
                    <td />
                    <td colSpan={fields.length + 2} className="px-4 py-3">
                      <button
                        onClick={() => {
                          // Open inline draft + focus first cell on next tick.
                          setInlineDraft({})
                          setTimeout(() => {
                            inlineFirstInputRef.current?.focus()
                          }, 0)
                        }}
                        className="flex items-center gap-2 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
                      >
                        <Plus className="h-4 w-4" />
                        <span className="text-sm">Add a lead</span>
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Board View */}
        {view === 'board' && (
          <div
            ref={boardScrollRef}
            className="flex items-start gap-4 overflow-x-auto pb-4"
          >
            {statusOptions.length === 0 ? (
              <div className="flex-1 flex items-center justify-center py-12">
                <div className="text-center">
                  <Kanban className="h-12 w-12 text-[var(--text-secondary)] mx-auto mb-4" />
                  <p className="text-[var(--text-tertiary)]">No status options configured</p>
                  <p className="text-[var(--text-tertiary)] text-sm mt-1">Add a status field with options to use board view</p>
                </div>
              </div>
            ) : (
              statusOptions.map((status, statusIndex) => {
                const statusLeads = filteredLeads.filter(l => l.data?.[statusFieldKey] === status.value)
                const isDragOver = dragOverStatus === status.value

                return (
                  <div 
                    key={`${status.value}-${statusIndex}`}
                    className="shrink-0 w-[300px]"
                    onDragOver={(e) => handleDragOver(e, status.value)}
                    onDragLeave={() => setDragOverStatus(null)}
                    onDrop={(e) => handleDrop(e, status.value)}
                  >
                    <div className={`bg-[var(--bg-card)] rounded-2xl border transition-colors shadow-xl ${
                      isDragOver ? 'border-[#2B79F7] bg-[#2B79F7]/10' : 'border-[var(--border-primary)]'
                    }`}>
                      {/* Column Header */}
                      <div className="px-3 py-2.5 border-b border-[var(--border-primary)]">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 min-w-0">
                            <div
                              className="h-2 w-2 rounded-full shrink-0"
                              style={{ backgroundColor: status.color }}
                            />
                            <h3 className="text-sm font-semibold text-[var(--text-primary)] truncate">{status.label}</h3>
                          </div>
                          <span className="text-[10px] font-medium text-[var(--text-tertiary)] bg-[var(--bg-secondary)] px-2 py-0.5 rounded-full tabular-nums shrink-0">
                            {statusLeads.length}
                          </span>
                        </div>
                      </div>

                      {/* Cards */}
                      <div className="p-2 space-y-2 min-h-[80px]">
                        {statusLeads.map((lead) => {
                          const leadName = (lead.data?.name as string) || 'Unnamed Lead'
                          const leadEmail = (lead.data?.email as string) || ''
                          const leadPhone = (lead.data?.phone as string) || ''
                          const lastUpdated = lead.updated_at || lead.created_at || (lead.data?.date_added as string) || ''
                          const initial = leadName.charAt(0).toUpperCase()
                          return (
                            <div
                              key={lead.id}
                              className={`group bg-[var(--bg-secondary)] rounded-lg p-2.5 border border-[var(--border-primary)] hover:border-[#2B79F7] transition-all cursor-grab active:cursor-grabbing ${
                                draggedLead?.id === lead.id ? 'opacity-50 rotate-2 scale-105' : ''
                              } ${pendingLeads.has(lead.id) ? 'opacity-50' : ''}`}
                              draggable
                              onDragStart={(e) => handleDragStart(e, lead)}
                              onClick={() => setShowLeadDetail(lead)}
                            >
                              <div className="flex items-start gap-2">
                                <div className="h-7 w-7 rounded-full bg-gradient-to-br from-[#2B79F7] to-[#1E54B7] text-white text-[10px] font-semibold flex items-center justify-center shrink-0">
                                  {initial}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                                    {leadName}
                                  </p>
                                  {leadEmail && (
                                    <p className="text-[11px] text-[var(--text-tertiary)] flex items-center gap-1 mt-0.5 min-w-0">
                                      <Mail className="h-3 w-3 shrink-0" />
                                      <span className="truncate min-w-0">{leadEmail}</span>
                                    </p>
                                  )}
                                  {leadPhone && (
                                    <p className="text-[11px] text-[var(--text-tertiary)] flex items-center gap-1 mt-0.5 min-w-0">
                                      <Phone className="h-3 w-3 shrink-0" />
                                      <span className="truncate min-w-0">{leadPhone}</span>
                                    </p>
                                  )}
                                </div>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleDeleteLead(lead.id)
                                  }}
                                  className="p-1 rounded text-[var(--text-tertiary)] hover:text-red-500 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all shrink-0"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                              {lastUpdated && (
                                <p className="text-[10px] text-[var(--text-tertiary)] mt-1.5 ml-9">
                                  Updated{' '}
                                  {new Date(lastUpdated).toLocaleDateString(undefined, {
                                    month: 'short',
                                    day: 'numeric',
                                  })}
                                </p>
                              )}
                            </div>
                          )
                        })}
                      </div>

                      {/* Add Lead */}
                      <div className="p-2 pt-0">
                        <button
                          onClick={() => {
                            setNewLead({ [statusFieldKey]: status.value })
                            setShowAddLead(true)
                          }}
                          className="w-full px-3 py-2 border border-dashed border-[var(--border-primary)] rounded-lg text-xs text-[var(--text-tertiary)] hover:border-[#2B79F7] hover:text-[#2B79F7] hover:bg-[var(--bg-card-hover)] transition-all flex items-center justify-center gap-1.5"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          <span>Add Lead</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        )}

        {/* Chart View - one focused dashboard: hero stat with sparkline,
            pipeline funnel as the main visual, and a tight delta strip. */}
        {view === 'chart' && (() => {
          const totalLeads = leads.length
          const closedLabels = ['closed', 'won', 'paid']
          const closed = leads.filter((l) =>
            closedLabels.some((c) => String(l.data?.[statusFieldKey] || '').toLowerCase().includes(c)),
          ).length
          const conversion = totalLeads === 0 ? 0 : Math.round((closed / totalLeads) * 100)

          // Inflow chart: stacked bars per status, bucketed Day/Week/
          // Month/All. The 3-metric strip above the chart (Total leads /
          // This week / Closed) carries the headline numbers - no rate
          // line, no second axis, just the bars.
          const inflowSeries: SeriesDef[] = [
            ...statusOptions.map((s) => ({
              key: s.value,
              label: s.label,
              color: s.color,
            })),
            { key: '__unset', label: 'Unset', color: '#64748B' },
          ]
          const knownStatuses = new Set(statusOptions.map((s) => s.value))
          const chartLeadSet = new Set(chartLeadIds)
          const inflowEvents: ChartEvent[] = []
          for (const l of leads) {
            if (chartLeadSet.size > 0 && !chartLeadSet.has(l.id)) continue
            // Bucket by updated_at so a status change registers on the
            // day it was made, not on the day the lead was first added.
            const ref = l.updated_at || l.created_at
            const raw = (l.data as { status?: unknown } | null)?.status
            const sKey =
              typeof raw === 'string' && raw && knownStatuses.has(raw)
                ? raw
                : '__unset'
            const values: Record<string, number> = {}
            for (const s of inflowSeries) values[s.key] = 0
            values[sKey] = 1
            inflowEvents.push({ date: new Date(ref), values })
          }
          const { rows: inflow, effectiveMode: inflowMode } = bucketize(
            inflowEvents,
            {
              mode: bucketMode,
              seriesKeys: inflowSeries.map((s) => s.key),
              windowDays: 30,
              windowWeeks: 12,
              windowMonths: 12,
            },
          )
          const inflowBucketLabel = (
            { day: 'day', week: 'week', month: 'month' } as Record<
              string,
              string
            >
          )[inflowMode]

          // Period split for the trend chip.
          const newThisWeek = leads.filter((l) => {
            const t = new Date(l.created_at).getTime()
            return t >= Date.now() - 7 * 24 * 60 * 60 * 1000
          }).length
          const newPriorWeek = leads.filter((l) => {
            const t = new Date(l.created_at).getTime()
            return (
              t < Date.now() - 7 * 24 * 60 * 60 * 1000 &&
              t >= Date.now() - 14 * 24 * 60 * 60 * 1000
            )
          }).length
          const weekChange =
            newPriorWeek === 0
              ? newThisWeek === 0
                ? 0
                : 100
              : Math.round(((newThisWeek - newPriorWeek) / newPriorWeek) * 100)

          // Funnel - sort statuses by count descending. Reads as a pipeline
          // because each row is narrower than the one above it.
          const funnel = chartData
            .filter((d) => d.count > 0)
            .sort((a, b) => b.count - a.count)
          const funnelMax = funnel[0]?.count || 1

          // Donut data uses the chartData colors (defined per-status).
          const donutData = chartData
            .filter((d) => d.count > 0)
            .map((d) => ({ label: d.label, value: d.count, color: d.color }))

          return (
            <div className="space-y-4">
              {/* Hero card: stat strip on top, big inflow chart below.
                  The chart is full-width so the trend is actually
                  legible - the previous side-by-side layout squeezed it
                  into a 420px slot. */}
              <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border-primary)] p-5 sm:p-6">
                {/* Stat strip - 3 quick metrics in one row */}
                <div className="flex items-end justify-between gap-6 flex-wrap mb-4">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-semibold">
                      Total leads
                    </p>
                    <p className="text-3xl sm:text-4xl font-bold text-[var(--text-primary)] tabular-nums mt-1">
                      {totalLeads.toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-semibold">
                      This week
                    </p>
                    <div className="flex items-baseline gap-2 mt-1">
                      <p className="text-2xl sm:text-3xl font-bold text-[var(--text-primary)] tabular-nums">
                        {newThisWeek}
                      </p>
                      <span
                        className={`text-xs tabular-nums ${
                          weekChange > 0
                            ? 'text-emerald-500'
                            : weekChange < 0
                              ? 'text-red-500'
                              : 'text-[var(--text-tertiary)]'
                        }`}
                      >
                        {weekChange > 0 ? '↗' : weekChange < 0 ? '↘' : ''}
                        {weekChange > 0 ? '+' : ''}
                        {weekChange}%
                      </span>
                    </div>
                    <p className="text-[10px] text-[var(--text-tertiary)] mt-0.5">
                      vs prior week
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-semibold">
                      Closed
                    </p>
                    <div className="flex items-baseline gap-2 mt-1">
                      <p className="text-2xl sm:text-3xl font-bold text-[var(--text-primary)] tabular-nums">
                        {closed}
                      </p>
                      <span className="text-xs tabular-nums text-[var(--text-tertiary)]">
                        {conversion}%
                      </span>
                    </div>
                    <p className="text-[10px] text-[var(--text-tertiary)] mt-0.5">
                      conversion rate
                    </p>
                  </div>
                </div>

                {/* Full-width inflow chart: stacked bars by status +
                    conversion rate line on the secondary axis. */}
                <div className="border-t border-[var(--border-primary)] pt-4">
                  <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
                    <p className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-semibold">
                      Lead inflow by status · per {inflowBucketLabel}
                    </p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <LeadFilter
                        options={leads.map((l) => {
                          const d = (l.data || {}) as Record<string, unknown>
                          const name =
                            (typeof d.name === 'string' && d.name) ||
                            (typeof d.email === 'string' && d.email) ||
                            'Unnamed'
                          const email =
                            typeof d.email === 'string' ? d.email : null
                          return { id: l.id, name, email } as LeadOption
                        })}
                        value={chartLeadIds}
                        onChange={setChartLeadIds}
                      />
                      <BucketToggle
                        value={bucketMode}
                        onChange={setBucketMode}
                      />
                    </div>
                  </div>
                  <StatusStackedBar
                    data={inflow}
                    series={inflowSeries}
                    height={280}
                  />
                </div>
              </div>

              {/* Pipeline funnel + status donut */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="lg:col-span-2 bg-[var(--bg-card)] rounded-2xl border border-[var(--border-primary)] p-5 sm:p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-semibold text-[var(--text-primary)]">Pipeline</h3>
                    <span className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-semibold">
                      {conversion}% closed
                    </span>
                  </div>
                  {funnel.length === 0 ? (
                    <p className="text-xs text-[var(--text-tertiary)] py-10 text-center">
                      No leads with a status yet.
                    </p>
                  ) : (
                    <ul className="space-y-2.5">
                      {funnel.map((f) => {
                        const pct = Math.round((f.count / funnelMax) * 100)
                        return (
                          <li key={f.value}>
                            <div className="flex items-center justify-between text-xs mb-1.5">
                              <span className="text-[var(--text-secondary)] font-medium">
                                {f.label}
                              </span>
                              <span className="text-[var(--text-tertiary)] tabular-nums">
                                {f.count} ·{' '}
                                {totalLeads === 0
                                  ? 0
                                  : Math.round((f.count / totalLeads) * 100)}
                                %
                              </span>
                            </div>
                            <div className="h-2.5 rounded-full bg-[var(--bg-tertiary)] overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all duration-500"
                                style={{
                                  width: `${Math.max(pct, 4)}%`,
                                  background: f.color,
                                }}
                              />
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>

                <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border-primary)] p-5 sm:p-6">
                  <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-4">
                    By status
                  </h3>
                  {donutData.length === 0 ? (
                    <p className="text-xs text-[var(--text-tertiary)] py-10 text-center">
                      No status data.
                    </p>
                  ) : (
                    <>
                      <div className="flex justify-center mb-3">
                        <DonutChart
                          data={donutData}
                          size={140}
                          thickness={16}
                          centerLabel={String(totalLeads)}
                          centerSubLabel="leads"
                        />
                      </div>
                      <ChartLegend items={donutData} />
                    </>
                  )}
                </div>
              </div>
            </div>
          )
        })()}

        {/* Add Lead Modal */}
        {showAddLead && (
          <Modal onClose={() => { setShowAddLead(false); setNewLead({}) }} title="Add New Lead">
            <div className="space-y-4">
              {fields.map((field) => {
                const options = getFieldOptions(field)
                
                return (
                  <div key={field.id}>
                    <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">
                      {field.field_name}
                      {field.is_required && <span className="text-red-400 ml-1">*</span>}
                    </label>
                    {(field.field_type === 'status' || field.field_type === 'select') ? (
                      <select
                        value={newLead[field.field_key] || ''}
                        onChange={(e) => setNewLead({ ...newLead, [field.field_key]: e.target.value })}
                        className="w-full px-4 py-2.5 bg-[var(--bg-input)] border border-[var(--border-primary)] rounded-xl text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                      >
                        <option value="">Select...</option>
                        {options.map((opt, optIndex) => (
                          <option key={`${opt.value}-${optIndex}`} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    ) : field.field_type === 'checkbox' ? (
                      <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={newLead[field.field_key] === 'true'}
                          onChange={(e) =>
                            setNewLead({
                              ...newLead,
                              [field.field_key]: e.target.checked ? 'true' : '',
                            })
                          }
                          className="h-4 w-4 accent-[#2B79F7]"
                        />
                        <span className="text-sm text-[var(--text-secondary)]">
                          {newLead[field.field_key] === 'true' ? 'Yes' : 'No'}
                        </span>
                      </label>
                    ) : (
                      <input
                        type={field.field_type === 'email' ? 'email' : field.field_type === 'date' ? 'date' : field.field_type === 'number' ? 'number' : 'text'}
                        value={newLead[field.field_key] || (field.field_type === 'date' ? new Date().toISOString().split('T')[0] : '')}
                        onChange={(e) => setNewLead({ ...newLead, [field.field_key]: e.target.value })}
                        placeholder={`Enter ${field.field_name.toLowerCase()}...`}
                        className="w-full px-4 py-2.5 bg-[var(--bg-input)] border border-[var(--border-primary)] rounded-xl text-[var(--text-primary)] placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                      />
                    )}
                  </div>
                )
              })}
            </div>
            <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-[var(--border-primary)]">
              <Button variant="outline" onClick={() => { setShowAddLead(false); setNewLead({}) }}>Cancel</Button>
              <Button onClick={handleAddLead}>Add Lead</Button>
            </div>
          </Modal>
        )}

        {/* Add Field Modal */}
        {showAddField && (
          <Modal onClose={() => setShowAddField(false)} title="Add Property">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">Property Name</label>
                <input
                  type="text"
                  value={newField.name}
                  onChange={(e) => setNewField({ ...newField, name: e.target.value })}
                  placeholder="e.g., Company, Budget, Source"
                  className="w-full px-4 py-2.5 bg-[var(--bg-input)] border border-[var(--border-primary)] rounded-xl text-[var(--text-primary)] placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">Property Type</label>
                <select
                  value={newField.type}
                  onChange={(e) => setNewField({ ...newField, type: e.target.value })}
                  className="w-full px-4 py-2.5 bg-[var(--bg-input)] border border-[var(--border-primary)] rounded-xl text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                >
                  {Object.entries(fieldTypeConfig).map(([value, config]) => (
                    <option key={value} value={value}>{config.label}</option>
                  ))}
                </select>
              </div>
              {newField.type === 'url' && (
                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">Display Style</label>
                  <div className="grid grid-cols-3 gap-2">
                    {(['link', 'hyperlink', 'button'] as const).map((type) => (
                      <button
                        key={type}
                        onClick={() =>
                          setNewField({ ...newField, urlDisplayType: type })
                        }
                        className={`p-3 rounded-xl border-2 transition-all capitalize text-sm ${
                          newField.urlDisplayType === type
                            ? 'border-[#2B79F7] bg-[#2B79F7]/10 text-[#2B79F7]'
                            : 'border-[var(--border-primary)] text-[var(--text-tertiary)] hover:border-[var(--border-secondary)]'
                        }`}
                      >
                        {type === 'link'
                          ? 'Raw URL'
                          : type === 'hyperlink'
                            ? 'Hyperlink'
                            : 'Button'}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-[var(--text-tertiary)] mt-2">
                    Raw URL shows the link itself. Hyperlink + Button let you
                    set a display text per lead.
                  </p>
                </div>
              )}
              {newField.type === 'url' &&
                (newField.urlDisplayType === 'hyperlink' ||
                  newField.urlDisplayType === 'button') && (
                  <div>
                    <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">
                      {newField.urlDisplayType === 'button'
                        ? 'Button label'
                        : 'Hyperlink text'}
                    </label>
                    <input
                      type="text"
                      value={newField.urlLabel}
                      onChange={(e) =>
                        setNewField({
                          ...newField,
                          urlLabel: e.target.value,
                        })
                      }
                      placeholder={
                        newField.urlDisplayType === 'button'
                          ? 'e.g. Visit website'
                          : 'e.g. Click here'
                      }
                      className="w-full px-4 py-2.5 bg-[var(--bg-input)] border border-[var(--border-primary)] rounded-xl text-[var(--text-primary)] placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                    />
                    <p className="text-[11px] text-[var(--text-tertiary)] mt-2">
                      Default text for every lead. You can still override
                      it per cell when editing a lead&rsquo;s value.
                    </p>
                  </div>
                )}
              {newField.type === 'url' && (
                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">
                    Default URL
                    <span className="text-[var(--text-tertiary)] font-normal ml-1">
                      (optional)
                    </span>
                  </label>
                  <input
                    type="url"
                    value={newField.urlDefault}
                    onChange={(e) =>
                      setNewField({
                        ...newField,
                        urlDefault: e.target.value,
                      })
                    }
                    placeholder="https://..."
                    className="w-full px-4 py-2.5 bg-[var(--bg-input)] border border-[var(--border-primary)] rounded-xl text-[var(--text-primary)] placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                  />
                  <p className="text-[11px] text-[var(--text-tertiary)] mt-2">
                    Where every lead&rsquo;s {newField.urlDisplayType === 'button'
                      ? 'button'
                      : newField.urlDisplayType === 'hyperlink'
                        ? 'link'
                        : 'URL'}{' '}
                    points by default. Leave blank to set per cell.
                  </p>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-[var(--border-primary)]">
              <Button variant="outline" onClick={() => setShowAddField(false)}>Cancel</Button>
              <Button onClick={handleAddField}>Add Property</Button>
            </div>
          </Modal>
        )}

        {/* Field Settings Modal */}
        {showFieldSettings && (
          <FieldSettingsModal
            field={showFieldSettings}
            onClose={() => setShowFieldSettings(null)}
            onUpdate={handleUpdateField}
            onDelete={handleDeleteField}
            onAddOption={handleAddStatusOption}
            onUpdateOption={handleUpdateStatusOption}
            onDeleteOption={handleDeleteStatusOption}
            onReorderOptions={handleReorderStatusOptions}
          />
        )}

        {/* Lead Detail Modal */}
        {showLeadDetail && (
          <LeadDetailModal
            lead={leads.find(l => l.id === showLeadDetail.id) || showLeadDetail}
            fields={fields}
            isPending={pendingLeads.has(showLeadDetail.id)}
            onClose={() => setShowLeadDetail(null)}
            onUpdate={handleUpdateLead}
            onDelete={handleDeleteLead}
            getFieldOptions={getFieldOptions}
          />
        )}

        {/* Status Dropdown */}
        {statusDropdown && (
          <StatusDropdown
            options={getFieldOptions(fields.find(f => f.field_key === statusDropdown.fieldKey) || fields[0])}
            currentValue={(leads.find(l => l.id === statusDropdown.leadId)?.data?.[statusDropdown.fieldKey] as string) || ''}
            onSelect={(value) => handleUpdateLead(statusDropdown.leadId, statusDropdown.fieldKey, value)}
            onClose={() => setStatusDropdown(null)}
          />
        )}
      </div>
}

// Status Badge Component
function StatusBadge({ value, options }: { value: string; options: StatusOption[] }) {
  const option = options.find(o => o.value === value)
  if (!option) return <span className="text-[var(--text-tertiary)]">-</span>

  return (
    <span 
      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-all hover:scale-105"
      style={{ 
        backgroundColor: `${option.color}20`, 
        color: option.color,
        border: `1px solid ${option.color}40`
      }}
    >
      <span 
        className="w-1.5 h-1.5 rounded-full"
        style={{ backgroundColor: option.color }}
      />
      {option.label}
    </span>
  )
}

// URL Display Component. Reads either a plain URL string or the JSON
// {url,text} shape (see parseUrlValue). Fallback chains:
//   text:  per-cell text → field-level label → field name → generic
//   url:   per-cell url  → field-level default URL → empty state
function UrlDisplay({
  value,
  displayType,
  fieldName,
  fieldLabel,
  fieldDefaultUrl,
}: {
  value: string
  displayType: 'button' | 'link' | 'hyperlink'
  fieldName?: string
  fieldLabel?: string
  fieldDefaultUrl?: string
}) {
  const { url: cellUrl, text } = parseUrlValue(value)
  const url = cellUrl || fieldDefaultUrl || ''
  if (!url) return <span className="text-[var(--text-tertiary)]">-</span>

  const href = url.startsWith('http') ? url : `https://${url}`
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    window.open(href, '_blank')
  }

  if (displayType === 'button') {
    return (
      <button
        onClick={handleClick}
        className="px-4 py-2 bg-[#2B79F7] text-white text-sm font-medium rounded-lg hover:bg-[#1E54B7] transition-colors inline-flex items-center gap-2 shadow-lg"
      >
        <ExternalLink className="h-4 w-4" />
        {text || fieldLabel || fieldName || 'Open Link'}
      </button>
    )
  }

  if (displayType === 'hyperlink') {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="text-[#2B79F7] hover:underline inline-flex items-center gap-1.5 text-sm font-medium"
      >
        <LinkIcon className="h-4 w-4" />
        <span>{text || fieldLabel || fieldName || 'Click here'}</span>
      </a>
    )
  }

  // Default: raw link - shows the URL itself as the link text.
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="text-[#2B79F7] hover:underline text-sm truncate block max-w-[250px]"
    >
      {url}
    </a>
  )
}

// Modal Component
//
// Caps the panel at 90vh and scrolls the body internally so tall
// content (e.g. status options with 10+ entries) never overflows the
// top/bottom of the viewport. The header stays pinned; only the body
// scrolls. `scrollbar-none` hides the scroll chrome - the user feels
// the overflow, doesn't see a heavy bar.
//
// Body scroll is locked while open so the page underneath can't scroll
// while a modal is up (the modal IS the foreground).
function Modal({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  useBodyScrollLock(true)
  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border-primary)] w-full max-w-md max-h-[90vh] flex flex-col shadow-2xl animate-in fade-in zoom-in duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-6 border-b border-[var(--border-primary)] shrink-0">
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">{title}</h3>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[var(--bg-card-hover)] rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-6 overflow-y-auto scrollbar-none flex-1 min-h-0">{children}</div>
      </div>
    </div>
  )
}

// Field Settings Modal
// Field Settings Modal
// Field-level URL metadata editor (display label + default URL). Used
// inside FieldSettingsModal so users can change these post-creation.
// Persists both fields together via buildUrlMetaOptions so neither
// half gets dropped on save.
function UrlMetaEditor({
  field,
  onUpdate,
}: {
  field: CustomField
  onUpdate: (id: string, updates: Partial<CustomField>) => void
}) {
  const [label, setLabel] = useState(getFieldUrlLabel(field))
  const [url, setUrl] = useState(getFieldUrlDefault(field))
  // Sync from prop on optimistic refresh.
  useEffect(() => {
    setLabel(getFieldUrlLabel(field))
    setUrl(getFieldUrlDefault(field))
  }, [field])

  const persist = (nextLabel: string, nextUrl: string) => {
    if (
      nextLabel === getFieldUrlLabel(field) &&
      nextUrl === getFieldUrlDefault(field)
    ) {
      return
    }
    onUpdate(field.id, {
      options: buildUrlMetaOptions(nextLabel, nextUrl),
    })
  }

  const isButton = field.url_display_type === 'button'
  const isHyperlink = field.url_display_type === 'hyperlink'
  return (
    <div className="space-y-3">
      {(isButton || isHyperlink) && (
        <div>
          <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">
            {isButton ? 'Button label' : 'Hyperlink text'}
          </label>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={() => persist(label.trim(), url.trim())}
            placeholder={isButton ? 'e.g. Visit website' : 'e.g. Click here'}
            className="w-full px-4 py-2.5 bg-[var(--bg-input)] border border-[var(--border-primary)] rounded-xl text-[var(--text-primary)] placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
          />
          <p className="text-[11px] text-[var(--text-tertiary)] mt-1">
            Default text for every {isButton ? 'button' : 'link'} in this
            column. Leave blank to fall back to the column name.
          </p>
        </div>
      )}
      <div>
        <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">
          Default URL
          <span className="text-[var(--text-tertiary)] font-normal ml-1">
            (optional)
          </span>
        </label>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onBlur={() => persist(label.trim(), url.trim())}
          placeholder="https://..."
          className="w-full px-4 py-2.5 bg-[var(--bg-input)] border border-[var(--border-primary)] rounded-xl text-[var(--text-primary)] placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
        />
        <p className="text-[11px] text-[var(--text-tertiary)] mt-1">
          Where every lead&rsquo;s {isButton ? 'button' : isHyperlink ? 'link' : 'URL'} points by default. Cells can still
          override per lead.
        </p>
      </div>
    </div>
  )
}

function FieldSettingsModal({
  field,
  onClose,
  onUpdate,
  onDelete,
  onAddOption,
  onUpdateOption,
  onDeleteOption,
  onReorderOptions,
}: {
  field: CustomField
  onClose: () => void
  onUpdate: (id: string, updates: Partial<CustomField>) => void
  onDelete: (id: string) => void
  onAddOption: (fieldId: string, option: StatusOption) => void
  onUpdateOption: (fieldId: string, optionValue: string, updates: Partial<StatusOption>) => void
  onDeleteOption: (fieldId: string, optionValue: string) => void
  onReorderOptions: (fieldId: string, fromIndex: number, toIndex: number) => void
}) {
  const [fieldName, setFieldName] = useState(field.field_name)
  const [newOption, setNewOption] = useState({ label: '', color: colorPalette[0].value })
  const [editingOption, setEditingOption] = useState<string | null>(null)
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  
  // Local state for options to enable real-time updates
  const [localOptions, setLocalOptions] = useState<StatusOption[]>(() => getFieldOptions(field))

  // Update local options when field changes
  useEffect(() => {
    setLocalOptions(getFieldOptions(field))
  }, [field])

  const handleAddOption = () => {
    if (!newOption.label.trim()) return
    
    const option: StatusOption = {
      value: newOption.label.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''),
      label: newOption.label,
      color: newOption.color,
    }
    
    // Update local state immediately
    setLocalOptions(prev => [...prev, option])
    
    // Then update database
    onAddOption(field.id, option)
    
    setNewOption({ label: '', color: colorPalette[0].value })
  }

  const handleDeleteOption = (optionValue: string) => {
    // Update local state immediately
    setLocalOptions(prev => prev.filter(o => o.value !== optionValue))
    
    // Then update database
    onDeleteOption(field.id, optionValue)
  }

  const handleUpdateOption = (optionValue: string, updates: Partial<StatusOption>) => {
    // Update local state immediately
    setLocalOptions(prev => prev.map(o => 
      o.value === optionValue ? { ...o, ...updates } : o
    ))
    
    // Then update database
    onUpdateOption(field.id, optionValue, updates)
  }

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', index.toString())
  }

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    if (draggedIndex === null || draggedIndex === index) return
    setDragOverIndex(index)
  }

  const handleDragLeave = () => {
    setDragOverIndex(null)
  }

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault()
    if (draggedIndex === null || draggedIndex === dropIndex) {
      setDraggedIndex(null)
      setDragOverIndex(null)
      return
    }

    // Reorder local state immediately
    const newOptions = [...localOptions]
    const [removed] = newOptions.splice(draggedIndex, 1)
    newOptions.splice(dropIndex, 0, removed)
    setLocalOptions(newOptions)

    // Then update database
    onReorderOptions(field.id, draggedIndex, dropIndex)

    setDraggedIndex(null)
    setDragOverIndex(null)
  }

  const handleDragEnd = () => {
    setDraggedIndex(null)
    setDragOverIndex(null)
  }

  return (
    <Modal onClose={onClose} title="Property Settings">
      <div className="space-y-6">
        {/* Field Name */}
        <div>
          <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">Property Name</label>
          <input
            type="text"
            value={fieldName}
            onChange={(e) => setFieldName(e.target.value)}
            onBlur={() => {
              if (fieldName !== field.field_name) {
                onUpdate(field.id, { field_name: fieldName })
              }
            }}
            disabled={field.is_default}
            className="w-full px-4 py-2.5 bg-[var(--bg-input)] border border-[var(--border-primary)] rounded-xl text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7] disabled:opacity-50"
          />
        </div>

        {/* URL Display Style - only for URL fields. Lets you switch a
            field between raw URL / hyperlinked text / button after the
            fact (the Add Property modal sets it once at creation, but
            people change their minds). */}
        {field.field_type === 'url' && (
          <div>
            <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">
              Display Style
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(['link', 'hyperlink', 'button'] as const).map((type) => {
                const active = (field.url_display_type || 'link') === type
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => onUpdate(field.id, { url_display_type: type })}
                    className={`p-3 rounded-xl border-2 transition-all text-sm ${
                      active
                        ? 'border-[#2B79F7] bg-[#2B79F7]/10 text-[#2B79F7]'
                        : 'border-[var(--border-primary)] text-[var(--text-tertiary)] hover:border-[var(--border-secondary)]'
                    }`}
                  >
                    {type === 'link'
                      ? 'Raw URL'
                      : type === 'hyperlink'
                        ? 'Hyperlink'
                        : 'Button'}
                  </button>
                )
              })}
            </div>
            <p className="text-[11px] text-[var(--text-tertiary)] mt-2">
              {field.url_display_type === 'button'
                ? 'Renders as a button. Set a default button label below; you can still override per cell.'
                : field.url_display_type === 'hyperlink'
                  ? 'Renders as hyperlinked text. Set a default text below; you can still override per cell.'
                  : 'Renders the URL itself as a clickable link. No display text needed.'}
            </p>
          </div>
        )}

        {/* Field-level URL metadata: default URL + (for hyperlink /
            button) display label. Available for every URL field so the
            user can set a default link without per-cell editing. */}
        {field.field_type === 'url' && (
          <UrlMetaEditor field={field} onUpdate={onUpdate} />
        )}

        {/* Status/Select Options */}
        {(field.field_type === 'status' || field.field_type === 'select') && (
          <div>
            <label className="block text-sm font-medium text-[var(--text-secondary)] mb-3">
              Options (drag to reorder)
            </label>
            <div className="space-y-2 mb-4">
              {localOptions.map((opt, index) => (
                <div 
                  key={opt.value} 
                  className={`flex items-center gap-3 p-3 bg-[var(--bg-secondary)] border rounded-xl group transition-all ${
                    draggedIndex === index 
                      ? 'opacity-50 scale-95 border-[#2B79F7]' 
                      : dragOverIndex === index 
                        ? 'border-[#2B79F7] bg-[#2B79F7]/10' 
                        : 'border-[var(--border-primary)]'
                  }`}
                  draggable
                  onDragStart={(e) => handleDragStart(e, index)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, index)}
                  onDragEnd={handleDragEnd}
                >
                  <GripVertical className="h-4 w-4 text-[var(--text-secondary)] group-hover:text-[var(--text-tertiary)] cursor-grab active:cursor-grabbing" />
                  <button
                    type="button"
                    onClick={() => setEditingOption(editingOption === opt.value ? null : opt.value)}
                   className="w-6 h-6 rounded-md shrink-0 border-2 border-transparent hover:border-white/30 transition-all"
                    style={{ backgroundColor: opt.color }}
                  />
                  {editingOption === opt.value ? (
                    <input
                      type="text"
                      value={opt.label}
                      onChange={(e) => handleUpdateOption(opt.value, { label: e.target.value })}
                      onBlur={() => setEditingOption(null)}
                      onKeyDown={(e) => e.key === 'Enter' && setEditingOption(null)}
                      autoFocus
                      className="flex-1 px-2 py-1 bg-[var(--bg-input)] border border-[#2B79F7] rounded-lg text-[var(--text-primary)] focus:outline-none text-sm"
                    />
                  ) : (
                    <span 
                      className="text-[var(--text-primary)] flex-1 cursor-pointer hover:text-[var(--text-secondary)]"
                      onClick={() => setEditingOption(opt.value)}
                    >
                      {opt.label}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => handleDeleteOption(opt.value)}
                    className="p-1.5 hover:bg-red-500/20 rounded-lg text-[var(--text-tertiary)] hover:text-red-400 transition-all"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>

            {/* Color picker for editing */}
            {editingOption && (
              <div className="mb-4 p-3 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-xl">
                <p className="text-xs text-[var(--text-tertiary)] mb-2">Choose color:</p>
                <div className="flex flex-wrap gap-2">
                  {colorPalette.map((color) => {
                    const currentOpt = localOptions.find(o => o.value === editingOption)
                    return (
                      <button
                        key={color.value}
                        type="button"
                        onClick={() => handleUpdateOption(editingOption, { color: color.value })}
                        className={`w-7 h-7 rounded-lg transition-all ${
                          currentOpt?.color === color.value 
                            ? 'ring-2 ring-white ring-offset-2 ring-offset-[var(--bg-input)] scale-110' 
                            : 'hover:scale-110'
                        }`}
                        style={{ backgroundColor: color.value }}
                        title={color.name}
                      />
                    )
                  })}
                </div>
              </div>
            )}

            {/* Add Option */}
            <div className="space-y-3">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newOption.label}
                  onChange={(e) => setNewOption({ ...newOption, label: e.target.value })}
                  placeholder="New option..."
                  className="flex-1 px-4 py-2.5 bg-[var(--bg-input)] border border-[var(--border-primary)] rounded-xl text-[var(--text-primary)] placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                  onKeyDown={(e) => e.key === 'Enter' && handleAddOption()}
                />
                <Button onClick={handleAddOption} disabled={!newOption.label.trim()}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>

              {/* Color Picker for new option */}
              <div className="flex flex-wrap gap-2">
                {colorPalette.map((color) => (
                  <button
                    key={color.value}
                    type="button"
                    onClick={() => setNewOption({ ...newOption, color: color.value })}
                    className={`w-7 h-7 rounded-lg transition-all ${
                      newOption.color === color.value 
                        ? 'ring-2 ring-white ring-offset-2 ring-offset-[var(--bg-card)] scale-110' 
                        : 'hover:scale-110'
                    }`}
                    style={{ backgroundColor: color.value }}
                    title={color.name}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Delete */}
        {!field.is_default && (
          <div className="pt-4 border-t border-[var(--border-primary)]">
            <button
              type="button"
              onClick={() => onDelete(field.id)}
              className="w-full px-4 py-3 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded-xl text-red-400 font-medium transition-colors flex items-center justify-center gap-2"
            >
              <Trash2 className="h-4 w-4" />
              Delete Property
            </button>
          </div>
        )}
      </div>
    </Modal>
  )
}

// Lead Detail Modal
function LeadDetailModal({
  lead,
  fields,
  isPending,
  onClose,
  onUpdate,
  onDelete,
  getFieldOptions,
}: {
  lead: Lead
  fields: CustomField[]
  isPending: boolean
  onClose: () => void
  onUpdate: (leadId: string, fieldKey: string, value: string) => void
  onDelete: (leadId: string) => void
  getFieldOptions: (field: CustomField) => StatusOption[]
}) {
  const name = (lead.data?.name as string) || 'Unnamed lead'
  const email = (lead.data?.email as string) || ''
  const phone = (lead.data?.phone as string) || ''
  const initial = (name || '?').charAt(0).toUpperCase()

  // Status field gets pulled out of the property list and shown as a
  // pill in the header for quick scanning + one-click editing.
  const statusField = fields.find((f) => f.field_type === 'status')
  const statusValue = statusField
    ? ((lead.data?.[statusField.field_key] as string) || '')
    : ''
  const statusOpt = statusField
    ? getFieldOptions(statusField).find((o) => o.value === statusValue)
    : null
  // Everything else lives in the properties rail (name + status hidden
  // since they're already in the header).
  const propertyFields = fields.filter(
    (f) => f.field_key !== 'name' && f.field_type !== 'status',
  )

  // Notes are stored under a dedicated `__notes` key on the lead's data
  // record, separate from any user-defined "notes" custom field. Keeps
  // the right rail useful even when the workspace has no notes column.
  const notes = (lead.data?.__notes as string) || ''

  // Local state for status dropdown popover.
  const [statusOpen, setStatusOpen] = useState(false)

  useBodyScrollLock(true)

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className={`bg-[var(--bg-card)] rounded-2xl border border-[var(--border-primary)] w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl animate-in fade-in zoom-in duration-150 ${isPending ? 'opacity-50' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* HEADER STRIP - avatar + name + contact subline + status pill + actions */}
        <div className="flex items-start justify-between gap-4 p-5 sm:p-6 border-b border-[var(--border-primary)]">
          <div className="flex items-start gap-4 min-w-0 flex-1">
            <div className="h-12 w-12 rounded-full bg-[#2B79F7]/15 text-[#2B79F7] flex items-center justify-center text-lg font-semibold shrink-0">
              {initial}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-xl sm:text-2xl font-bold text-[var(--text-primary)] truncate">
                {name}
              </h2>
              {(email || phone) && (
                <p className="text-xs sm:text-sm text-[var(--text-tertiary)] truncate mt-0.5">
                  {[email, phone].filter(Boolean).join(' · ')}
                </p>
              )}
              {statusField && statusOpt && (
                <div className="mt-2 relative inline-block">
                  <button
                    type="button"
                    onClick={() => setStatusOpen((v) => !v)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-opacity hover:opacity-80"
                    style={{
                      backgroundColor: `${statusOpt.color}20`,
                      color: statusOpt.color,
                      border: `1px solid ${statusOpt.color}40`,
                    }}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: statusOpt.color }}
                    />
                    {statusOpt.label}
                    <ChevronDown className="h-3 w-3 opacity-70" />
                  </button>
                  {statusOpen && (
                    <>
                      <div
                        className="fixed inset-0 z-10"
                        onClick={() => setStatusOpen(false)}
                      />
                      <div className="absolute z-20 left-0 mt-1 w-56 max-w-[calc(100vw-1rem)] rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] shadow-xl py-1 max-h-64 overflow-y-auto">
                        {getFieldOptions(statusField).map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => {
                              onUpdate(lead.id, statusField.field_key, opt.value)
                              setStatusOpen(false)
                            }}
                            className="w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-[var(--bg-card-hover)] transition-colors"
                          >
                            <span
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{ backgroundColor: opt.color }}
                            />
                            <span className="text-[var(--text-primary)]">
                              {opt.label}
                            </span>
                            {opt.value === statusValue && (
                              <CheckCircle2 className="h-3.5 w-3.5 text-[#2B79F7] ml-auto" />
                            )}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => {
                onDelete(lead.id)
                onClose()
              }}
              className="p-2 hover:bg-red-500/10 rounded-lg text-[var(--text-tertiary)] hover:text-red-500 transition-colors"
              title="Delete lead"
            >
              <Trash2 className="h-4 w-4" />
            </button>
            <button
              onClick={onClose}
              className="p-2 hover:bg-[var(--bg-card-hover)] rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
              title="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* BODY - 2-col on desktop: properties rail + notes/activity */}
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-none">
          <div className="grid grid-cols-1 md:grid-cols-[280px_1fr]">
            {/* LEFT: Properties rail */}
            <div className="p-5 sm:p-6 md:border-r border-b md:border-b-0 border-[var(--border-primary)]">
              <p className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-semibold mb-3">
                Properties
              </p>
              <div className="space-y-2.5">
                {propertyFields.map((field) => (
                  <LeadPropertyRow
                    key={field.id}
                    field={field}
                    lead={lead}
                    options={getFieldOptions(field)}
                    onUpdate={onUpdate}
                  />
                ))}
              </div>
            </div>

            {/* RIGHT: Notes / activity */}
            <div className="p-5 sm:p-6 space-y-5">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-semibold mb-2">
                  Notes
                </p>
                <textarea
                  defaultValue={notes}
                  onBlur={(e) => {
                    if (e.target.value !== notes) {
                      onUpdate(lead.id, '__notes', e.target.value)
                    }
                  }}
                  placeholder="Click to add notes about this lead…"
                  rows={6}
                  className="w-full px-3 py-2.5 bg-[var(--bg-input)] border border-[var(--border-primary)] rounded-xl text-sm text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7] resize-y"
                />
                <p className="text-[10px] text-[var(--text-tertiary)] mt-1.5">
                  Saved automatically when you click outside.
                </p>
              </div>

              <div>
                <p className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-semibold mb-2">
                  Activity
                </p>
                <div className="space-y-1.5 text-xs text-[var(--text-secondary)]">
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-tertiary)]" />
                    <span>
                      Created{' '}
                      {new Date(lead.created_at).toLocaleString(undefined, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </span>
                  </div>
                  {lead.updated_at &&
                    lead.updated_at !== lead.created_at && (
                      <div className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#2B79F7]" />
                        <span>
                          Last updated{' '}
                          {new Date(lead.updated_at).toLocaleString(undefined, {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          })}
                        </span>
                      </div>
                    )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// Property row in the lead detail modal's left rail. Shows a label
// (icon + name) on the left and an inline-editable value on the right.
// Click to edit; Enter / blur saves; Escape cancels.
function LeadPropertyRow({
  field,
  lead,
  options,
  onUpdate,
}: {
  field: CustomField
  lead: Lead
  options: StatusOption[]
  onUpdate: (leadId: string, fieldKey: string, value: string) => void
}) {
  const value = (lead.data?.[field.field_key] as string) || ''
  const Icon = fieldTypeConfig[field.field_type]?.icon
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  // For URL fields the per-cell display text is encoded into the value.
  const [draftUrlText, setDraftUrlText] = useState('')

  // No effect-based sync needed: startEdit always seeds draft from
  // the latest value when the user clicks to edit, and the read-only
  // path always renders straight from value.

  const startEdit = () => {
    if (field.field_type === 'url') {
      const parsed = parseUrlValue(value)
      setDraft(parsed.url)
      setDraftUrlText(parsed.text)
    } else {
      setDraft(value)
    }
    setEditing(true)
  }
  const commit = () => {
    setEditing(false)
    if (field.field_type === 'url') {
      const next = serializeUrlValue(draft.trim(), draftUrlText.trim())
      if (next !== value) onUpdate(lead.id, field.field_key, next)
    } else if (draft !== value) {
      onUpdate(lead.id, field.field_key, draft)
    }
  }
  const cancel = () => {
    setEditing(false)
    setDraft(value)
    setDraftUrlText('')
  }

  // Status / select renders as a select-style row that opens inline.
  if (field.field_type === 'status' || field.field_type === 'select') {
    const opt = options.find((o) => o.value === value)
    return (
      <div className="flex items-start gap-3 py-1">
        <div className="flex items-center gap-1.5 w-24 shrink-0 mt-1">
          {Icon && <Icon className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />}
          <span className="text-xs text-[var(--text-tertiary)] truncate">
            {field.field_name}
          </span>
        </div>
        <select
          value={value}
          onChange={(e) => onUpdate(lead.id, field.field_key, e.target.value)}
          className="flex-1 px-2 py-1 bg-transparent border-0 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] rounded-md focus:outline-none focus:ring-2 focus:ring-[#2B79F7] cursor-pointer"
        >
          <option value="">Empty</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {opt && (
          <span
            className="w-2 h-2 rounded-full mt-2 shrink-0"
            style={{ backgroundColor: opt.color }}
          />
        )}
      </div>
    )
  }

  if (field.field_type === 'checkbox') {
    return (
      <div className="flex items-center gap-3 py-1">
        <div className="flex items-center gap-1.5 w-24 shrink-0">
          {Icon && <Icon className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />}
          <span className="text-xs text-[var(--text-tertiary)] truncate">
            {field.field_name}
          </span>
        </div>
        <input
          type="checkbox"
          checked={value === 'true'}
          onChange={(e) =>
            onUpdate(lead.id, field.field_key, e.target.checked ? 'true' : '')
          }
          className="h-4 w-4 accent-[#2B79F7] cursor-pointer"
        />
      </div>
    )
  }

  // Text-like + URL fields
  return (
    <div className="flex items-start gap-3 py-1 min-h-[28px]">
      <div className="flex items-center gap-1.5 w-24 shrink-0 mt-1">
        {Icon && <Icon className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />}
        <span className="text-xs text-[var(--text-tertiary)] truncate">
          {field.field_name}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        {editing ? (
          field.field_type === 'url' ? (
            <div
              className="space-y-1.5"
              onBlur={(e) => {
                const next = e.relatedTarget as Node | null
                if (!e.currentTarget.contains(next)) commit()
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit()
                else if (e.key === 'Escape') cancel()
              }}
            >
              {(field.url_display_type === 'hyperlink' ||
                field.url_display_type === 'button') && (
                <input
                  autoFocus
                  type="text"
                  value={draftUrlText}
                  onChange={(e) => setDraftUrlText(e.target.value)}
                  placeholder="Display text…"
                  className="w-full px-2 py-1 bg-[var(--bg-input)] border-2 border-[#2B79F7] rounded-md text-sm focus:outline-none"
                />
              )}
              <input
                autoFocus={
                  field.url_display_type !== 'hyperlink' &&
                  field.url_display_type !== 'button'
                }
                type="url"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="https://…"
                className="w-full px-2 py-1 bg-[var(--bg-input)] border border-[var(--border-primary)] rounded-md text-sm focus:outline-none focus:border-[#2B79F7]"
              />
            </div>
          ) : (
            <input
              autoFocus
              type={
                field.field_type === 'email'
                  ? 'email'
                  : field.field_type === 'date'
                    ? 'date'
                    : field.field_type === 'number'
                      ? 'number'
                      : 'text'
              }
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit()
                else if (e.key === 'Escape') cancel()
              }}
              className="w-full px-2 py-1 bg-[var(--bg-input)] border-2 border-[#2B79F7] rounded-md text-sm text-[var(--text-primary)] focus:outline-none"
            />
          )
        ) : (
          <button
            type="button"
            onClick={startEdit}
            className="w-full text-left px-2 py-1 -mx-2 rounded-md hover:bg-[var(--bg-card-hover)] transition-colors"
          >
            {field.field_type === 'url' &&
            (value || getFieldUrlDefault(field)) ? (
              <UrlDisplay
                value={value}
                displayType={field.url_display_type || 'link'}
                fieldName={field.field_name}
                fieldLabel={getFieldUrlLabel(field)}
                fieldDefaultUrl={getFieldUrlDefault(field)}
              />
            ) : value ? (
              <span className="block text-sm text-[var(--text-primary)] break-all">
                {value}
              </span>
            ) : (
              <span className="text-sm text-[var(--text-tertiary)] italic">
                Empty
              </span>
            )}
          </button>
        )}
      </div>
    </div>
  )
}

// Status Dropdown
function StatusDropdown({
  options,
  currentValue,
  onSelect,
  onClose,
}: {
  options: StatusOption[]
  currentValue: string
  onSelect: (value: string) => void
  onClose: () => void
}) {
  if (options.length === 0) {
    return (
      <div 
        className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center"
        onClick={onClose}
      >
        <div className="bg-[var(--bg-card)] border border-[var(--border-primary)] rounded-xl shadow-2xl p-4">
          <p className="text-[var(--text-tertiary)]">No options available</p>
        </div>
      </div>
    )
  }

  return (
    <div 
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-[var(--bg-card)] border border-[var(--border-primary)] rounded-xl shadow-2xl p-2 min-w-[250px] max-h-[80vh] overflow-y-auto scrollbar-none animate-in fade-in zoom-in duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-3 py-2 border-b border-[var(--border-primary)] mb-2">
          <p className="text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wider">Select Status</p>
        </div>
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onSelect(opt.value)}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
              currentValue === opt.value 
                ? 'bg-[#2B79F7]/20' 
                : 'hover:bg-[var(--bg-card-hover)]'
            }`}
          >
            <div 
              className="w-4 h-4 rounded-full shrink-0"
              style={{ backgroundColor: opt.color }}
            />
            <span className="text-[var(--text-primary)] flex-1 text-left">{opt.label}</span>
            {currentValue === opt.value && (
              <Check className="h-4 w-4 text-[#2B79F7] shrink-0" />
            )}
          </button>
        ))}
      </div>
    </div>
  )
}