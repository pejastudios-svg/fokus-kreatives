/* eslint-disable @next/next/no-img-element */
'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { FileUpload } from '@/components/ui/FileUpload'
import { ProfilePictureUpload } from '@/components/ui/ProfilePictureUpload'
import { CheckCircle, AlertCircle } from 'lucide-react'
import { BrandProfileForm } from '@/components/clients/BrandProfileForm'
import { defaultBrandProfile, type BrandProfile } from '@/components/clients/brandProfile'
import { useFormPersistence } from '@/hooks/useFormPersistence'

interface IntakeClient {
  id: string
  name: string | null
  business_name: string | null
  industry: string | null
  target_audience: string | null
  website_url: string | null
  profile_picture_url: string | null
  brand_doc_url: string | null
  dos_and_donts: string | null
  topics_library: string | null
  key_stories: string | null
  unique_mechanisms: string | null
  social_proof: string | null
  competitor_insights: string | null
  brand_profile: BrandProfile | null
  already_submitted: boolean
}

type IntakeFormData = {
  name: string
  business_name: string
  industry: string
  target_audience: string
  website_url: string
  profile_picture_url: string
  brand_doc_url: string
  dos_and_donts: string
  topics_library: string
  key_stories: string
  unique_mechanisms: string
  social_proof: string
  competitor_insights: string
  brand_profile: BrandProfile
}

const emptyForm: IntakeFormData = {
  name: '',
  business_name: '',
  industry: '',
  target_audience: '',
  website_url: '',
  profile_picture_url: '',
  brand_doc_url: '',
  dos_and_donts: '',
  topics_library: '',
  key_stories: '',
  unique_mechanisms: '',
  social_proof: '',
  competitor_insights: '',
  brand_profile: defaultBrandProfile(),
}

export default function BrandIntakePage() {
  const params = useParams()
  const token = (params?.token as string) || ''

  const [client, setClient] = useState<IntakeClient | null>(null)
  const [form, setForm, clearForm, draftRestored] = useFormPersistence<IntakeFormData>(
    `intake-form:${token}`,
    emptyForm,
  )
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`/api/clients/brand-intake/info?token=${encodeURIComponent(token)}`)
        const data = await res.json()
        if (!data.success) {
          setError(data.error || 'Invalid link')
          return
        }
        const c = data.client as IntakeClient
        setClient(c)
        if (!draftRestored) {
          setForm({
            name: c.name ?? '',
            business_name: c.business_name ?? '',
            industry: c.industry ?? '',
            target_audience: c.target_audience ?? '',
            website_url: c.website_url ?? '',
            profile_picture_url: c.profile_picture_url ?? '',
            brand_doc_url: c.brand_doc_url ?? '',
            dos_and_donts: c.dos_and_donts ?? '',
            topics_library: c.topics_library ?? '',
            key_stories: c.key_stories ?? '',
            unique_mechanisms: c.unique_mechanisms ?? '',
            social_proof: c.social_proof ?? '',
            competitor_insights: c.competitor_insights ?? '',
            brand_profile: c.brand_profile ?? defaultBrandProfile(),
          })
        }
      } catch (e) {
        console.error('intake load error:', e)
        setError('Failed to load intake form')
      } finally {
        setIsLoading(false)
      }
    }
    if (token) load()
  }, [token, draftRestored, setForm])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target
    setForm((prev) => ({ ...prev, [name]: value }))
  }

  const handleSubmit = async () => {
    setIsSubmitting(true)
    setError('')
    try {
      const res = await fetch('/api/clients/brand-intake/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, form }),
      })
      const data = await res.json()
      if (!data.success) {
        setError(data.error || 'Failed to submit')
      } else {
        clearForm()
        setSuccess(true)
        window.scrollTo({ top: 0, behavior: 'smooth' })
      }
    } catch (e) {
      console.error('intake submit error:', e)
      setError('Failed to submit')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen form-canvas flex items-center justify-center">
        <p className="text-[var(--text-tertiary)]">Loading…</p>
      </div>
    )
  }

  if (error && !client) {
    return (
      <div className="min-h-screen form-canvas flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-8 text-center">
            <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-[var(--text-primary)] mb-2">Link not available</h2>
            <p className="text-[var(--text-tertiary)]">{error}</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (success) {
    return (
      <div className="min-h-screen form-canvas flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-8 text-center">
            <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-[var(--text-primary)] mb-2">Thanks - we got it!</h2>
            <p className="text-[var(--text-tertiary)]">
              Your brand intake has been saved. Your team will use this to create content for you.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen form-canvas">
      <div className="max-w-3xl mx-auto px-4 py-10 space-y-6">
        <Card>
          <CardContent className="p-6 md:p-8">
            <div className="flex items-center gap-4 mb-4">
              {form.profile_picture_url ? (
                <img
                  src={form.profile_picture_url}
                  alt={form.name || ''}
                  className="h-14 w-14 rounded-full object-cover"
                />
              ) : (
                <div className="h-14 w-14 rounded-full bg-brand-gradient flex items-center justify-center text-white font-bold text-lg">
                  {(form.name || client?.name || 'C').charAt(0).toUpperCase()}
                </div>
              )}
              <div>
                <h1 className="text-2xl font-bold text-[var(--text-primary)]">Brand Intake</h1>
                {(form.business_name || client?.business_name) && (
                  <p className="text-sm text-[var(--text-tertiary)]">for {form.business_name || client?.business_name}</p>
                )}
              </div>
            </div>

            <p className="text-sm text-[var(--text-secondary)]">
              The more detail you share here, the more the content sounds like <em>you</em> - not a generic
              AI. Nothing is public; it only feeds our content engine.
              {client?.already_submitted && (
                <span className="block mt-2 text-xs text-[var(--text-tertiary)]">
                  You&apos;ve submitted this before - feel free to update anything and resubmit.
                </span>
              )}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h3 className="text-lg font-semibold text-[var(--text-primary)]">Profile Picture</h3>
            <p className="text-sm text-[var(--text-tertiary)] mt-1">Logo or personal photo - whatever represents the brand.</p>
          </CardHeader>
          <CardContent>
            <div className="flex justify-center">
              <ProfilePictureUpload
                value={form.profile_picture_url}
                onChange={(url) =>
                  setForm((prev) => ({ ...prev, profile_picture_url: url }))
                }
                folder="profile-pictures"
                fallback={form.name ? 'initial' : 'user'}
                initialChar={form.name.charAt(0) || 'C'}
                ariaLabel="Brand profile picture"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h3 className="text-lg font-semibold text-[var(--text-primary)]">Basic Information</h3>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                label="Your Name"
                name="name"
                value={form.name}
                onChange={handleChange}
                placeholder="John Smith"
              />
              <Input
                label="Business Name"
                name="business_name"
                value={form.business_name}
                onChange={handleChange}
                placeholder="Smith Consulting"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                label="Industry / Niche"
                name="industry"
                value={form.industry}
                onChange={handleChange}
                placeholder="Business coaching, real estate, fitness…"
              />
              <Input
                label="Website URL"
                name="website_url"
                value={form.website_url}
                onChange={handleChange}
                placeholder="https://example.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">Target Audience</label>
              <textarea
                name="target_audience"
                value={form.target_audience}
                onChange={handleChange}
                placeholder="Who is your ideal client? Age, profession, pain points, desires…"
                rows={3}
                className="w-full px-4 py-2.5 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7] focus:border-transparent placeholder:text-[var(--text-tertiary)] resize-none"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h3 className="text-lg font-semibold text-[var(--text-primary)]">Brand Document</h3>
            <p className="text-sm text-[var(--text-tertiary)] mt-1">
              Upload a PDF or paste a Google Doc / Notion link with your full brand guidelines.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {form.brand_doc_url ? (
              <div className="flex items-center gap-3 p-4 bg-green-50 rounded-lg">
                <CheckCircle className="h-5 w-5 text-green-600" />
                <a
                  href={form.brand_doc_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-green-700 text-sm flex-1 truncate hover:underline"
                >
                  {form.brand_doc_url}
                </a>
                <button
                  type="button"
                  onClick={() => setForm((prev) => ({ ...prev, brand_doc_url: '' }))}
                  className="text-green-700 text-xs hover:underline"
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
                  onUpload={(url) => setForm((prev) => ({ ...prev, brand_doc_url: url }))}
                />
                <div className="flex items-center gap-3">
                  <div className="h-px bg-[var(--bg-card-hover)] flex-1" />
                  <span className="text-xs text-[var(--text-tertiary)]">or paste a link</span>
                  <div className="h-px bg-[var(--bg-card-hover)] flex-1" />
                </div>
                <Input
                  name="brand_doc_url"
                  value={form.brand_doc_url}
                  onChange={handleChange}
                  placeholder="https://docs.google.com/document/d/..."
                />
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h3 className="text-lg font-semibold text-[var(--text-primary)]">Content Guidelines</h3>
            <p className="text-sm text-[var(--text-tertiary)] mt-1">Anything we should always do or never do in your content.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">Do&apos;s and Don&apos;ts</label>
              <textarea
                name="dos_and_donts"
                value={form.dos_and_donts}
                onChange={handleChange}
                placeholder={`DO: Use casual, confident tone. Use specific numbers. Tell stories.\nDON'T: Mention competitors by name. Use corporate jargon. Be generic.`}
                rows={5}
                className="w-full px-4 py-2.5 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7] focus:border-transparent placeholder:text-[var(--text-tertiary)] resize-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">Topics Library</label>
              <textarea
                name="topics_library"
                value={form.topics_library}
                onChange={handleChange}
                placeholder="Topics we should cover - one per line."
                rows={5}
                className="w-full px-4 py-2.5 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7] focus:border-transparent placeholder:text-[var(--text-tertiary)] resize-none"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h3 className="text-lg font-semibold text-[var(--text-primary)]">Stories & Social Proof</h3>
            <p className="text-sm text-[var(--text-tertiary)] mt-1">Used as inspiration - never copied word-for-word.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">Key Stories</label>
              <textarea
                name="key_stories"
                value={form.key_stories}
                onChange={handleChange}
                placeholder="Personal origin, transformation, client wins, moments that shaped the brand…"
                rows={5}
                className="w-full px-4 py-2.5 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7] focus:border-transparent placeholder:text-[var(--text-tertiary)] resize-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">Unique Mechanisms / Frameworks</label>
              <textarea
                name="unique_mechanisms"
                value={form.unique_mechanisms}
                onChange={handleChange}
                placeholder="Your proprietary methods, frameworks, step-by-step systems."
                rows={4}
                className="w-full px-4 py-2.5 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7] focus:border-transparent placeholder:text-[var(--text-tertiary)] resize-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">Social Proof & Results</label>
              <textarea
                name="social_proof"
                value={form.social_proof}
                onChange={handleChange}
                placeholder="Specific client wins, testimonials, numbers, press mentions, awards."
                rows={5}
                className="w-full px-4 py-2.5 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7] focus:border-transparent placeholder:text-[var(--text-tertiary)] resize-none"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h3 className="text-lg font-semibold text-[var(--text-primary)]">Competitors</h3>
            <p className="text-sm text-[var(--text-tertiary)] mt-1">
              Who else plays in your space? Paste links to their best content or profiles. We&apos;ll use these for
              inspiration - never to copy.
            </p>
          </CardHeader>
          <CardContent>
            <textarea
              name="competitor_insights"
              value={form.competitor_insights}
              onChange={handleChange}
              placeholder={`https://instagram.com/competitor-1\nhttps://tiktok.com/@competitor-2\nNotes: what you like / don't like about each…`}
              rows={6}
              className="w-full px-4 py-2.5 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7] focus:border-transparent placeholder:text-[var(--text-tertiary)] resize-none"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h3 className="text-lg font-semibold text-[var(--text-primary)]">Voice & Brand Profile</h3>
            <p className="text-sm text-[var(--text-tertiary)] mt-1">
              The AI uses this to write on-brand scripts without guessing. Fill in whatever you can.
            </p>
          </CardHeader>
          <CardContent>
            <BrandProfileForm
              value={form.brand_profile}
              onChange={(next) => setForm((prev) => ({ ...prev, brand_profile: next }))}
            />
          </CardContent>
        </Card>

        {error && (
          <div className="p-4 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>
        )}

        <div className="flex justify-end">
          <Button onClick={handleSubmit} isLoading={isSubmitting} size="lg">
            Submit Brand Intake
          </Button>
        </div>

        <p className="text-xs text-[var(--text-tertiary)] text-center">Powered by Fokus Kreativez</p>
      </div>
    </div>
  )
}
