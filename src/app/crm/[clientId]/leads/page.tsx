'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { CRMLayout } from '@/components/crm/CRMLayout'
import { Button } from '@/components/ui/Button'
import { Loading } from '@/components/ui/Loading'
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
  ChevronDown,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

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
  data: Record<string, any>
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
const fieldTypeConfig: Record<string, { icon: any; label: string }> = {
  text: { icon: Type, label: 'Text' },
  email: { icon: Mail, label: 'Email' },
  phone: { icon: Phone, label: 'Phone' },
  number: { icon: Hash, label: 'Number' },
  url: { icon: LinkIcon, label: 'URL' },
  date: { icon: Calendar, label: 'Date' },
  select: { icon: List, label: 'Select' },
  status: { icon: Tag, label: 'Status' },
}

// Helper function to safely get options from a field and remove duplicates
const getFieldOptions = (field: CustomField): StatusOption[] => {
  if (!field.options) return []
  
  const validOptions = field.options.filter((opt): opt is StatusOption => 
    opt !== null && 
    opt !== undefined && 
    typeof opt === 'object' &&
    'value' in opt && 
    'label' in opt && 
    'color' in opt
  )
  
  // Remove duplicates by value
  const seen = new Set<string>()
  return validOptions.filter(opt => {
    if (seen.has(opt.value)) return false
    seen.add(opt.value)
    return true
  })
}

export default function CRMLeads() {
  const params = useParams()
  const clientId = params.clientId as string
  const supabase = createClient()

  // Data state
  const [fields, setFields] = useState<CustomField[]>([])
  const [leads, setLeads] = useState<Lead[]>([])
  const [isLoading, setIsLoading] = useState(true)
  
  // View state
  const [view, setView] = useState<'table' | 'board' | 'chart'>('table')
  const [searchQuery, setSearchQuery] = useState('')
  
  // Modal state
  const [showAddLead, setShowAddLead] = useState(false)
  const [showAddField, setShowAddField] = useState(false)
  const [showFieldSettings, setShowFieldSettings] = useState<CustomField | null>(null)
  const [showLeadDetail, setShowLeadDetail] = useState<Lead | null>(null)
  const [statusDropdown, setStatusDropdown] = useState<{ leadId: string; fieldKey: string } | null>(null)
  
  // Edit state
  const [editingCell, setEditingCell] = useState<{ leadId: string; fieldKey: string } | null>(null)
  const [editValue, setEditValue] = useState('')
  
  // Pending state for optimistic updates
  const [pendingLeads, setPendingLeads] = useState<Set<string>>(new Set())
  const [pendingFields, setPendingFields] = useState<Set<string>>(new Set())
  
  // Form state
  const [newLead, setNewLead] = useState<Record<string, any>>({})
  const [newField, setNewField] = useState({ name: '', type: 'text', urlDisplayType: 'link' as 'button' | 'link' | 'hyperlink' })
  
  // Drag state
  const [draggedLead, setDraggedLead] = useState<Lead | null>(null)
  const [dragOverStatus, setDragOverStatus] = useState<string | null>(null)
  
  // Refs
  const editInputRef = useRef<HTMLInputElement>(null)

  // Load data
  useEffect(() => {
    if (clientId) loadData()
  }, [clientId])

  // Focus edit input
  useEffect(() => {
    if (editingCell && editInputRef.current) {
      editInputRef.current.focus()
      editInputRef.current.select()
    }
  }, [editingCell])

  const loadData = async () => {
    setIsLoading(true)
    await Promise.all([loadFields(), loadLeads()])
    setIsLoading(false)
  }

  const loadFields = async () => {
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
          ? field.options.filter((opt: any) => opt && opt.value && opt.label)
          : []
      }))
      setFields(cleanedFields)
    } else {
      await createDefaultFields()
    }
  }

  const createDefaultFields = async () => {
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
  }

  const loadLeads = async () => {
    const { data, error } = await supabase
      .from('leads')
      .select('*')
      .eq('client_id', clientId)
      .order('position')

    if (error) {
      console.error('Error loading leads:', error)
    }

    setLeads(data || [])
  }

  // Optimistic add lead
  const handleAddLead = async () => {
    const tempId = `temp-${Date.now()}`
    const leadData = {
      ...newLead,
      date_added: newLead.date_added || new Date().toISOString().split('T')[0],
      status: newLead.status || 'new',
    }

    const tempLead: Lead = {
      id: tempId,
      data: leadData,
      position: leads.length,
      created_at: new Date().toISOString(),
    }

    // Optimistic update
    setLeads(prev => [...prev, tempLead])
    setPendingLeads(prev => new Set(prev).add(tempId))
    setShowAddLead(false)
    setNewLead({})

    try {
      const { data, error } = await supabase
        .from('leads')
        .insert({ 
          client_id: clientId, 
          data: leadData, 
          position: leads.length 
        })
        .select()
        .single()

      if (error) throw error

      setLeads(prev => prev.map(l => l.id === tempId ? data : l))
    } catch (err) {
      console.error('Failed to add lead:', err)
      setLeads(prev => prev.filter(l => l.id !== tempId))
    } finally {
      setPendingLeads(prev => {
        const next = new Set(prev)
        next.delete(tempId)
        return next
      })
    }
  }

  // Optimistic update lead
  const handleUpdateLead = useCallback(async (leadId: string, fieldKey: string, value: any) => {
    const lead = leads.find(l => l.id === leadId)
    if (!lead) return

    const updatedData = { ...lead.data, [fieldKey]: value }
    
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, data: updatedData } : l))
    setPendingLeads(prev => new Set(prev).add(leadId))

    try {
      const { error } = await supabase
        .from('leads')
        .update({ data: updatedData, updated_at: new Date().toISOString() })
        .eq('id', leadId)

      if (error) throw error
    } catch (err) {
      console.error('Failed to update lead:', err)
      setLeads(prev => prev.map(l => l.id === leadId ? lead : l))
    } finally {
      setPendingLeads(prev => {
        const next = new Set(prev)
        next.delete(leadId)
        return next
      })
    }

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
    if (!newField.name.trim()) return

    const fieldKey = newField.name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
    const tempId = `temp-${Date.now()}`

    const defaultOptions = newField.type === 'status' || newField.type === 'select' 
      ? [{ value: 'option1', label: 'Option 1', color: '#3B82F6' }]
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
    setNewField({ name: '', type: 'text', urlDisplayType: 'link' })

    try {
      const { data, error } = await supabase
        .from('custom_fields')
        .insert({
          client_id: clientId,
          field_name: newField.name,
          field_key: fieldKey,
          field_type: newField.type,
          options: defaultOptions,
          position: fields.length,
          is_default: false,
        })
        .select()
        .single()

      if (error) throw error

      setFields(prev => prev.map(f => f.id === tempId ? data : f))
    } catch (err: any) {
      console.error('Failed to add field:', err?.message || err)
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
  // Update field
const handleUpdateField = async (fieldId: string, updates: Partial<CustomField>) => {
  const field = fields.find(f => f.id === fieldId)
  if (!field) return

  // Clean updates - ensure options don't have null values and remove duplicates
  let cleanOptions = updates.options
  if (cleanOptions) {
    // Remove nulls
    cleanOptions = cleanOptions.filter(opt => opt && opt.value && opt.label)
    // Remove duplicates by value
    const seen = new Set<string>()
    cleanOptions = cleanOptions.filter(opt => {
      if (seen.has(opt.value)) return false
      seen.add(opt.value)
      return true
    })
  }

  const cleanUpdates = {
    ...updates,
    options: cleanOptions
  }

  // Optimistic update
  setFields(prev => prev.map(f => f.id === fieldId ? { ...f, ...cleanUpdates } : f))
  setPendingFields(prev => new Set(prev).add(fieldId))

  try {
    const { error } = await supabase
      .from('custom_fields')
      .update(cleanUpdates)
      .eq('id', fieldId)

    if (error) {
      console.error('Failed to update field:', error)
      // Rollback
      setFields(prev => prev.map(f => f.id === fieldId ? field : f))
    }
  } catch (err) {
    console.error('Failed to update field:', err)
    setFields(prev => prev.map(f => f.id === fieldId ? field : f))
  } finally {
    setPendingFields(prev => {
      const next = new Set(prev)
      next.delete(fieldId)
      return next
    })
  }
}

  // Delete field
  const handleDeleteField = async (fieldId: string) => {
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
  const handleCellClick = (e: React.MouseEvent, leadId: string, fieldKey: string, value: any, fieldType: string) => {
    e.stopPropagation()
    if (fieldType === 'status' || fieldType === 'select') {
      setStatusDropdown({ leadId, fieldKey })
    } else {
      setEditingCell({ leadId, fieldKey })
      setEditValue(value || '')
    }
  }

  const handleCellBlur = () => {
    if (editingCell) {
      handleUpdateLead(editingCell.leadId, editingCell.fieldKey, editValue)
    }
  }

  const handleCellKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleCellBlur()
    else if (e.key === 'Escape') {
      setEditingCell(null)
      setEditValue('')
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
    if (draggedLead && draggedLead.data?.status !== status) {
      handleUpdateLead(draggedLead.id, 'status', status)
    }
    setDraggedLead(null)
    setDragOverStatus(null)
  }

  // Filter leads by search query
  const filteredLeads = leads.filter(lead => {
    if (!searchQuery) return true
    const query = searchQuery.toLowerCase()
    return Object.values(lead.data || {}).some(v => 
      v !== null && v !== undefined && String(v).toLowerCase().includes(query)
    )
  })

  // Get status field and its options safely
  const statusField = fields.find(f => f.field_type === 'status')
  const statusOptions = statusField ? getFieldOptions(statusField) : []

  // Chart data with null safety
  const chartData = statusOptions.map(status => ({
    ...status,
    count: filteredLeads.filter(l => l.data?.status === status.value).length,
  }))

  if (isLoading) {
    return (
      <CRMLayout>
        <div className="flex items-center justify-center h-full">
          <Loading size="lg" text="Loading leads..." />
        </div>
      </CRMLayout>
    )
  }

  return (
    <CRMLayout>
      <div className="p-6 lg:p-8 min-h-full">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">Leads</h1>
            <p className="text-gray-400 mt-1">{leads.length} total leads</p>
          </div>
          
          <div className="flex items-center gap-3">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
              <input
                type="text"
                placeholder="Search leads..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-48 lg:w-64 pl-10 pr-4 py-2.5 bg-[#1E293B] border border-[#334155] rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#2B79F7] focus:border-transparent transition-all"
              />
            </div>

            {/* View Toggle */}
            <div className="flex bg-[#1E293B] rounded-xl p-1 border border-[#334155]">
              <button
                onClick={() => setView('table')}
                className={`p-2.5 rounded-lg transition-all ${
                  view === 'table' 
                    ? 'bg-[#2B79F7] text-white shadow-lg' 
                    : 'text-gray-400 hover:text-white hover:bg-[#334155]'
                }`}
                title="Table View"
              >
                <Table2 className="h-4 w-4" />
              </button>
              <button
                onClick={() => setView('board')}
                className={`p-2.5 rounded-lg transition-all ${
                  view === 'board' 
                    ? 'bg-[#2B79F7] text-white shadow-lg' 
                    : 'text-gray-400 hover:text-white hover:bg-[#334155]'
                }`}
                title="Board View"
              >
                <Kanban className="h-4 w-4" />
              </button>
              <button
                onClick={() => setView('chart')}
                className={`p-2.5 rounded-lg transition-all ${
                  view === 'chart' 
                    ? 'bg-[#2B79F7] text-white shadow-lg' 
                    : 'text-gray-400 hover:text-white hover:bg-[#334155]'
                }`}
                title="Chart View"
              >
                <BarChart3 className="h-4 w-4" />
              </button>
            </div>

            {/* Add Lead */}
            <Button onClick={() => setShowAddLead(true)} className="bg-[#2B79F7] hover:bg-[#1E54B7]">
              <Plus className="h-4 w-4 mr-2" />
              Add Lead
            </Button>
          </div>
        </div>

        {/* Table View */}
        {view === 'table' && (
          <div className="bg-[#1E293B] rounded-2xl border border-[#334155] overflow-hidden shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[#334155] bg-[#0F172A]">
                    <th className="w-10 px-3 py-4" />
                    {fields.map((field) => (
                      <th 
                        key={field.id} 
                        className={`text-left px-4 py-4 text-xs font-semibold text-gray-400 uppercase tracking-wider min-w-[150px] group ${
                          pendingFields.has(field.id) ? 'opacity-50' : ''
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {fieldTypeConfig[field.field_type] && (
                              <span className="text-gray-500">
                                {(() => {
                                  const Icon = fieldTypeConfig[field.field_type].icon
                                  return <Icon className="h-3.5 w-3.5" />
                                })()}
                              </span>
                            )}
                            <span>{field.field_name}</span>
                          </div>
                          <button
                            onClick={() => setShowFieldSettings(field)}
                            className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-[#334155] rounded-lg transition-all"
                          >
                            <Settings2 className="h-3.5 w-3.5 text-gray-400" />
                          </button>
                        </div>
                      </th>
                    ))}
                    <th className="w-12 px-3 py-4 bg-[#0F172A]">
                      <button
                        onClick={() => setShowAddField(true)}
                        className="p-2 hover:bg-[#334155] rounded-lg text-gray-400 hover:text-white transition-all"
                        title="Add Property"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </th>
                    <th className="w-10 px-3 py-4 bg-[#0F172A]" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#334155]">
                  {filteredLeads.map((lead) => (
                    <tr 
                      key={lead.id} 
                      className={`group hover:bg-[#334155]/50 transition-colors cursor-pointer ${
                        pendingLeads.has(lead.id) ? 'opacity-50' : ''
                      }`}
                      onClick={() => setShowLeadDetail(lead)}
                    >
                      <td className="px-3 py-3 bg-[#1E293B]">
                        <GripVertical className="h-4 w-4 text-gray-600 opacity-0 group-hover:opacity-100 cursor-grab" />
                      </td>
                      {fields.map((field) => {
                        const value = lead.data?.[field.field_key] || ''
                        const isEditing = editingCell?.leadId === lead.id && editingCell?.fieldKey === field.field_key

                        return (
                          <td 
                            key={field.id} 
                            className="px-4 py-3 bg-[#1E293B]"
                            onClick={(e) => handleCellClick(e, lead.id, field.field_key, value, field.field_type)}
                          >
                            {isEditing ? (
                              <input
                                ref={editInputRef}
                                type={field.field_type === 'email' ? 'email' : field.field_type === 'date' ? 'date' : field.field_type === 'number' ? 'number' : 'text'}
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onBlur={handleCellBlur}
                                onKeyDown={handleCellKeyDown}
                                className="w-full px-3 py-1.5 bg-[#0F172A] border-2 border-[#2B79F7] rounded-lg text-white focus:outline-none text-sm"
                                onClick={(e) => e.stopPropagation()}
                              />
                            ) : field.field_type === 'status' || field.field_type === 'select' ? (
                              <StatusBadge value={value} options={getFieldOptions(field)} />
                            ) : field.field_type === 'url' && value ? (
                              <UrlDisplay 
                                value={value} 
                                displayType={field.url_display_type || 'link'} 
                                fieldName={field.field_name}
                              />
                            ) : (
                              <span className="text-white block min-h-[24px] px-2 py-1 rounded hover:bg-[#334155] transition-colors">
                                {value || <span className="text-gray-500">—</span>}
                              </span>
                            )}
                          </td>
                        )
                      })}
                      <td className="bg-[#1E293B]" />
                      <td className="px-3 py-3 bg-[#1E293B]">
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
                  {/* Add row */}
                  <tr className="bg-[#0F172A]">
                    <td />
                    <td colSpan={fields.length + 2} className="px-4 py-3">
                      <button
                        onClick={() => setShowAddLead(true)}
                        className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors"
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
          <div className="flex gap-4 overflow-x-auto pb-4">
            {statusOptions.length === 0 ? (
              <div className="flex-1 flex items-center justify-center py-12">
                <div className="text-center">
                  <Kanban className="h-12 w-12 text-gray-600 mx-auto mb-4" />
                  <p className="text-gray-400">No status options configured</p>
                  <p className="text-gray-500 text-sm mt-1">Add a status field with options to use board view</p>
                </div>
              </div>
            ) : (
              statusOptions.map((status, statusIndex) => {
                const statusLeads = filteredLeads.filter(l => l.data?.status === status.value)
                const isDragOver = dragOverStatus === status.value

                return (
                  <div 
                    key={`${status.value}-${statusIndex}`}
                    className="flex-shrink-0 w-[300px]"
                    onDragOver={(e) => handleDragOver(e, status.value)}
                    onDragLeave={() => setDragOverStatus(null)}
                    onDrop={(e) => handleDrop(e, status.value)}
                  >
                    <div className={`bg-[#1E293B] rounded-2xl border transition-colors shadow-xl ${
                      isDragOver ? 'border-[#2B79F7] bg-[#2B79F7]/10' : 'border-[#334155]'
                    }`}>
                      {/* Column Header */}
                      <div className="p-4 border-b border-[#334155]">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div 
                              className="w-3 h-3 rounded-full"
                              style={{ backgroundColor: status.color }}
                            />
                            <h3 className="font-semibold text-white">{status.label}</h3>
                          </div>
                          <span className="text-sm text-gray-400 bg-[#0F172A] px-2.5 py-0.5 rounded-full">
                            {statusLeads.length}
                          </span>
                        </div>
                      </div>
                      
                      {/* Cards */}
                      <div className="p-3 space-y-3 min-h-[200px]">
                        {statusLeads.map((lead) => (
                          <div
                            key={lead.id}
                            className={`bg-[#0F172A] rounded-xl p-4 border border-[#334155] hover:border-[#2B79F7] transition-all cursor-grab active:cursor-grabbing hover:shadow-lg ${
                              draggedLead?.id === lead.id ? 'opacity-50 rotate-2 scale-105' : ''
                            } ${pendingLeads.has(lead.id) ? 'opacity-50' : ''}`}
                            draggable
                            onDragStart={(e) => handleDragStart(e, lead)}
                            onClick={() => setShowLeadDetail(lead)}
                          >
                            <div className="flex items-start justify-between mb-2">
                              <h4 className="font-medium text-white">
                                {lead.data?.name || 'Unnamed Lead'}
                              </h4>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleDeleteLead(lead.id)
                                }}
                                className="p-1 hover:bg-red-500/20 rounded text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                            {lead.data?.email && (
                              <p className="text-sm text-gray-400 flex items-center gap-2">
                                <Mail className="h-3.5 w-3.5" />
                                {lead.data.email}
                              </p>
                            )}
                            {lead.data?.phone && (
                              <p className="text-sm text-gray-500 flex items-center gap-2 mt-1">
                                <Phone className="h-3.5 w-3.5" />
                                {lead.data.phone}
                              </p>
                            )}
                            {lead.data?.date_added && (
                              <p className="text-xs text-gray-600 mt-2">
                                Added {new Date(lead.data.date_added).toLocaleDateString()}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>

                      {/* Add Lead */}
                      <div className="p-3 pt-0">
                        <button
                          onClick={() => {
                            setNewLead({ status: status.value })
                            setShowAddLead(true)
                          }}
                          className="w-full p-3 border-2 border-dashed border-[#334155] rounded-xl text-gray-400 hover:border-[#2B79F7] hover:text-[#2B79F7] transition-all flex items-center justify-center gap-2"
                        >
                          <Plus className="h-4 w-4" />
                          <span className="text-sm">Add Lead</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        )}

        {/* Chart View */}
        {view === 'chart' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Bar Chart */}
            <div className="bg-[#1E293B] rounded-2xl border border-[#334155] p-6 shadow-xl">
              <h3 className="text-lg font-semibold text-white mb-6">Leads by Status</h3>
              {chartData.length === 0 ? (
                <p className="text-gray-400 text-center py-8">No status data available</p>
              ) : (
                <div className="space-y-4">
                  {chartData.map((item, itemIndex) => {
                    const maxCount = Math.max(...chartData.map(d => d.count), 1)
                    const percentage = (item.count / maxCount) * 100

                    return (
                      <div key={item.value} className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2">
                            <div 
                              className="w-3 h-3 rounded-full"
                              style={{ backgroundColor: item.color }}
                            />
                            <span className="text-white font-medium">{item.label}</span>
                          </div>
                          <span className="text-gray-400">{item.count}</span>
                        </div>
                        <div className="h-3 bg-[#0F172A] rounded-full overflow-hidden">
                          <div 
                            className="h-full rounded-full transition-all duration-500"
                            style={{ width: `${percentage}%`, backgroundColor: item.color }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Stats */}
            <div className="bg-[#1E293B] rounded-2xl border border-[#334155] p-6 shadow-xl">
              <h3 className="text-lg font-semibold text-white mb-6">Quick Stats</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-[#0F172A] rounded-xl p-4 border border-[#334155]">
                  <p className="text-gray-400 text-sm">Total Leads</p>
                  <p className="text-2xl font-bold text-white mt-1">{leads.length}</p>
                </div>
                <div className="bg-[#0F172A] rounded-xl p-4 border border-[#334155]">
                  <p className="text-gray-400 text-sm">New This Week</p>
                  <p className="text-2xl font-bold text-[#3B82F6] mt-1">
                    {leads.filter(l => {
                      const date = new Date(l.created_at)
                      const weekAgo = new Date()
                      weekAgo.setDate(weekAgo.getDate() - 7)
                      return date > weekAgo
                    }).length}
                  </p>
                </div>
                <div className="bg-[#0F172A] rounded-xl p-4 border border-[#334155]">
                  <p className="text-gray-400 text-sm">Closed</p>
                  <p className="text-2xl font-bold text-[#10B981] mt-1">
                    {leads.filter(l => l.data?.status === 'closed').length}
                  </p>
                </div>
                <div className="bg-[#0F172A] rounded-xl p-4 border border-[#334155]">
                  <p className="text-gray-400 text-sm">Conversion Rate</p>
                  <p className="text-2xl font-bold text-[#8B5CF6] mt-1">
                    {leads.length > 0 
                      ? `${Math.round((leads.filter(l => l.data?.status === 'closed').length / leads.length) * 100)}%`
                      : '0%'
                    }
                  </p>
                </div>
              </div>
            </div>

            {/* Pie Chart */}
            <div className="bg-[#1E293B] rounded-2xl border border-[#334155] p-6 lg:col-span-2 shadow-xl">
              <h3 className="text-lg font-semibold text-white mb-6">Distribution</h3>
              <div className="flex flex-wrap items-center justify-center gap-8">
                <div className="relative w-48 h-48">
                  <svg viewBox="0 0 100 100" className="w-full h-full transform -rotate-90">
                    {(() => {
                      let accumulated = 0
                      const total = chartData.reduce((sum, d) => sum + d.count, 0) || 1
                      return chartData.map((item, itemIndex) => {
                        const percentage = (item.count / total) * 100
                        const offset = accumulated
                        accumulated += percentage
                        return (
                          <circle
                            key={`${item.value}-${itemIndex}`}
                            cx="50"
                            cy="50"
                            r="40"
                            fill="transparent"
                            stroke={item.color}
                            strokeWidth="20"
                            strokeDasharray={`${percentage * 2.51} ${251 - percentage * 2.51}`}
                            strokeDashoffset={`${-offset * 2.51}`}
                            className="transition-all duration-500"
                          />
                        )
                      })
                    })()}
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="text-center">
                      <p className="text-3xl font-bold text-white">{leads.length}</p>
                      <p className="text-sm text-gray-400">Total</p>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {chartData.map((item, itemIndex) => (
                    <div key={item.value} className="flex items-center gap-2">
                      <div 
                        className="w-3 h-3 rounded-full flex-shrink-0"
                        style={{ backgroundColor: item.color }}
                      />
                      <span className="text-sm text-gray-400">
                        {item.label}: <span className="font-semibold text-white">{item.count}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Add Lead Modal */}
        {showAddLead && (
          <Modal onClose={() => { setShowAddLead(false); setNewLead({}) }} title="Add New Lead">
            <div className="space-y-4 max-h-[60vh] overflow-y-auto">
              {fields.map((field) => {
                const options = getFieldOptions(field)
                
                return (
                  <div key={field.id}>
                    <label className="block text-sm font-medium text-gray-300 mb-1.5">
                      {field.field_name}
                      {field.is_required && <span className="text-red-400 ml-1">*</span>}
                    </label>
                    {(field.field_type === 'status' || field.field_type === 'select') ? (
                      <select
                        value={newLead[field.field_key] || ''}
                        onChange={(e) => setNewLead({ ...newLead, [field.field_key]: e.target.value })}
                        className="w-full px-4 py-2.5 bg-[#0F172A] border border-[#334155] rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                      >
                        <option value="">Select...</option>
                        {options.map((opt, optIndex) => (
                          <option key={`${opt.value}-${optIndex}`} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={field.field_type === 'email' ? 'email' : field.field_type === 'date' ? 'date' : field.field_type === 'number' ? 'number' : 'text'}
                        value={newLead[field.field_key] || (field.field_type === 'date' ? new Date().toISOString().split('T')[0] : '')}
                        onChange={(e) => setNewLead({ ...newLead, [field.field_key]: e.target.value })}
                        placeholder={`Enter ${field.field_name.toLowerCase()}...`}
                        className="w-full px-4 py-2.5 bg-[#0F172A] border border-[#334155] rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                      />
                    )}
                  </div>
                )
              })}
            </div>
            <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-[#334155]">
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
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Property Name</label>
                <input
                  type="text"
                  value={newField.name}
                  onChange={(e) => setNewField({ ...newField, name: e.target.value })}
                  placeholder="e.g., Company, Budget, Source"
                  className="w-full px-4 py-2.5 bg-[#0F172A] border border-[#334155] rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Property Type</label>
                <select
                  value={newField.type}
                  onChange={(e) => setNewField({ ...newField, type: e.target.value })}
                  className="w-full px-4 py-2.5 bg-[#0F172A] border border-[#334155] rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                >
                  {Object.entries(fieldTypeConfig).map(([value, config]) => (
                    <option key={value} value={value}>{config.label}</option>
                  ))}
                </select>
              </div>
              {newField.type === 'url' && (
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">Display Style</label>
                  <div className="grid grid-cols-3 gap-2">
                    {(['hyperlink'] as const).map((type) => (
                      <button
                        key={type}
                        onClick={() => setNewField({ ...newField, urlDisplayType: type })}
                        className={`p-3 rounded-xl border-2 transition-all capitalize text-sm ${
                          newField.urlDisplayType === type
                            ? 'border-[#2B79F7] bg-[#2B79F7]/10 text-[#2B79F7]'
                            : 'border-[#334155] text-gray-400 hover:border-gray-500'
                        }`}
                      >
                        {type}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-[#334155]">
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
            lead={showLeadDetail}
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
            currentValue={leads.find(l => l.id === statusDropdown.leadId)?.data?.[statusDropdown.fieldKey] || ''}
            onSelect={(value) => handleUpdateLead(statusDropdown.leadId, statusDropdown.fieldKey, value)}
            onClose={() => setStatusDropdown(null)}
          />
        )}
      </div>
    </CRMLayout>
  )
}

// Status Badge Component
function StatusBadge({ value, options }: { value: string; options: StatusOption[] }) {
  const option = options.find(o => o.value === value)
  if (!option) return <span className="text-gray-500">—</span>

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

// URL Display Component
function UrlDisplay({ value, displayType, fieldName }: { value: string; displayType: 'button' | 'link' | 'hyperlink'; fieldName?: string }) {
  if (!value) return <span className="text-gray-500">—</span>

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    const url = value.startsWith('http') ? value : `https://${value}`
    window.open(url, '_blank')
  }

  if (displayType === 'button') {
    return (
      <button
        onClick={handleClick}
        className="px-4 py-2 bg-[#2B79F7] text-white text-sm font-medium rounded-lg hover:bg-[#1E54B7] transition-colors flex items-center gap-2 shadow-lg"
      >
        <ExternalLink className="h-4 w-4" />
        {fieldName || 'Open Link'}
      </button>
    )
  }

  if (displayType === 'hyperlink') {
    return (
      <a
        href={value.startsWith('http') ? value : `https://${value}`}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="text-[#2B79F7] hover:underline flex items-center gap-1.5 text-sm font-medium"
      >
        <LinkIcon className="h-4 w-4" />
        <span>{fieldName || 'Click here'}</span>
      </a>
    )
  }

  // Default: raw link
  return (
    <a
      href={value.startsWith('http') ? value : `https://${value}`}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="text-[#2B79F7] hover:underline text-sm truncate block max-w-[250px]"
    >
      {value}
    </a>
  )
}

// Modal Component
function Modal({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  return (
    <div 
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div 
        className="bg-[#1E293B] rounded-2xl border border-[#334155] w-full max-w-md shadow-2xl animate-in fade-in zoom-in duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-6 border-b border-[#334155]">
          <h3 className="text-lg font-semibold text-white">{title}</h3>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-[#334155] rounded-lg text-gray-400 hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  )
}

// Field Settings Modal
// Field Settings Modal
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
          <label className="block text-sm font-medium text-gray-300 mb-1.5">Property Name</label>
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
            className="w-full px-4 py-2.5 bg-[#0F172A] border border-[#334155] rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-[#2B79F7] disabled:opacity-50"
          />
        </div>

        {/* Status/Select Options */}
        {(field.field_type === 'status' || field.field_type === 'select') && (
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-3">
              Options (drag to reorder)
            </label>
            <div className="space-y-2 mb-4">
              {localOptions.map((opt, index) => (
                <div 
                  key={opt.value} 
                  className={`flex items-center gap-3 p-3 bg-[#0F172A] border rounded-xl group transition-all ${
                    draggedIndex === index 
                      ? 'opacity-50 scale-95 border-[#2B79F7]' 
                      : dragOverIndex === index 
                        ? 'border-[#2B79F7] bg-[#2B79F7]/10' 
                        : 'border-[#334155]'
                  }`}
                  draggable
                  onDragStart={(e) => handleDragStart(e, index)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, index)}
                  onDragEnd={handleDragEnd}
                >
                  <GripVertical className="h-4 w-4 text-gray-600 group-hover:text-gray-400 cursor-grab active:cursor-grabbing" />
                  <button
                    type="button"
                    onClick={() => setEditingOption(editingOption === opt.value ? null : opt.value)}
                    className="w-6 h-6 rounded-md flex-shrink-0 border-2 border-transparent hover:border-white/30 transition-all"
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
                      className="flex-1 px-2 py-1 bg-[#1E293B] border border-[#2B79F7] rounded-lg text-white focus:outline-none text-sm"
                    />
                  ) : (
                    <span 
                      className="text-white flex-1 cursor-pointer hover:text-gray-300"
                      onClick={() => setEditingOption(opt.value)}
                    >
                      {opt.label}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => handleDeleteOption(opt.value)}
                    className="p-1.5 hover:bg-red-500/20 rounded-lg text-gray-500 hover:text-red-400 transition-all"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>

            {/* Color picker for editing */}
            {editingOption && (
              <div className="mb-4 p-3 bg-[#0F172A] border border-[#334155] rounded-xl">
                <p className="text-xs text-gray-400 mb-2">Choose color:</p>
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
                            ? 'ring-2 ring-white ring-offset-2 ring-offset-[#0F172A] scale-110' 
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
                  className="flex-1 px-4 py-2.5 bg-[#0F172A] border border-[#334155] rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
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
                        ? 'ring-2 ring-white ring-offset-2 ring-offset-[#1E293B] scale-110' 
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
          <div className="pt-4 border-t border-[#334155]">
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
  onUpdate: (leadId: string, fieldKey: string, value: any) => void
  onDelete: (leadId: string) => void
  getFieldOptions: (field: CustomField) => StatusOption[]
}) {
  return (
    <div 
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div 
        className={`bg-[#1E293B] rounded-2xl border border-[#334155] w-full max-w-2xl max-h-[90vh] overflow-auto shadow-2xl animate-in fade-in zoom-in duration-150 ${isPending ? 'opacity-50' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-6 border-b border-[#334155] sticky top-0 bg-[#1E293B] z-10">
          <h3 className="text-xl font-semibold text-white">
            {lead.data?.name || 'Lead Details'}
          </h3>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                onDelete(lead.id)
                onClose()
              }}
              className="p-2 hover:bg-red-500/20 rounded-lg text-red-400"
            >
              <Trash2 className="h-5 w-5" />
            </button>
            <button 
              onClick={onClose}
              className="p-2 hover:bg-[#334155] rounded-lg text-gray-400 hover:text-white transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-4">
          {fields.map((field) => {
            const options = getFieldOptions(field)
            
            return (
              <div key={field.id}>
                <label className="block text-sm font-medium text-gray-400 mb-2">
                  {field.field_name}
                </label>
                {(field.field_type === 'status' || field.field_type === 'select') ? (
                  <select
                    value={lead.data?.[field.field_key] || ''}
                    onChange={(e) => onUpdate(lead.id, field.field_key, e.target.value)}
                    className="w-full px-4 py-3 bg-[#0F172A] border border-[#334155] rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                  >
                    <option value="">Select...</option>
                    {options.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={field.field_type === 'email' ? 'email' : field.field_type === 'date' ? 'date' : field.field_type === 'number' ? 'number' : 'text'}
                    value={lead.data?.[field.field_key] || ''}
                    onChange={(e) => onUpdate(lead.id, field.field_key, e.target.value)}
                    className="w-full px-4 py-3 bg-[#0F172A] border border-[#334155] rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                  />
                )}
              </div>
            )
          })}
        </div>

        <div className="p-6 border-t border-[#334155] sticky bottom-0 bg-[#1E293B]">
          <p className="text-xs text-gray-500">
            Created: {new Date(lead.created_at).toLocaleString()}
          </p>
        </div>
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
        <div className="bg-[#1E293B] border border-[#334155] rounded-xl shadow-2xl p-4">
          <p className="text-gray-400">No options available</p>
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
        className="bg-[#1E293B] border border-[#334155] rounded-xl shadow-2xl p-2 min-w-[250px] max-h-[400px] overflow-y-auto animate-in fade-in zoom-in duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-3 py-2 border-b border-[#334155] mb-2">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">Select Status</p>
        </div>
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onSelect(opt.value)}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
              currentValue === opt.value 
                ? 'bg-[#2B79F7]/20' 
                : 'hover:bg-[#334155]'
            }`}
          >
            <div 
              className="w-4 h-4 rounded-full flex-shrink-0"
              style={{ backgroundColor: opt.color }}
            />
            <span className="text-white flex-1 text-left">{opt.label}</span>
            {currentValue === opt.value && (
              <Check className="h-4 w-4 text-[#2B79F7] flex-shrink-0" />
            )}
          </button>
        ))}
      </div>
    </div>
  )
}