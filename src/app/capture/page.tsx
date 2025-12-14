'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { CRMLayout } from '@/components/crm/CRMLayout'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { 
  Plus, 
  Save, 
  Eye, 
  Copy, 
  Trash2, 
  X, 
  Check, 
  Palette, 
  Type, 
  Hash, 
  Calendar, 
  Mail, 
  Phone, 
  Link as LinkIcon, 
  Video, 
  Settings,
  ExternalLink,
  Zap,
  FileText
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

// Form field types
interface FormField {
  id: string
  type: 'text' | 'email' | 'phone' | 'number' | 'date' | 'textarea' | 'select' | 'checkbox' | 'radio' | 'meeting' | 'file'
  label: string
  required: boolean
  placeholder?: string
  options?: string[]
  description?: string
}

interface FormSettings {
  title: string
  description: string
  submitButtonText: string
  redirectUrl: string
  showProgressBar: boolean
  themeColor: string
  logoUrl: string
  customCss: string
  notifications: {
    email: boolean
    webhook: boolean
    webhookUrl: string
  }
  integrations: {
    calendly: boolean
    calendlyUrl: string
    zoom: boolean
    googleMeet: boolean
    jitsi: boolean
    otherPlatforms: string[]
  }
}

interface CaptureForm {
  id: string
  client_id: string
  name: string
  slug: string
  fields: FormField[]
  settings: FormSettings
  created_at: string
  updated_at: string
  is_active: boolean
}

const fieldTypes = [
  { id: 'text', name: 'Short Text', icon: Type },
  { id: 'email', name: 'Email', icon: Mail },
  { id: 'phone', name: 'Phone', icon: Phone },
  { id: 'number', name: 'Number', icon: Hash },
  { id: 'date', name: 'Date', icon: Calendar },
  { id: 'textarea', name: 'Long Text', icon: FileText },
  { id: 'select', name: 'Dropdown', icon: ChevronDown },
  { id: 'checkbox', name: 'Checkbox', icon: Square },
  { id: 'radio', name: 'Multiple Choice', icon: Circle },
  { id: 'meeting', name: 'Meeting Booking', icon: Video },
  { id: 'file', name: 'File Upload', icon: Paperclip },
]

export default function CaptureForms() {
  const params = useParams()
  const clientId = params.clientId as string
  const supabase = createClient()

  const [forms, setForms] = useState<CaptureForm[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showFormBuilder, setShowFormBuilder] = useState(false)
  const [currentForm, setCurrentForm] = useState<CaptureForm | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [notification, setNotification] = useState<{ type: 'success' | 'error', message: string } | null>(null)

  useEffect(() => {
    if (clientId) loadForms()
  }, [clientId])

  const loadForms = async () => {
    setIsLoading(true)
    try {
      const { data } = await supabase
        .from('capture_forms')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })

      setForms(data || [])
    } catch (error) {
      console.error('Failed to load forms:', error)
      setNotification({ type: 'error', message: 'Failed to load forms' })
    } finally {
      setIsLoading(false)
    }
  }

  const createNewForm = () => {
    const newForm: CaptureForm = {
      id: '',
      client_id: clientId,
      name: 'New Form',
      slug: `form-${Date.now()}`,
      fields: [
        { id: 'field-1', type: 'text', label: 'Name', required: true, placeholder: 'Enter your name' },
        { id: 'field-2', type: 'email', label: 'Email', required: true, placeholder: 'Enter your email' }
      ],
      settings: {
        title: 'Welcome!',
        description: 'Please fill out this form',
        submitButtonText: 'Submit',
        redirectUrl: '',
        showProgressBar: true,
        themeColor: '#2B79F7',
        logoUrl: '',
        customCss: '',
        notifications: {
          email: true,
          webhook: false,
          webhookUrl: ''
        },
        integrations: {
          calendly: false,
          calendlyUrl: '',
          zoom: false,
          googleMeet: false,
          jitsi: false,
          otherPlatforms: []
        }
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      is_active: true
    }
    setCurrentForm(newForm)
    setShowFormBuilder(true)
  }

  const editForm = (form: CaptureForm) => {
    setCurrentForm(form)
    setShowFormBuilder(true)
  }

  const duplicateForm = async (form: CaptureForm) => {
    const duplicatedForm = {
      ...form,
      id: '',
      name: `${form.name} (Copy)`,
      slug: `${form.slug}-copy-${Date.now()}`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
    await saveForm(duplicatedForm)
    loadForms()
  }

  const deleteForm = async (formId: string) => {
    if (!confirm('Are you sure you want to delete this form? This cannot be undone.')) return
    
    try {
      await supabase.from('capture_forms').delete().eq('id', formId)
      setForms(forms.filter(f => f.id !== formId))
      setNotification({ type: 'success', message: 'Form deleted successfully' })
    } catch (error) {
      console.error('Failed to delete form:', error)
      setNotification({ type: 'error', message: 'Failed to delete form' })
    }
  }

  const toggleFormStatus = async (formId: string, currentStatus: boolean) => {
    try {
      const newStatus = !currentStatus
      await supabase.from('capture_forms').update({ is_active: newStatus }).eq('id', formId)
      setForms(forms.map(f => f.id === formId ? { ...f, is_active: newStatus } : f))
      setNotification({ type: 'success', message: `Form ${newStatus ? 'activated' : 'deactivated'}` })
    } catch (error) {
      console.error('Failed to update form status:', error)
      setNotification({ type: 'error', message: 'Failed to update form status' })
    }
  }

  const saveForm = async (form: CaptureForm) => {
    setIsSaving(true)
    try {
      if (form.id) {
        // Update existing form
        const { data, error } = await supabase
          .from('capture_forms')
          .update({ ...form, updated_at: new Date().toISOString() })
          .eq('id', form.id)
          .select()
          .single()

        if (error) throw error
        setForms(forms.map(f => f.id === form.id ? data : f))
        setNotification({ type: 'success', message: 'Form updated successfully' })
      } else {
        // Create new form
        const { data, error } = await supabase
          .from('capture_forms')
          .insert({ ...form, client_id: clientId })
          .select()
          .single()

        if (error) throw error
        setForms([data, ...forms])
        setNotification({ type: 'success', message: 'Form created successfully' })
      }
    } catch (error) {
      console.error('Failed to save form:', error)
      setNotification({ type: 'error', message: 'Failed to save form' })
    } finally {
      setIsSaving(false)
      setShowFormBuilder(false)
    }
  }

  const copyFormUrl = async (slug: string) => {
    const url = `${window.location.origin}/capture/${slug}`
    await navigator.clipboard.writeText(url)
    setNotification({ type: 'success', message: 'Form URL copied to clipboard!' })
  }

  const previewForm = (slug: string) => {
    window.open(`/capture/${slug}`, '_blank')
  }

  if (isLoading) {
    return (
      <CRMLayout>
        <div className="flex items-center justify-center h-full">
          <div className="text-white">Loading forms...</div>
        </div>
      </CRMLayout>
    )
  }

  return (
    <CRMLayout>
      <div className="p-6 lg:p-8 min-h-full">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">Capture Forms</h1>
            <p className="text-gray-400 mt-1">Create custom forms to capture leads and book meetings</p>
          </div>
          <Button onClick={createNewForm}>
            <Plus className="h-4 w-4 mr-2" />
            Create New Form
          </Button>
        </div>

        {/* Notification */}
        {notification && (
          <div className={`mb-6 p-4 rounded-lg ${
            notification.type === 'success' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
          }`}>
            {notification.message}
          </div>
        )}

        {/* Forms Grid */}
        {forms.length === 0 ? (
          <Card className="border-dashed border-gray-600">
            <CardContent className="py-12 text-center">
              <Zap className="h-12 w-12 text-gray-600 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-white mb-2">No forms yet</h3>
              <p className="text-gray-400 mb-4">Create your first capture form to start collecting leads</p>
              <Button onClick={createNewForm}>Create Your First Form</Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {forms.map((form) => (
              <Card key={form.id} className="overflow-hidden">
                <div className="p-4 border-b border-[#334155] bg-[#1E293B]">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-white truncate">{form.name}</h3>
                      <p className="text-sm text-gray-400 mt-1">{form.fields.length} fields</p>
                    </div>
                    <div className="flex items-center gap-2 ml-4">
                      <button
                        onClick={() => toggleFormStatus(form.id, form.is_active)}
                        className={`px-2 py-1 rounded-full text-xs font-medium ${
                          form.is_active 
                            ? 'bg-green-500/20 text-green-400' 
                            : 'bg-gray-500/20 text-gray-400'
                        }`}
                      >
                        {form.is_active ? 'Active' : 'Inactive'}
                      </button>
                    </div>
                  </div>
                </div>
                <CardContent className="p-4">
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm text-gray-400">
                      <LinkIcon className="h-4 w-4" />
                      <span className="truncate">{window.location.origin}/capture/{form.slug}</span>
                    </div>
                    
                    <div className="flex flex-wrap gap-2 pt-2">
                      {form.settings.integrations.zoom && (
                        <span className="px-2 py-1 bg-blue-500/20 text-blue-400 rounded text-xs">Zoom</span>
                      )}
                      {form.settings.integrations.googleMeet && (
                        <span className="px-2 py-1 bg-red-500/20 text-red-400 rounded text-xs">Google Meet</span>
                      )}
                      {form.settings.integrations.jitsi && (
                        <span className="px-2 py-1 bg-purple-500/20 text-purple-400 rounded text-xs">Jitsi</span>
                      )}
                      {form.settings.integrations.calendly && (
                        <span className="px-2 py-1 bg-orange-500/20 text-orange-400 rounded text-xs">Calendly</span>
                      )}
                    </div>

                    <div className="flex items-center justify-between pt-3 border-t border-[#334155]">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => previewForm(form.slug)}
                          className="p-2 hover:bg-[#334155] rounded-lg text-gray-400 hover:text-white transition-colors"
                          title="Preview"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => copyFormUrl(form.slug)}
                          className="p-2 hover:bg-[#334155] rounded-lg text-gray-400 hover:text-white transition-colors"
                          title="Copy URL"
                        >
                          <Copy className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => duplicateForm(form)}
                          className="p-2 hover:bg-[#334155] rounded-lg text-gray-400 hover:text-white transition-colors"
                          title="Duplicate"
                        >
                          <Copy className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => editForm(form)}
                          className="p-2 hover:bg-[#334155] rounded-lg text-gray-400 hover:text-white transition-colors"
                          title="Edit"
                        >
                          <Settings className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => deleteForm(form.id)}
                          className="p-2 hover:bg-red-500/20 rounded-lg text-gray-400 hover:text-red-400 transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Form Builder Modal */}
        {showFormBuilder && currentForm && (
          <FormBuilderModal
            form={currentForm}
            onSave={saveForm}
            onClose={() => setShowFormBuilder(false)}
            isSaving={isSaving}
          />
        )}
      </div>
    </CRMLayout>
  )
}

// Form Builder Modal Component
function FormBuilderModal({ form, onSave, onClose, isSaving }: { 
  form: CaptureForm; 
  onSave: (form: CaptureForm) => void; 
  onClose: () => void;
  isSaving: boolean;
}) {
  const [formData, setFormData] = useState<CaptureForm>(form)
  const [activeTab, setActiveTab] = useState<'fields' | 'settings' | 'integrations'>('fields')

  const updateField = (fieldId: string, updates: Partial<FormField>) => {
    setFormData(prev => ({
      ...prev,
      fields: prev.fields.map(field => 
        field.id === fieldId ? { ...field, ...updates } : field
      )
    }))
  }

  const addField = (type: FormField['type']) => {
    const newField: FormField = {
      id: `field-${Date.now()}`,
      type,
      label: type === 'text' ? 'New Field' : 
             type === 'email' ? 'Email Address' :
             type === 'phone' ? 'Phone Number' :
             type === 'number' ? 'Number' :
             type === 'date' ? 'Date' :
             type === 'textarea' ? 'Message' :
             type === 'select' ? 'Options' :
             type === 'checkbox' ? 'Checkbox' :
             type === 'radio' ? 'Choice' :
             type === 'meeting' ? 'Meeting Booking' :
             'File Upload',
      required: false,
      placeholder: type === 'text' ? 'Enter text...' : 
                  type === 'email' ? 'Enter email...' :
                  type === 'phone' ? 'Enter phone...' :
                  type === 'number' ? 'Enter number...' :
                  type === 'textarea' ? 'Enter your message...' :
                  '',
    }
    setFormData(prev => ({ ...prev, fields: [...prev.fields, newField] }))
  }

  const removeField = (fieldId: string) => {
    setFormData(prev => ({ ...prev, fields: prev.fields.filter(f => f.id !== fieldId) }))
  }

  const moveField = (fromIndex: number, toIndex: number) => {
    const fields = [...formData.fields]
    const [movedField] = fields.splice(fromIndex, 1)
    fields.splice(toIndex, 0, movedField)
    setFormData(prev => ({ ...prev, fields }))
  }

  const handleSave = () => {
    onSave(formData)
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[#1E293B] rounded-2xl border border-[#334155] w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col animate-in fade-in zoom-in duration-150">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-[#334155]">
          <div>
            <h3 className="text-lg font-semibold text-white">Form Builder</h3>
            <p className="text-sm text-gray-400">Customize your capture form</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-[#334155] rounded-lg text-gray-400 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[#334155]">
          <button
            onClick={() => setActiveTab('fields')}
            className={`px-6 py-3 text-sm font-medium transition-colors ${
              activeTab === 'fields' 
                ? 'text-[#2B79F7] border-b-2 border-[#2B79F7]' 
                : 'text-gray-400 hover:text-white'
            }`}
          >
            Fields
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`px-6 py-3 text-sm font-medium transition-colors ${
              activeTab === 'settings' 
                ? 'text-[#2B79F7] border-b-2 border-[#2B79F7]' 
                : 'text-gray-400 hover:text-white'
            }`}
          >
            Settings
          </button>
          <button
            onClick={() => setActiveTab('integrations')}
            className={`px-6 py-3 text-sm font-medium transition-colors ${
              activeTab === 'integrations' 
                ? 'text-[#2B79F7] border-b-2 border-[#2B79F7]' 
                : 'text-gray-400 hover:text-white'
            }`}
          >
            Integrations
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'fields' && (
            <div className="space-y-6">
              <div>
                <h4 className="font-medium text-white mb-3">Form Fields</h4>
                <p className="text-sm text-gray-400 mb-4">Drag and drop to reorder fields</p>
                
                <div className="space-y-4">
                  {formData.fields.map((field, index) => (
                    <div key={field.id} className="bg-[#0F172A] border border-[#334155] rounded-xl p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <div className="p-2 bg-[#2B79F7]/20 rounded-lg">
                            {(() => {
                              const fieldType = fieldTypes.find(ft => ft.id === field.type)
                              if (fieldType) {
                                const Icon = fieldType.icon
                                return <Icon className="h-4 w-4 text-[#2B79F7]" />
                              }
                              return <Type className="h-4 w-4 text-[#2B79F7]" />
                            })()}
                          </div>
                          <input
                            type="text"
                            value={field.label}
                            onChange={(e) => updateField(field.id, { label: e.target.value })}
                            className="bg-transparent text-white font-medium focus:outline-none"
                            placeholder="Field label"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <label className="flex items-center gap-1 text-sm text-gray-400">
                            <input
                              type="checkbox"
                              checked={field.required}
                              onChange={(e) => updateField(field.id, { required: e.target.checked })}
                              className="rounded bg-[#0F172A] border-[#334155] text-[#2B79F7]"
                            />
                            Required
                          </label>
                          <button
                            onClick={() => removeField(field.id)}
                            className="p-1 hover:bg-red-500/20 rounded text-gray-400 hover:text-red-400"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                      
                      {field.type === 'select' || field.type === 'radio' || field.type === 'checkbox' ? (
                        <div className="space-y-2">
                          <label className="block text-sm text-gray-400 mb-1">Options</label>
                          {field.options?.map((option, optIndex) => (
                            <div key={optIndex} className="flex items-center gap-2">
                              <input
                                type="text"
                                value={option}
                                onChange={(e) => {
                                  const newOptions = [...(field.options || [])]
                                  newOptions[optIndex] = e.target.value
                                  updateField(field.id, { options: newOptions })
                                }}
                                className="flex-1 px-3 py-1.5 bg-[#0F172A] border border-[#334155] rounded text-white text-sm"
                                placeholder="Option"
                              />
                              <button
                                onClick={() => {
                                  const newOptions = field.options?.filter((_, i) => i !== optIndex) || []
                                  updateField(field.id, { options: newOptions })
                                }}
                                className="p-1 hover:bg-red-500/20 rounded text-gray-400 hover:text-red-400"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          ))}
                          <button
                            onClick={() => {
                              const newOptions = [...(field.options || []), 'New Option']
                              updateField(field.id, { options: newOptions })
                            }}
                            className="text-sm text-[#2B79F7] hover:underline"
                          >
                            + Add Option
                          </button>
                        </div>
                      ) : field.type === 'meeting' ? (
                        <div className="text-sm text-gray-400">
                          Meeting booking field with integrated calendar
                        </div>
                      ) : (
                        <input
                          type="text"
                          value={field.placeholder || ''}
                          onChange={(e) => updateField(field.id, { placeholder: e.target.value })}
                          className="w-full px-3 py-1.5 bg-[#0F172A] border border-[#334155] rounded text-white text-sm placeholder:text-gray-500"
                          placeholder="Placeholder text"
                        />
                      )}
                    </div>
                  ))}
                </div>

                <div className="mt-6">
                  <h5 className="font-medium text-white mb-3">Add Field</h5>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {fieldTypes.map((fieldType) => (
                      <button
                        key={fieldType.id}
                        onClick={() => addField(fieldType.id as FormField['type'])}
                        className="flex flex-col items-center gap-2 p-3 bg-[#0F172A] border border-[#334155] rounded-lg hover:bg-[#334155] transition-colors"
                      >
                        <fieldType.icon className="h-5 w-5 text-gray-400" />
                        <span className="text-xs text-white">{fieldType.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'settings' && (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Form Title</label>
                <input
                  type="text"
                  value={formData.settings.title}
                  onChange={(e) => setFormData(prev => ({ ...prev, settings: { ...prev.settings, title: e.target.value } }))}
                  className="w-full px-4 py-2.5 bg-[#0F172A] border border-[#334155] rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Form Description</label>
                <textarea
                  value={formData.settings.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, settings: { ...prev.settings, description: e.target.value } }))}
                  rows={3}
                  className="w-full px-4 py-2.5 bg-[#0F172A] border border-[#334155] rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-[#2B79F7] resize-none"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Submit Button Text</label>
                <input
                  type="text"
                  value={formData.settings.submitButtonText}
                  onChange={(e) => setFormData(prev => ({ ...prev, settings: { ...prev.settings, submitButtonText: e.target.value } }))}
                  className="w-full px-4 py-2.5 bg-[#0F172A] border border-[#334155] rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Redirect URL (after submit)</label>
                <input
                  type="url"
                  value={formData.settings.redirectUrl}
                  onChange={(e) => setFormData(prev => ({ ...prev, settings: { ...prev.settings, redirectUrl: e.target.value } }))}
                  placeholder="https://example.com/thank-you"
                  className="w-full px-4 py-2.5 bg-[#0F172A] border border-[#334155] rounded-xl text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Theme Color</label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={formData.settings.themeColor}
                    onChange={(e) => setFormData(prev => ({ ...prev, settings: { ...prev.settings, themeColor: e.target.value } }))}
                    className="w-10 h-10 rounded border border-[#334155] cursor-pointer"
                  />
                  <input
                    type="text"
                    value={formData.settings.themeColor}
                    onChange={(e) => setFormData(prev => ({ ...prev, settings: { ...prev.settings, themeColor: e.target.value } }))}
                    className="flex-1 px-4 py-2.5 bg-[#0F172A] border border-[#334155] rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                  />
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Logo URL</label>
                <input
                  type="url"
                  value={formData.settings.logoUrl}
                  onChange={(e) => setFormData(prev => ({ ...prev, settings: { ...prev.settings, logoUrl: e.target.value } }))}
                  placeholder="https://example.com/logo.png"
                  className="w-full px-4 py-2.5 bg-[#0F172A] border border-[#334155] rounded-xl text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                />
              </div>
              
              <div className="space-y-3">
                <h4 className="font-medium text-white">Notifications</h4>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.settings.notifications.email}
                    onChange={(e) => setFormData(prev => ({ 
                      ...prev, 
                      settings: { 
                        ...prev.settings, 
                        notifications: { ...prev.settings.notifications, email: e.target.checked } 
                      } 
                    }))}
                    className="rounded bg-[#0F172A] border-[#334155] text-[#2B79F7]"
                  />
                  <span className="text-white">Send email notifications when form is submitted</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.settings.notifications.webhook}
                    onChange={(e) => setFormData(prev => ({ 
                      ...prev, 
                      settings: { 
                        ...prev.settings, 
                        notifications: { ...prev.settings.notifications, webhook: e.target.checked } 
                      } 
                    }))}
                    className="rounded bg-[#0F172A] border-[#334155] text-[#2B79F7]"
                  />
                  <span className="text-white">Enable webhook notifications</span>
                </label>
                {formData.settings.notifications.webhook && (
                  <input
                    type="url"
                    value={formData.settings.notifications.webhookUrl}
                    onChange={(e) => setFormData(prev => ({ 
                      ...prev, 
                      settings: { 
                        ...prev.settings, 
                        notifications: { ...prev.settings.notifications, webhookUrl: e.target.value } 
                      } 
                    }))}
                    placeholder="https://your-webhook-url.com"
                    className="w-full px-4 py-2.5 bg-[#0F172A] border border-[#334155] rounded-xl text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                  />
                )}
              </div>
            </div>
          )}

          {activeTab === 'integrations' && (
            <div className="space-y-6">
              <div>
                <h4 className="font-medium text-white mb-3">Video Meeting Platforms</h4>
                <p className="text-sm text-gray-400 mb-4">Enable meeting booking in your forms</p>
                
                <div className="space-y-4">
                  <label className="flex items-center gap-3 p-4 bg-[#0F172A] border border-[#334155] rounded-xl cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.settings.integrations.zoom}
                      onChange={(e) => setFormData(prev => ({ 
                        ...prev, 
                        settings: { 
                          ...prev.settings, 
                          integrations: { ...prev.settings.integrations, zoom: e.target.checked } 
                        } 
                      }))}
                      className="rounded bg-[#0F172A] border-[#334155] text-[#2B79F7] h-5 w-5"
                    />
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-blue-500/20 rounded-lg">
                        <Video className="h-5 w-5 text-blue-400" />
                      </div>
                      <div>
                        <span className="text-white font-medium">Zoom</span>
                        <p className="text-sm text-gray-400">Schedule Zoom meetings directly from forms</p>
                      </div>
                    </div>
                  </label>
                  
                  <label className="flex items-center gap-3 p-4 bg-[#0F172A] border border-[#334155] rounded-xl cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.settings.integrations.googleMeet}
                      onChange={(e) => setFormData(prev => ({ 
                        ...prev, 
                        settings: { 
                          ...prev.settings, 
                          integrations: { ...prev.settings.integrations, googleMeet: e.target.checked } 
                        } 
                      }))}
                      className="rounded bg-[#0F172A] border-[#334155] text-[#2B79F7] h-5 w-5"
                    />
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-red-500/20 rounded-lg">
                        <Video className="h-5 w-5 text-red-400" />
                      </div>
                      <div>
                        <span className="text-white font-medium">Google Meet</span>
                        <p className="text-sm text-gray-400">Create Google Meet links automatically</p>
                      </div>
                    </div>
                  </label>
                  
                  <label className="flex items-center gap-3 p-4 bg-[#0F172A] border border-[#334155] rounded-xl cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.settings.integrations.jitsi}
                      onChange={(e) => setFormData(prev => ({ 
                        ...prev, 
                        settings: { 
                          ...prev.settings, 
                          integrations: { ...prev.settings.integrations, jitsi: e.target.checked } 
                        } 
                      }))}
                      className="rounded bg-[#0F172A] border-[#334155] text-[#2B79F7] h-5 w-5"
                    />
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-purple-500/20 rounded-lg">
                        <Video className="h-5 w-5 text-purple-400" />
                      </div>
                      <div>
                        <span className="text-white font-medium">Jitsi</span>
                        <p className="text-sm text-gray-400">Free, open-source video conferencing</p>
                      </div>
                    </div>
                  </label>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Other Platforms</label>
                    <input
                      type="text"
                      value={formData.settings.integrations.otherPlatforms.join(', ')}
                      onChange={(e) => setFormData(prev => ({ 
                        ...prev, 
                        settings: { 
                          ...prev.settings, 
                          integrations: { ...prev.settings.integrations, otherPlatforms: e.target.value.split(',').map(p => p.trim()).filter(p => p) } 
                        } 
                      }))}
                      placeholder="Platform1, Platform2, Platform3"
                      className="w-full px-4 py-2.5 bg-[#0F172A] border border-[#334155] rounded-xl text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                    />
                    <p className="text-xs text-gray-400 mt-1">Comma-separated list of other platforms</p>
                  </div>
                </div>
              </div>
              
              <div>
                <h4 className="font-medium text-white mb-3">Calendly Integration</h4>
                <p className="text-sm text-gray-400 mb-4">Connect your Calendly account for advanced scheduling</p>
                
                <label className="flex items-center gap-3 p-4 bg-[#0F172A] border border-[#334155] rounded-xl cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.settings.integrations.calendly}
                    onChange={(e) => setFormData(prev => ({ 
                      ...prev, 
                      settings: { 
                        ...prev.settings, 
                        integrations: { ...prev.settings.integrations, calendly: e.target.checked } 
                      } 
                    }))}
                    className="rounded bg-[#0F172A] border-[#334155] text-[#2B79F7] h-5 w-5"
                  />
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-orange-500/20 rounded-lg">
                      <Calendar className="h-5 w-5 text-orange-400" />
                    </div>
                    <div>
                      <span className="text-white font-medium">Calendly</span>
                      <p className="text-sm text-gray-400">Use your Calendly scheduling link</p>
                    </div>
                  </div>
                </label>
                
                {formData.settings.integrations.calendly && (
                  <div className="mt-4">
                    <label className="block text-sm font-medium text-gray-300 mb-1.5">Calendly URL</label>
                    <input
                      type="url"
                      value={formData.settings.integrations.calendlyUrl}
                      onChange={(e) => setFormData(prev => ({ 
                        ...prev, 
                        settings: { 
                          ...prev.settings, 
                          integrations: { ...prev.settings.integrations, calendlyUrl: e.target.value } 
                        } 
                      }))}
                      placeholder="https://calendly.com/your-username"
                      className="w-full px-4 py-2.5 bg-[#0F172A] border border-[#334155] rounded-xl text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-[#334155] flex justify-end gap-3">
          <Button variant="outline" onClick={onClose} size="sm">
            Cancel
          </Button>
          <Button onClick={handleSave} isLoading={isSaving} size="sm">
            <Save className="h-4 w-4 mr-2" />
            Save Form
          </Button>
        </div>
      </div>
    </div>
  )
}