'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'

import { Header } from '@/components/layout/Header'
import { useAgencyUser } from '@/components/auth/AgencyUserContext'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { FileUpload } from '@/components/ui/FileUpload'
import { ProfilePictureUpload } from '@/components/ui/ProfilePictureUpload'
import { Skeleton } from '@/components/ui/Loading'

import { ArrowLeft, Save, Trash2, Sparkles, CheckCircle, AlertCircle, ExternalLink, Download, Link as LinkIcon, FileText } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

import { BrandProfileForm } from '@/components/clients/BrandProfileForm'
import { defaultBrandProfile } from '@/components/clients/brandProfile'
import { TopicsBank } from '@/components/clients/TopicsBank'
import { ClientAssignees } from '@/components/clients/ClientAssignees'
import { StoryDmKeywords } from '@/components/clients/StoryDmKeywords'
import { BrandDescriptionSettings } from '@/components/clients/BrandDescriptionSettings'
import { useFormPersistence } from '@/hooks/useFormPersistence'
import { ConfirmModal } from '@/components/ui/ConfirmModal'

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
  brand_doc_url: string | null
  dos_and_donts: string | null
  topics_library: string | null
  key_stories: string | null
  unique_mechanisms: string | null
  social_proof: string | null
  created_at: string

  competitor_insights?: string | null
  website_url?: string | null
  content_tier?: ContentTier | null
  package_tier?: PackageTier | null
  brand_profile?: BrandProfile | null
  archived_at?: string | null
  brand_intake_token?: string | null
  brand_intake_submitted_at?: string | null
}

type PackageTier = 'top' | 'middle' | 'lower'

type ClientFormData = {
  name: string
  business_name: string
  industry: string
  profile_picture_url: string
  target_audience: string
  brand_doc_text: string
  brand_doc_url: string
  dos_and_donts: string
  topics_library: string
  key_stories: string
  unique_mechanisms: string
  social_proof: string
  competitor_insights: string
  website_url: string
  content_tier: ContentTier
  package_tier: PackageTier | ''
  brand_profile: BrandProfile
}

export default function ClientDetailPage() {
  const params = useParams()
  const router = useRouter()
  const clientId = (params?.id as string) ?? ''

  // keep stable across renders
  const supabase = useMemo(() => createClient(), [])

  // Role-derived capabilities come from the agency context. No
  // per-page fetch = no loading flicker on Archive / Delete buttons.
  const {
    canArchiveClients: canArchiveClient,
    canDeleteClients: canDeleteClient,
  } = useAgencyUser()

  const [client, setClient] = useState<ClientRow | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isArchiving, setIsArchiving] = useState(false)

  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [portalLink, setPortalLink] = useState<string | null>(null)
  const [intakeToken, setIntakeToken] = useState<string | null>(null)
  const [isGeneratingIntake, setIsGeneratingIntake] = useState(false)
  const [confirmKind, setConfirmKind] = useState<null | 'archive' | 'delete'>(null)
  const [showBrandUrlInput, setShowBrandUrlInput] = useState(false)

  const [formData, setFormData, , draftRestored] = useFormPersistence<ClientFormData>(
    `clients:${clientId}`,
    {
      name: '',
      business_name: '',
      industry: '',
      profile_picture_url: '',
      target_audience: '',
      brand_doc_text: '',
      brand_doc_url: '',
      dos_and_donts: '',
      topics_library: '',
      key_stories: '',
      unique_mechanisms: '',
      social_proof: '',
      competitor_insights: '',
      website_url: '',
      content_tier: 'beginner',
      package_tier: '',
      brand_profile: defaultBrandProfile(),
    },
  )

  const mapClientToForm = useCallback((row: ClientRow): ClientFormData => {
    return {
      name: row.name ?? '',
      business_name: row.business_name ?? '',
      industry: row.industry ?? '',
      profile_picture_url: row.profile_picture_url ?? '',
      target_audience: row.target_audience ?? '',
      brand_doc_text: row.brand_doc_text ?? '',
      brand_doc_url: row.brand_doc_url ?? '',
      dos_and_donts: row.dos_and_donts ?? '',
      topics_library: row.topics_library ?? '',
      key_stories: row.key_stories ?? '',
      unique_mechanisms: row.unique_mechanisms ?? '',
      social_proof: row.social_proof ?? '',
      competitor_insights: row.competitor_insights ?? '',
      website_url: row.website_url ?? '',
      content_tier: (row.content_tier ?? 'beginner') as ContentTier,
      package_tier: (row.package_tier ?? '') as PackageTier | '',
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

        // A "draft" is only worth keeping if the user actually typed something.
        // Earlier versions of useFormPersistence wrote the empty initial state
        // on first render, which could leave a stale empty draft in
        // sessionStorage that would otherwise short-circuit server prefill.
        const draftLooksEmpty =
          !formData.name &&
          !formData.business_name &&
          !formData.industry &&
          !formData.target_audience &&
          !formData.brand_doc_text &&
          !formData.dos_and_donts &&
          !formData.topics_library &&
          !formData.key_stories &&
          !formData.unique_mechanisms &&
          !formData.social_proof &&
          !formData.competitor_insights &&
          !formData.website_url

        if (!draftRestored || draftLooksEmpty) {
          setFormData(mapClientToForm(row))
        } else {
          // Drafts shouldn't override upload-managed fields - those are set via
          // FileUpload (or removed via Remove buttons), not by typing. Keep the
          // text fields from the draft, but always sync these from the server.
          setFormData((prev) => ({
            ...prev,
            profile_picture_url: row.profile_picture_url ?? '',
            brand_doc_url: row.brand_doc_url ?? '',
          }))
        }
        setIntakeToken(row.brand_intake_token ?? null)
      } else {
        setClient(null)
      }

      setPortalLink(link)
    } finally {
      setIsLoading(false)
    }
    // formData intentionally omitted - refresh should run once on mount, not
    // every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchClient, fetchPortalLink, mapClientToForm, draftRestored, setFormData])

  // Auto-dismiss the toast after a few seconds so it doesn't linger.
  useEffect(() => {
    if (!notification) return
    const t = setTimeout(() => setNotification(null), 3500)
    return () => clearTimeout(t)
  }, [notification])

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
    if (!clientId) return

    setIsArchiving(true)

    const { error } = await supabase
      .from('clients')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', clientId)

    if (error) {
      setNotification({ type: 'error', message: 'Failed to archive client' })
      setIsArchiving(false)
      throw new Error('Failed to archive client')
    }

    setConfirmKind(null)
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
      brand_doc_url: formData.brand_doc_url ? formData.brand_doc_url : null,
      dos_and_donts: formData.dos_and_donts,
      topics_library: formData.topics_library,
      key_stories: formData.key_stories,
      unique_mechanisms: formData.unique_mechanisms,
      social_proof: formData.social_proof,
      competitor_insights: formData.competitor_insights,
      website_url: formData.website_url,
      content_tier: formData.content_tier,
      package_tier: formData.package_tier || null,
      brand_profile: formData.brand_profile,
    }

    const { error } = await supabase.from('clients').update(updatePayload).eq('id', clientId)

    if (error) {
      console.error('save error:', error)
      setNotification({ type: 'error', message: 'Failed to save changes' })
    } else {
      setNotification({ type: 'success', message: 'Client updated successfully!' })
      // Drop the persisted draft WITHOUT blanking the live form. formData
      // already holds exactly what we just saved, so there's no need to clear
      // it to the empty default and refetch - doing that flashed an empty
      // brand profile during the fetch round-trip. Just refresh the `client`
      // snapshot in the background for any derived UI.
      if (typeof window !== 'undefined') {
        try {
          window.sessionStorage.removeItem(`clients:${clientId}`)
        } catch {
          // storage disabled - ignore
        }
      }
      const row = await fetchClient()
      if (row) {
        setClient(row)
        setIntakeToken(row.brand_intake_token ?? null)
      }
    }

    setIsSaving(false)
    setTimeout(() => setNotification(null), 3000)
  }

  const handleDelete = async (password?: string) => {
    if (!clientId) return

    setIsDeleting(true)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.email) {
      setIsDeleting(false)
      throw new Error('Could not verify session')
    }
    const { error: pwErr } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: password ?? '',
    })
    if (pwErr) {
      setIsDeleting(false)
      throw new Error('Incorrect password')
    }

    const { error: usersDelErr } = await supabase.from('users').delete().eq('client_id', clientId)
    if (usersDelErr) console.error('Failed to delete client users:', usersDelErr)

    const { error } = await supabase.from('clients').delete().eq('id', clientId)

    if (error) {
      setIsDeleting(false)
      throw new Error('Failed to delete client')
    }

    setConfirmKind(null)
    router.push('/clients')
  }

  const handleCreateContent = () => {
    sessionStorage.setItem('selectedClientId', clientId)
    router.push('/dashboard')
  }

  const copyPortalLink = async () => {
    if (!portalLink) return
    await navigator.clipboard.writeText(portalLink)
    setNotification({ type: 'success', message: 'CRM invite link copied!' })
    setTimeout(() => setNotification(null), 2000)
  }

  const intakeLink = intakeToken ? `${typeof window !== 'undefined' ? window.location.origin : ''}/intake/${intakeToken}` : null

  const generateIntakeLink = async () => {
    if (!clientId) return
    setIsGeneratingIntake(true)
    try {
      const res = await fetch('/api/clients/brand-intake/generate-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId }),
      })
      const data = await res.json()
      if (!data.success) {
        setNotification({ type: 'error', message: data.error || 'Failed to generate link' })
      } else {
        setIntakeToken(data.token)
        setNotification({ type: 'success', message: 'Intake link generated' })
      }
    } catch (e) {
      console.error('generate intake link error:', e)
      setNotification({ type: 'error', message: 'Failed to generate link' })
    } finally {
      setIsGeneratingIntake(false)
      setTimeout(() => setNotification(null), 2500)
    }
  }

  const copyIntakeLink = async () => {
    if (!intakeLink) return
    await navigator.clipboard.writeText(intakeLink)
    setNotification({ type: 'success', message: 'Intake link copied!' })
    setTimeout(() => setNotification(null), 2000)
  }

  if (isLoading) {
    return (
      <>
        <Header title="Edit client" />
        <ClientEditSkeleton />
      </>
    )
  }

  if (!client) {
    return (
      <>
        <div className="p-8 text-center">Client not found</div>
      </>
    )
  }

  return (
    <>
      <Header title={client.name ?? ''} subtitle={client.business_name ?? ''} />

      <div className="p-4 md:p-8 max-w-4xl mx-auto">
        <div className="sticky top-14 md:top-0 z-30 -mx-4 md:-mx-8 px-4 md:px-8 py-3 mb-6 flex items-center justify-between gap-3 bg-[var(--bg-secondary)] dark:bg-black border-b border-[var(--border-primary)]">
          <Link href={`/clients/${clientId}`} className="inline-flex items-center text-[#2B79F7] hover:underline shrink-0">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to profile
          </Link>

          <div className="flex gap-2">
            <Button onClick={handleCreateContent}>
              <Sparkles className="h-4 w-4 mr-2" />
              Create Content
            </Button>

            {canArchiveClient && (
              <Button
                variant="ghost"
                onClick={() => setConfirmKind('archive')}
                isLoading={isArchiving}
                className="text-yellow-500 hover:bg-yellow-500/10"
              >
                Archive
              </Button>
            )}

            {canDeleteClient && (
              <Button
                variant="ghost"
                onClick={() => setConfirmKind('delete')}
                isLoading={isDeleting}
                className="text-red-500 hover:bg-red-500/10"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </Button>
            )}
          </div>
        </div>

        {notification && (
          <div
            role="status"
            className={`fixed bottom-24 right-6 z-50 max-w-sm px-4 py-3 rounded-xl shadow-lg flex items-center gap-3 animate-in fade-in slide-in-from-bottom-2 duration-200 ${
              notification.type === 'success'
                ? 'bg-green-600 text-white'
                : 'bg-red-600 text-white'
            }`}
          >
            {notification.type === 'success' ? (
              <CheckCircle className="h-5 w-5 shrink-0" />
            ) : (
              <AlertCircle className="h-5 w-5 shrink-0" />
            )}
            <span className="text-sm font-medium">{notification.message}</span>
          </div>
        )}

        {portalLink && (
          <Card className="mb-6 border-[#2B79F7] bg-[#E8F1FF]">
            <CardContent className="py-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-[#2B79F7]">CRM Invite Link</p>
                  <p className="text-sm text-[#2B79F7]/70 truncate max-w-md">{portalLink}</p>
                </div>
                <Button size="sm" onClick={copyPortalLink}>
                  Copy Link
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <Card className="mb-6 border-blue-200 bg-blue-50 dark:border-transparent dark:bg-[#1E3A6F]">
          <CardContent className="py-4">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="font-medium text-blue-700 dark:text-[#93C5FD]">Brand Intake Link</p>
                {intakeLink ? (
                  <p className="text-sm text-blue-600/70 dark:text-[#93C5FD]/80 truncate">{intakeLink}</p>
                ) : (
                  <p className="text-sm text-blue-600/70 dark:text-[#93C5FD]/80">
                    Generate a shareable link the client can fill out themselves.
                  </p>
                )}
                {client?.brand_intake_submitted_at && (
                  <p className="text-xs text-green-600 mt-1">
                    Client submitted on {new Date(client.brand_intake_submitted_at).toLocaleDateString()}
                  </p>
                )}
              </div>
              <div className="flex gap-2 shrink-0">
                {intakeLink && (
                  <Button size="sm" variant="outline" onClick={copyIntakeLink}>
                    Copy
                  </Button>
                )}
                <Button size="sm" onClick={generateIntakeLink} isLoading={isGeneratingIntake}>
                  {intakeLink ? 'Regenerate' : 'Generate Link'}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <h3 className="text-lg font-semibold text-[var(--text-primary)]">Profile Picture</h3>
            </CardHeader>
            <CardContent>
              <div className="flex justify-center">
                <ProfilePictureUpload
                  value={formData.profile_picture_url}
                  onChange={(url) =>
                    setFormData((prev) => ({ ...prev, profile_picture_url: url }))
                  }
                  folder="client-profile-pictures"
                  fallback={formData.name ? 'initial' : 'user'}
                  initialChar={formData.name.charAt(0) || 'C'}
                  ariaLabel="Client profile picture"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <h3 className="text-lg font-semibold text-[var(--text-primary)]">Basic Information</h3>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input label="Client Name" name="name" value={formData.name} onChange={handleChange} />
                <Input label="Business Name" name="business_name" value={formData.business_name} onChange={handleChange} />
              </div>

              <Input label="Industry" name="industry" value={formData.industry} onChange={handleChange} />

              <div>
                <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">Target Audience</label>
                <textarea
                  name="target_audience"
                  value={formData.target_audience}
                  onChange={handleChange}
                  rows={3}
                  className="w-full px-4 py-2.5 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7] focus:border-transparent resize-none"
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
                <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">Content Voice Tier</label>
                <select
                  name="content_tier"
                  value={formData.content_tier}
                  onChange={(e) => setFormData((prev) => ({ ...prev, content_tier: e.target.value as ContentTier }))}
                  className="w-full px-4 py-2.5 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                >
                  <option value="beginner">Beginner</option>
                  <option value="mid">Mid</option>
                  <option value="advanced">Advanced</option>
                </select>

                <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                  Controls how soft vs direct your hooks/CTAs are and how much authority content we use.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">Package Tier</label>
                <select
                  name="package_tier"
                  value={formData.package_tier}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, package_tier: e.target.value as PackageTier | '' }))
                  }
                  className="w-full px-4 py-2.5 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                >
                  <option value="">Not set</option>
                  <option value="top">Top (Authority Engine)</option>
                  <option value="middle">Middle (Growth)</option>
                  <option value="lower">Lower (Foundation)</option>
                </select>

                <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                  Subscription level. Drives task deliverables and CRM access. Changes apply immediately.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <h3 className="text-lg font-semibold text-[var(--text-primary)]">Brand Profile Builder</h3>
              <p className="text-sm text-[var(--text-tertiary)] mt-1">Structured brand details for more accurate scripts.</p>
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
              <h3 className="text-lg font-semibold text-[var(--text-primary)]">Brand Document</h3>
              <p className="text-sm text-[var(--text-tertiary)] mt-1">Upload a PDF or paste a Google Doc / Notion link.</p>
            </CardHeader>
            <CardContent className="space-y-4">
              {formData.brand_doc_url ? (
                <div className="flex items-center gap-3 p-4 bg-[#2B79F7]/10 dark:bg-[#2B79F7]/15 rounded-lg">
                  <FileText className="h-5 w-5 text-[#2B79F7] shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[#1E54B7] dark:text-[#93C5FD] truncate">
                      {(() => {
                        try {
                          const u = new URL(formData.brand_doc_url)
                          const last = u.pathname.split('/').filter(Boolean).pop()
                          return last ? decodeURIComponent(last) : u.hostname
                        } catch {
                          return formData.brand_doc_url
                        }
                      })()}
                    </p>
                    <p className="text-xs text-[#2B79F7]/80 dark:text-[#93C5FD]/80 truncate">
                      {formData.brand_doc_url}
                    </p>
                  </div>
                  <a
                    href={formData.brand_doc_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-[var(--bg-card)] border border-[#2B79F7]/30 text-[#2B79F7] dark:text-[#93C5FD] text-xs font-medium hover:bg-[#2B79F7]/10 transition"
                    title="Preview"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Preview
                  </a>
                  <a
                    href={formData.brand_doc_url}
                    download
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-[var(--bg-card)] border border-[#2B79F7]/30 text-[#2B79F7] dark:text-[#93C5FD] text-xs font-medium hover:bg-[#2B79F7]/10 transition"
                    title="Download"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download
                  </a>
                  <button
                    type="button"
                    onClick={() => {
                      setFormData((prev) => ({ ...prev, brand_doc_url: '' }))
                      setShowBrandUrlInput(false)
                    }}
                    className="text-red-500 text-xs hover:underline px-2"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <>
                  <FileUpload
                    folder="brand-docs"
                    accept="application/pdf"
                    label="Upload PDF brand document"
                    onUpload={(url) => setFormData((prev) => ({ ...prev, brand_doc_url: url }))}
                  />
                  {showBrandUrlInput ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-3">
                        <div className="h-px bg-[var(--border-primary)] flex-1" />
                        <span className="text-xs text-[var(--text-tertiary)]">or paste a link</span>
                        <div className="h-px bg-[var(--border-primary)] flex-1" />
                      </div>
                      <div className="flex items-center gap-2">
                        <Input
                          name="brand_doc_url"
                          value={formData.brand_doc_url}
                          onChange={handleChange}
                          placeholder="https://docs.google.com/document/d/..."
                          className="flex-1"
                        />
                        <button
                          type="button"
                          onClick={() => setShowBrandUrlInput(false)}
                          className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)] px-2"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowBrandUrlInput(true)}
                      className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-[var(--border-primary)] bg-[var(--bg-card)] text-[var(--text-primary)] text-sm font-medium hover:bg-[var(--bg-tertiary)] transition"
                    >
                      <LinkIcon className="h-4 w-4" />
                      Or paste a link
                    </button>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <h3 className="text-lg font-semibold text-[var(--text-primary)]">Content Guidelines</h3>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">Do&apos;s and Don&apos;ts</label>
                <textarea
                  name="dos_and_donts"
                  value={formData.dos_and_donts}
                  onChange={handleChange}
                  rows={4}
                  className="w-full px-4 py-2.5 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7] focus:border-transparent resize-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">Topics Library</label>
                <textarea
                  name="topics_library"
                  value={formData.topics_library}
                  onChange={handleChange}
                  rows={4}
                  className="w-full px-4 py-2.5 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7] focus:border-transparent resize-none"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <h3 className="text-lg font-semibold text-[var(--text-primary)]">Stories & Social Proof</h3>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">Key Stories</label>
                <textarea
                  name="key_stories"
                  value={formData.key_stories}
                  onChange={handleChange}
                  rows={4}
                  className="w-full px-4 py-2.5 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7] focus:border-transparent resize-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">Unique Mechanisms</label>
                <textarea
                  name="unique_mechanisms"
                  value={formData.unique_mechanisms}
                  onChange={handleChange}
                  rows={3}
                  className="w-full px-4 py-2.5 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7] focus:border-transparent resize-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">Social Proof & Results</label>
                <textarea
                  name="social_proof"
                  value={formData.social_proof}
                  onChange={handleChange}
                  rows={4}
                  className="w-full px-4 py-2.5 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7] focus:border-transparent resize-none"
                />
              </div>
            </CardContent>
          </Card>

          <TopicsBank clientId={clientId} />

          <StoryDmKeywords clientId={clientId} />

          <BrandDescriptionSettings clientId={clientId} />

          <ClientAssignees clientId={clientId} />

          <Card>
            <CardHeader>
              <h3 className="text-lg font-semibold text-[var(--text-primary)]">Competitor Insights</h3>
              <p className="text-sm text-[var(--text-tertiary)] mt-1">Saved from competitor analysis. Used by AI for content creation.</p>
            </CardHeader>
            <CardContent>
              <textarea
                name="competitor_insights"
                value={formData.competitor_insights}
                onChange={handleChange}
                placeholder="Competitor insights will appear here after you analyze competitors..."
                rows={8}
                className="w-full px-4 py-2.5 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-tertiary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7] focus:border-transparent resize-none font-mono text-sm"
              />
            </CardContent>
          </Card>

        </div>
      </div>

      {/* Sticky save FAB. Bottom-right is the natural action corner; the
          toast lifts itself to bottom-24 to clear it when both are visible. */}
      <button
        type="button"
        onClick={handleSave}
        disabled={isSaving}
        className="fixed bottom-6 right-6 z-40 inline-flex items-center gap-2 px-5 py-3 rounded-full bg-[#2B79F7] text-white text-sm font-semibold shadow-xl hover:bg-[#1E54B7] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        aria-label="Save changes"
      >
        <Save className="h-4 w-4" />
        {isSaving ? 'Saving...' : 'Save changes'}
      </button>

      <ConfirmModal
        open={confirmKind === 'archive'}
        title="Archive client?"
        message="This client and their CRM will be archived. You can unarchive them later."
        confirmLabel="Archive"
        tone="warning"
        onConfirm={handleArchive}
        onClose={() => setConfirmKind(null)}
      />
      <ConfirmModal
        open={confirmKind === 'delete'}
        title="Delete client?"
        message="This permanently deletes the client and their CRM data. This cannot be undone."
        confirmLabel="Delete"
        tone="danger"
        requirePassword
        onConfirm={handleDelete}
        onClose={() => setConfirmKind(null)}
      />
    </>
  )
}

function ClientEditSkeleton() {
  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto animate-in fade-in">
      {/* Back link + top action buttons */}
      <div className="flex items-center justify-between mb-6 gap-2 flex-wrap">
        <Skeleton className="h-4 w-28" />
        <div className="flex gap-2">
          <Skeleton className="h-9 w-32 rounded-lg" />
          <Skeleton className="h-9 w-24 rounded-lg" />
          <Skeleton className="h-9 w-24 rounded-lg" />
        </div>
      </div>

      {/* Brand intake link card */}
      <Card className="mb-6">
        <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="space-y-2 min-w-0 flex-1">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-72 max-w-full" />
          </div>
          <div className="flex gap-2 shrink-0">
            <Skeleton className="h-9 w-20 rounded-lg" />
            <Skeleton className="h-9 w-28 rounded-lg" />
          </div>
        </CardContent>
      </Card>

      <div className="space-y-6">
        {/* Profile picture card (centered, large) */}
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-40" />
          </CardHeader>
          <CardContent>
            <div className="flex justify-center">
              <Skeleton className="h-36 w-36 rounded-full" />
            </div>
          </CardContent>
        </Card>

        {/* Basic info: 2-col fields */}
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-36" />
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-10 w-full rounded-lg" />
                </div>
              ))}
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-24 w-full rounded-lg" />
            </div>
          </CardContent>
        </Card>

        {/* Brand profile + sections (multi-row textareas) */}
        {[0, 1, 2].map((i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-5 w-48" />
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-24 w-full rounded-lg" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-24 w-full rounded-lg" />
              </div>
            </CardContent>
          </Card>
        ))}

        {/* Save button */}
        <div className="flex justify-end">
          <Skeleton className="h-10 w-36 rounded-lg" />
        </div>
      </div>
    </div>
  )
}