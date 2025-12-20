'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'

interface CapturePageInfo {
  name: string
  headline: string
  description: string | null
  logo_url: string | null
  include_meeting: boolean
  calendly_url: string | null
  lead_magnet_url: string | null
}

export default function PublicCapturePage() {
  const params = useParams()
  const slug = params.slug as string

  const [pageInfo, setPageInfo] = useState<CapturePageInfo | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [leadMagnetUrl, setLeadMagnetUrl] = useState<string | null>(null)

  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    notes: '',
    meeting_date: '',
    meeting_time: '',
  })

  useEffect(() => {
    const loadPage = async () => {
      try {
        const res = await fetch(`/api/capture/info?slug=${encodeURIComponent(slug)}`)
        const data = await res.json()

        if (!data.success) {
          setError(data.error || 'This page is not available.')
        } else {
          const page = data.page
          setPageInfo({
            name: page.name || '',
            headline: page.headline || 'Get your free resource',
            description: page.description || null,
            logo_url: page.logo_url || null,
            include_meeting: page.include_meeting ?? false,
            calendly_url: page.calendly_url || null,
            lead_magnet_url: page.lead_magnet_url || null,
          })
        }
      } catch (err) {
        console.error('Failed to load capture page info:', err)
        setError('This page is not available.')
      } finally {
        setIsLoading(false)
      }
    }

    loadPage()
  }, [slug])

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!pageInfo) return

    setIsSubmitting(true)
    setError('')
    setSuccess(false)
    setLeadMagnetUrl(null)

    try {
      const res = await fetch('/api/capture/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug,
          name: form.name,
          email: form.email,
          phone: form.phone,
          notes: form.notes,
          meeting_date: pageInfo.include_meeting ? form.meeting_date : null,
          meeting_time: pageInfo.include_meeting ? form.meeting_time : null,
        }),
      })

      const data = await res.json()

      if (!data.success) {
        setError(data.error || 'Something went wrong. Please try again.')
      } else {
        setSuccess(true)
        setLeadMagnetUrl(data.lead_magnet_url || null)
      }
    } catch (err) {
      console.error('Public capture submit error:', err)
      setError('Failed to submit. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500">Loading...</p>
      </div>
    )
  }

  if (error && !pageInfo) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-8 text-center">
            <h1 className="text-xl font-bold text-gray-900 mb-2">
              This page is no longer available
            </h1>
            <p className="text-gray-500">
              {error}
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-lg overflow-x-hidden">
        <Card>
          <CardContent className="p-6 md:p-8">
            {/* Logo at top center */}
            {pageInfo?.logo_url && (
              <div className="flex justify-center mb-4">
                <div className="h-16 w-16 rounded-full bg-gray-100 flex items-center justify-center overflow-hidden">
                  <img
                    src={pageInfo.logo_url}
                    alt={pageInfo.name || 'Logo'}
                    className="h-full w-full object-cover"
                  />
                </div>
              </div>
            )}

            <h1 className="text-2xl font-bold text-gray-900 mb-2 text-center">
              {pageInfo?.headline || 'Get your free resource'}
            </h1>
            {pageInfo?.description && (
              <p className="text-gray-600 mb-6 text-center">
                {pageInfo.description}
              </p>
            )}

            {success ? (
              <div className="space-y-4">
                <p className="text-green-700 bg-green-50 border border-green-200 px-4 py-3 rounded-lg text-sm">
                  You’re in! Check your email for more details.
                </p>
                {leadMagnetUrl && (
                  <a
                    href={leadMagnetUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center px-4 py-2.5 bg-[#2B79F7] text-white rounded-lg text-sm font-medium hover:bg-[#1E54B7]"
                  >
                    Access Your Free Resource
                  </a>
                )}
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <Input
                  label="Name"
                  name="name"
                  value={form.name}
                  onChange={handleChange}
                  placeholder="Your name"
                  required
                />
                <Input
                  label="Email"
                  name="email"
                  type="email"
                  value={form.email}
                  onChange={handleChange}
                  placeholder="you@example.com"
                  required
                />
                <Input
                  label="Phone"
                  name="phone"
                  value={form.phone}
                  onChange={handleChange}
                  placeholder="+1 234 567 890"
                  required
                />
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Notes (optional)
                  </label>
                  <textarea
                    name="notes"
                    value={form.notes}
                    onChange={handleChange}
                    rows={3}
                    className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2B79F7] focus:border-transparent placeholder:text-gray-400 resize-none text-sm"
                    placeholder="Anything you’d like to share?"
                  />
                </div>

                {/* Meeting section */}
{pageInfo?.include_meeting && (
  <div className="space-y-4 border-t border-gray-200 pt-4 mt-2">
    {pageInfo.calendly_url && (
      <div className="rounded-lg border border-gray-200 overflow-hidden">
        <iframe
          src={pageInfo.calendly_url || ''}
          className="w-full h-[600px] border-0"
          loading="lazy"
          title="Schedule a meeting"
        />
      </div>
    )}

    <div className="space-y-2">
      <p className="text-sm font-medium text-gray-800">
        {pageInfo.calendly_url
          ? 'After you book, confirm the date and time you scheduled'
          : 'Preferred meeting time'}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-full">
  <div className="min-w-0">
    <Input
      label={pageInfo.calendly_url ? 'Date you scheduled' : 'Preferred date'}
      name="meeting_date"
      type="date"
      value={form.meeting_date}
      onChange={handleChange}
      required
    />
  </div>

  <div className="min-w-0">
    <Input
      label={pageInfo.calendly_url ? 'Time you scheduled' : 'Preferred time'}
      name="meeting_time"
      type="time"
      value={form.meeting_time}
      onChange={handleChange}
      required
    />
  </div>
</div>
      {pageInfo.calendly_url && (
        <p className="text-xs text-gray-500">
          We’ll use this date and time to confirm your meeting date.
        </p>
      )}
    </div>
  </div>
)}

                {error && (
                  <p className="text-sm text-red-500">{error}</p>
                )}

                <Button
                  type="submit"
                  className="w-full"
                  size="lg"
                  isLoading={isSubmitting}
                >
                  Submit
                </Button>
              </form>
            )}

            <p className="mt-6 text-xs text-gray-400 text-center">
              Powered by Fokus Kreativez
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}