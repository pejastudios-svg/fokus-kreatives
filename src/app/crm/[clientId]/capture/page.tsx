'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { CRMLayout } from '@/components/crm/CRMLayout'
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
} from 'lucide-react'

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
  include_meeting: boolean
  calendly_url: string | null
  created_at: string
}

export default function CRMCapturePages() {
  const params = useParams()
  const clientId = params.clientId as string
  const supabase = createClient()

  const [pages, setPages] = useState<CapturePage[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingPage, setEditingPage] = useState<CapturePage | null>(null)
  const [form, setForm] = useState({
    name: '',
    slug: '',
    headline: '',
    description: '',
    lead_magnet_url: '',
    logo_url: '',
    is_active: true,
    include_meeting: false,
    calendly_url: '',
  })
  const [isSaving, setIsSaving] = useState(false)
  const [notification, setNotification] = useState<string | null>(null)
  const [copyingId, setCopyingId] = useState<string | null>(null)
  const [pageToDelete, setPageToDelete] = useState<CapturePage | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    (typeof window !== 'undefined' ? window.location.origin : '')

  useEffect(() => {
    if (clientId) loadPages()
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

  const openNewModal = () => {
    setEditingPage(null)
    setForm({
      name: '',
      slug: '',
      headline: '',
      description: '',
      lead_magnet_url: '',
      logo_url: '',
      is_active: true,
      include_meeting: false,
      calendly_url: '',
    })
    setShowModal(true)
  }

  const openEditModal = (page: CapturePage) => {
    setEditingPage(page)
    setForm({
      name: page.name || '',
      slug: page.slug || '',
      headline: page.headline || '',
      description: page.description || '',
      lead_magnet_url: page.lead_magnet_url || '',
      logo_url: page.logo_url || '',
      is_active: page.is_active,
      include_meeting: page.include_meeting ?? false,
      calendly_url: page.calendly_url || '',
    })
    setShowModal(true)
  }

  const handleFormChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target
    setForm(prev => ({ ...prev, [name]: value }))

    // Auto-generate slug from name if creating new
    if (!editingPage && name === 'name' && !form.slug) {
      const slug = value
        .toLowerCase()
        .trim()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
      setForm(prev => ({ ...prev, slug }))
    }
  }

  const handleSave = async () => {
    if (!form.name || !form.slug) return
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
            is_active: form.is_active,
            include_meeting: form.include_meeting,
            calendly_url: form.calendly_url || null,
          })
          .eq('id', editingPage.id)

        if (error) {
          console.error('Update capture page error:', error)
        } else {
          setNotification('Capture page updated')
          setTimeout(() => setNotification(null), 3000)
          setShowModal(false)
          await loadPages()
        }
      } else {
        const { error } = await supabase.from('capture_pages').insert({
          client_id: clientId,
          name: form.name,
          slug: form.slug,
          headline: form.headline || null,
          description: form.description || null,
          lead_magnet_url: form.lead_magnet_url || null,
          logo_url: form.logo_url || null,
          is_active: form.is_active,
          include_meeting: form.include_meeting,
          calendly_url: form.calendly_url || null,
        })

        if (error) {
          console.error('Create capture page error:', error)
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

    setPages(prev.filter(p => p.id !== id))

    const { error } = await supabase
      .from('capture_pages')
      .delete()
      .eq('id', id)

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

  return (
    <CRMLayout>
      <div className="p-6 lg:p-8 min-h-full">
        {/* Notification */}
        {notification && (
          <div className="mb-4 p-3 rounded-lg bg-green-50 text-green-700 flex items-center gap-2">
            <CheckCircle className="h-4 w-4" />
            <span className="text-sm">{notification}</span>
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">Capture Pages</h1>
            <p className="text-gray-400 mt-1">
              Create simple pages to capture leads into this CRM
            </p>
          </div>
          <Button onClick={openNewModal}>
            <Plus className="h-4 w-4 mr-2" />
            New Capture Page
          </Button>
        </div>

        {/* List */}
        {isLoading ? (
          <Card>
            <CardContent className="py-10 text-center text-gray-400">
              Loading...
            </CardContent>
          </Card>
        ) : pages.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-gray-400">
              No capture pages yet. Create one to start collecting leads.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {pages.map(page => {
              const publicUrl = `${appUrl}/capture/${page.slug}`

              return (
                <Card
                  key={page.id}
                  className="bg-[#1E293B] border-[#334155]"
                >
                  <CardContent className="p-5 flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <div className="p-3 rounded-lg bg-[#0F172A]">
                        <Globe className="h-5 w-5 text-[#2B79F7]" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="text-white font-semibold">
                            {page.name}
                          </h3>
                          <span
                            className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                              page.is_active
                                ? 'bg-green-500/20 text-green-400'
                                : 'bg-gray-500/20 text-gray-400'
                            }`}
                          >
                            {page.is_active ? 'Active' : 'Inactive'}
                          </span>
                          {page.include_meeting && (
                            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-500/20 text-blue-400">
                              Meeting
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-400 mb-2">
                          Slug: <code>{page.slug}</code>
                        </p>
                        {page.headline && (
                          <p className="text-sm text-gray-300">
                            {page.headline}
                          </p>
                        )}
                        <p className="text-xs text-gray-500 mt-2">
                          Public URL:{' '}
                          <span className="text-[#93C5FD]">{publicUrl}</span>
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleCopyLink(page)}
                      >
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
                        <button
                          onClick={() => openEditModal(page)}
                          className="p-2 rounded-lg bg-[#0F172A] text-gray-300 hover:text-white hover:bg-[#111827] transition-colors"
                        >
                          <Edit3 className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setPageToDelete(page)}
                          className="p-2 rounded-lg bg-[#0F172A] text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}

        {/* Create/Edit Modal */}
        {showModal && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
            <div className="bg-[#1E293B] rounded-2xl border border-[#334155] w-full max-w-xl shadow-2xl max-h-[90vh] overflow-y-auto">
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

              <div className="px-6 py-4 space-y-4">
                {/* Basic info */}
                <Input
                  label="Internal Name"
                  name="name"
                  value={form.name}
                  onChange={handleFormChange}
                  placeholder="Free ebook, Webinar signup, etc."
                />
                <Input
                  label="Slug (URL)"
                  name="slug"
                  value={form.slug}
                  onChange={handleFormChange}
                  placeholder="free-guide"
                />
                <Input
                  label="Headline"
                  name="headline"
                  value={form.headline}
                  onChange={handleFormChange}
                  placeholder="Get your free guide to XYZ"
                />
                <div>
                  <label className="block text-sm font-medium text-gray-100 mb-1">
                    Description
                  </label>
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

                {/* Logo upload */}
                <div className="space-y-2">
                  <p className="text-sm font-medium text-gray-100">
                    Logo (optional)
                  </p>
                  <FileUpload
                    label="Upload logo"
                    folder="capture-logos"
                    accept="image/*"
                    onUpload={url =>
                      setForm(prev => ({
                        ...prev,
                        logo_url: url,
                      }))
                    }
                  />
                  <Input
                    label="Or logo URL"
                    name="logo_url"
                    value={form.logo_url}
                    onChange={handleFormChange}
                    placeholder="https://...logo.png"
                  />
                </div>

                <label className="flex items-center gap-2 text-sm text-gray-300">
                  <input
                    type="checkbox"
                    checked={form.is_active}
                    onChange={() =>
                      setForm(prev => ({
                        ...prev,
                        is_active: !prev.is_active,
                      }))
                    }
                    className="w-4 h-4 rounded border-[#334155] bg-[#0F172A] text-[#2B79F7]"
                  />
                  Active
                </label>

                {/* Meeting config */}
                <div className="border-t border-[#334155] pt-4 space-y-3">
                  <label className="flex items-center gap-2 text-sm text-gray-300">
                    <input
                      type="checkbox"
                      checked={form.include_meeting}
                      onChange={() =>
                        setForm(prev => ({
                          ...prev,
                          include_meeting: !prev.include_meeting,
                        }))
                      }
                      className="w-4 h-4 rounded border-[#334155] bg-[#0F172A] text-[#2B79F7]"
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
              </div>

              <div className="flex justify-end gap-3 px-6 py-4 border-t border-[#334155]">
                <Button
                  variant="outline"
                  onClick={() => setShowModal(false)}
                  disabled={isSaving}
                >
                  Cancel
                </Button>
                <Button onClick={handleSave} isLoading={isSaving}>
                  Save
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Delete confirmation modal */}
        {pageToDelete && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
            <div className="bg-[#1E293B] rounded-2xl border border-[#334155] w-full max-w-md shadow-2xl">
              <div className="flex items-center justify-between px-6 py-4 border-b border-[#334155]">
                <h3 className="text-lg font-semibold text-white">
                  Delete Capture Page
                </h3>
                <button
                  onClick={() => setPageToDelete(null)}
                  className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-[#334155]"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="px-6 py-4 space-y-3">
                <p className="text-sm text-gray-300">
                  Are you sure you want to delete the capture page{' '}
                  <span className="font-semibold text-white">
                    "{pageToDelete.name}"
                  </span>
                  ?
                </p>
                <p className="text-xs text-gray-500">
                  This will disable the public link and remove the configuration
                  from your CRM. Submissions already collected remain stored.
                </p>
              </div>
              <div className="flex justify-end gap-3 px-6 py-4 border-t border-[#334155]">
                <Button
                  variant="outline"
                  onClick={() => setPageToDelete(null)}
                  disabled={isDeleting}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleDelete}
                  isLoading={isDeleting}
                  className="bg-red-600 hover:bg-red-500"
                >
                  Delete
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </CRMLayout>
  )
}