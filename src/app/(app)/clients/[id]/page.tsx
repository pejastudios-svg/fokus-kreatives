'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'

import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { Header } from '@/components/layout/Header'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { FileUpload } from '@/components/ui/FileUpload'

import { ArrowLeft, Save, Trash2, Sparkles, CheckCircle, AlertCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

import { BrandProfileForm } from '@/components/clients/BrandProfileForm'
import { defaultBrandProfile } from '@/components/clients/brandProfile'

type BrandProfile = ReturnType<typeof defaultBrandProfile>
type ContentTier = 'beginner' | 'mid' | 'advanced'

interface ClientRow {
  id: string
  name: string | null
  business_name: string | null
  industry: string | null
  profile_picture_url: string | null
  target_audience: string | null
  brand_doc_text: string | null
  dos_and_donts: string | null
  topics_library: string | null
  key_stories: string | null
  unique_mechanisms: string | null
  social_proof: string | null
  created_at: string

  competitor_insights?: string | null
  website_url?: string | null
  content_tier?: ContentTier | null
  brand_profile?: BrandProfile | null
  archived_at?: string | null
}

type ClientFormData = {
  name: string
  business_name: string
  industry: string
  profile_picture_url: string
  target_audience: string
  brand_doc_text: string
  dos_and_donts: string
  topics_library: string
  key_stories: string
  unique_mechanisms: string
  social_proof: string
  competitor_insights: string
  website_url: string
  content_tier: ContentTier
  brand_profile: BrandProfile
}

export default function ClientDetailPage() {
  const params = useParams()
  const router = useRouter()
  const clientId = (params?.id as string) ?? ''

  // keep stable across renders
  const supabase = useMemo(() => createClient(), [])

  const [userRole, setUserRole] = useState<string | null>(null)
  const canArchiveClient = userRole === 'admin' || userRole === 'manager'
  const canDeleteClient = userRole === 'admin'

  const [client, setClient] = useState<ClientRow | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isArchiving, setIsArchiving] = useState(false)

  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [portalLink, setPortalLink] = useState<string | null>(null)

  const [formData, setFormData] = useState<ClientFormData>({
    name: '',
    business_name: '',
    industry: '',
    profile_picture_url: '',
    target_audience: '',
    brand_doc_text: '',
    dos_and_donts: '',
    topics_library: '',
    key_stories: '',
    unique_mechanisms: '',
    social_proof: '',
    competitor_insights: '',
    website_url: '',
    content_tier: 'beginner',
    brand_profile: defaultBrandProfile(),
  })

  const mapClientToForm = useCallback((row: ClientRow): ClientFormData => {
    return {
      name: row.name ?? '',
      business_name: row.business_name ?? '',
      industry: row.industry ?? '',
      profile_picture_url: row.profile_picture_url ?? '',
      target_audience: row.target_audience ?? '',
      brand_doc_text: row.brand_doc_text ?? '',
      dos_and_donts: row.dos_and_donts ?? '',
      topics_library: row.topics_library ?? '',
      key_stories: row.key_stories ?? '',
      unique_mechanisms: row.unique_mechanisms ?? '',
      social_proof: row.social_proof ?? '',
      competitor_insights: row.competitor_insights ?? '',
      website_url: row.website_url ?? '',
      content_tier: (row.content_tier ?? 'beginner') as ContentTier,
      brand_profile: row.brand_profile ?? defaultBrandProfile(),
    }
  }, [])

  const fetchClient = useCallback(async (): Promise<ClientRow | null> => {
    if (!clientId) return null

    const { data, error } = await supabase.from('clients').select('*').eq('id', clientId).single()

    if (error) {
      console.error('fetchClient error:', error)
      return null
    }

    return data as ClientRow
  }, [supabase, clientId])

  const fetchPortalLink = useCallback(async (): Promise<string | null> => {
    if (!clientId) return null

    const { data, error } = await supabase
      .from('users')
      .select('invitation_token, invitation_accepted, created_at')
      .eq('client_id', clientId)
      .eq('role', 'client')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      console.error('fetchPortalUser error:', error)
      return null
    }

    if (data?.invitation_token && !data.invitation_accepted) {
      return `${window.location.origin}/invite/${data.invitation_token}`
    }

    return null
  }, [supabase, clientId])

  const refresh = useCallback(async () => {
    try {
      const [row, link] = await Promise.all([fetchClient(), fetchPortalLink()])

      if (row) {
        setClient(row)
        setFormData(mapClientToForm(row))
      } else {
        setClient(null)
      }

      setPortalLink(link)
    } finally {
      setIsLoading(false)
    }
  }, [fetchClient, fetchPortalLink, mapClientToForm])

  useEffect(() => {
    ;(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) return

      const { data, error } = await supabase.from('users').select('role').eq('id', user.id).single()

      if (error) {
        console.error('fetch user role error:', error)
        return
      }

      setUserRole((data?.role as string) ?? null)
    })()
  }, [supabase])

  // Avoid "set-state-in-effect" by deferring the refresh to a microtask.
  useEffect(() => {
    let cancelled = false

    queueMicrotask(() => {
      if (cancelled) return
      void refresh()
    })

    return () => {
      cancelled = true
    }
  }, [refresh])

  const handleArchive = async () => {
    if (!confirm('Archive this client and their CRM? You can unarchive later.')) return
    if (!clientId) return

    setIsArchiving(true)

    const { error } = await supabase
      .from('clients')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', clientId)

    if (error) {
      setNotification({ type: 'error', message: 'Failed to archive client' })
      setIsArchiving(false)
      return
    }

    router.push('/clients')
    setIsArchiving(false)
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target
    setFormData((prev) => ({ ...prev, [name]: value }))
  }

  const handleSave = async () => {
    if (!clientId) return
    setIsSaving(true)

    const updatePayload = {
      name: formData.name,
      business_name: formData.business_name,
      industry: formData.industry,
      profile_picture_url: formData.profile_picture_url ? formData.profile_picture_url : null,
      target_audience: formData.target_audience,
      brand_doc_text: formData.brand_doc_text,
      dos_and_donts: formData.dos_and_donts,
      topics_library: formData.topics_library,
      key_stories: formData.key_stories,
      unique_mechanisms: formData.unique_mechanisms,
      social_proof: formData.social_proof,
      competitor_insights: formData.competitor_insights,
      website_url: formData.website_url,
      content_tier: formData.content_tier,
      brand_profile: formData.brand_profile,
    }

    const { error } = await supabase.from('clients').update(updatePayload).eq('id', clientId)

    if (error) {
      console.error('save error:', error)
      setNotification({ type: 'error', message: 'Failed to save changes' })
    } else {
      setNotification({ type: 'success', message: 'Client updated successfully!' })
      await refresh()
    }

    setIsSaving(false)
    setTimeout(() => setNotification(null), 3000)
  }

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this client? This cannot be undone.')) return
    if (!clientId) return

    setIsDeleting(true)

    const { error: usersDelErr } = await supabase.from('users').delete().eq('client_id', clientId)
    if (usersDelErr) console.error('Failed to delete client users:', usersDelErr)

    const { error } = await supabase.from('clients').delete().eq('id', clientId)

    if (error) {
      setNotification({ type: 'error', message: 'Failed to delete client' })
      setIsDeleting(false)
      return
    }

    router.push('/clients')
  }

  const handleCreateContent = () => {
    sessionStorage.setItem('selectedClientId', clientId)
    router.push('/dashboard')
  }

  const copyPortalLink = async () => {
    if (!portalLink) return
    await navigator.clipboard.writeText(portalLink)
    setNotification({ type: 'success', message: 'Portal link copied!' })
    setTimeout(() => setNotification(null), 2000)
  }

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="p-8 text-center">Loading...</div>
      </DashboardLayout>
    )
  }

  if (!client) {
    return (
      <DashboardLayout>
        <div className="p-8 text-center">Client not found</div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <Header title={client.name ?? ''} subtitle={client.business_name ?? ''} />

      <div className="p-8 max-w-4xl">
        <div className="flex items-center justify-between mb-6">
          <Link href="/clients" className="inline-flex items-center text-[#2B79F7] hover:underline">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Clients
          </Link>

          <div className="flex gap-2">
            <Button onClick={handleCreateContent}>
              <Sparkles className="h-4 w-4 mr-2" />
              Create Content
            </Button>

            {canArchiveClient && (
              <Button
                variant="ghost"
                onClick={handleArchive}
                isLoading={isArchiving}
                className="text-yellow-500 hover:bg-yellow-50"
              >
                Archive
              </Button>
            )}

            {canDeleteClient && (
              <Button
                variant="ghost"
                onClick={handleDelete}
                isLoading={isDeleting}
                className="text-red-500 hover:bg-red-50"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </Button>
            )}
          </div>
        </div>

        {notification && (
          <div
            className={`mb-6 p-4 rounded-lg flex items-center gap-3 ${
              notification.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
            }`}
          >
            {notification.type === 'success' ? <CheckCircle className="h-5 w-5" /> : <AlertCircle className="h-5 w-5" />}
            {notification.message}
          </div>
        )}

        {portalLink && (
          <Card className="mb-6 border-[#2B79F7] bg-[#E8F1FF]">
            <CardContent className="py-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-[#2B79F7]">Client Portal Invite Link</p>
                  <p className="text-sm text-[#2B79F7]/70 truncate max-w-md">{portalLink}</p>
                </div>
                <Button size="sm" onClick={copyPortalLink}>
                  Copy Link
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <h3 className="text-lg font-semibold text-gray-900">Profile Picture</h3>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-6">
                {formData.profile_picture_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={formData.profile_picture_url}
                    alt={formData.name}
                    className="h-20 w-20 rounded-full object-cover"
                  />
                ) : (
                  <div className="h-20 w-20 rounded-full bg-brand-gradient flex items-center justify-center text-white text-2xl font-bold">
                    {formData.name.charAt(0).toUpperCase()}
                  </div>
                )}

                <div className="flex-1 space-y-2">
                  <FileUpload
                    label="Upload Client Profile Picture"
                    folder="client-profile-pictures"
                    accept="image/*"
                    onUpload={(url) => setFormData((prev) => ({ ...prev, profile_picture_url: url }))}
                  />

                  <Input
                    label="Or use URL"
                    name="profile_picture_url"
                    value={formData.profile_picture_url}
                    onChange={handleChange}
                    placeholder="https://example.com/image.jpg"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <h3 className="text-lg font-semibold text-gray-900">Basic Information</h3>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Input label="Client Name" name="name" value={formData.name} onChange={handleChange} />
                <Input label="Business Name" name="business_name" value={formData.business_name} onChange={handleChange} />
              </div>

              <Input label="Industry" name="industry" value={formData.industry} onChange={handleChange} />

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Target Audience</label>
                <textarea
                  name="target_audience"
                  value={formData.target_audience}
                  onChange={handleChange}
                  rows={3}
                  className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2B79F7] focus:border-transparent resize-none"
                />
              </div>

              <Input
                label="Website URL (optional)"
                name="website_url"
                value={formData.website_url}
                onChange={handleChange}
                placeholder="https://example.com"
              />

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Client Tier</label>
                <select
                  name="content_tier"
                  value={formData.content_tier}
                  onChange={(e) => setFormData((prev) => ({ ...prev, content_tier: e.target.value as ContentTier }))}
                  className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                >
                  <option value="beginner">Beginner</option>
                  <option value="mid">Mid</option>
                  <option value="advanced">Advanced</option>
                </select>

                <p className="mt-1 text-xs text-gray-500">
                  Controls how soft vs direct your hooks/CTAs are and how much authority content we use.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <h3 className="text-lg font-semibold text-gray-900">Brand Profile Builder</h3>
              <p className="text-sm text-gray-500 mt-1">Structured brand details for more accurate scripts.</p>
            </CardHeader>
            <CardContent>
              <BrandProfileForm
                value={formData.brand_profile}
                onChange={(next) => setFormData((prev) => ({ ...prev, brand_profile: next }))}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <h3 className="text-lg font-semibold text-gray-900">Brand Document</h3>
              <p className="text-sm text-gray-500 mt-1">Paste the full brand guidelines here. The AI uses this for all content.</p>
            </CardHeader>
            <CardContent>
              <textarea
                name="brand_doc_text"
                value={formData.brand_doc_text}
                onChange={handleChange}
                placeholder="Paste brand guidelines, voice, tone, messaging, values, positioning..."
                rows={10}
                className="w-full px-4 py-3 rounded-lg border border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2B79F7] focus:border-transparent placeholder:text-gray-400 resize-none font-mono text-sm"
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <h3 className="text-lg font-semibold text-gray-900">Content Guidelines</h3>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Do&apos;s and Don&apos;ts</label>
                <textarea
                  name="dos_and_donts"
                  value={formData.dos_and_donts}
                  onChange={handleChange}
                  rows={4}
                  className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2B79F7] focus:border-transparent resize-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Topics Library</label>
                <textarea
                  name="topics_library"
                  value={formData.topics_library}
                  onChange={handleChange}
                  rows={4}
                  className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2B79F7] focus:border-transparent resize-none"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <h3 className="text-lg font-semibold text-gray-900">Stories & Social Proof</h3>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Key Stories</label>
                <textarea
                  name="key_stories"
                  value={formData.key_stories}
                  onChange={handleChange}
                  rows={4}
                  className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2B79F7] focus:border-transparent resize-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Unique Mechanisms</label>
                <textarea
                  name="unique_mechanisms"
                  value={formData.unique_mechanisms}
                  onChange={handleChange}
                  rows={3}
                  className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2B79F7] focus:border-transparent resize-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Social Proof & Results</label>
                <textarea
                  name="social_proof"
                  value={formData.social_proof}
                  onChange={handleChange}
                  rows={4}
                  className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2B79F7] focus:border-transparent resize-none"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <h3 className="text-lg font-semibold text-gray-900">Competitor Insights</h3>
              <p className="text-sm text-gray-500 mt-1">Saved from competitor analysis. Used by AI for content creation.</p>
            </CardHeader>
            <CardContent>
              <textarea
                name="competitor_insights"
                value={formData.competitor_insights}
                onChange={handleChange}
                placeholder="Competitor insights will appear here after you analyze competitors..."
                rows={8}
                className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-gray-50 text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#2B79F7] focus:border-transparent resize-none font-mono text-sm"
              />
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button onClick={handleSave} isLoading={isSaving}>
              <Save className="h-4 w-4 mr-2" />
              Save Changes
            </Button>
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}