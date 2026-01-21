/* eslint-disable @next/next/no-img-element */
'use client'

import { useState, useEffect, useMemo } from 'react'
import { useParams } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'

type FieldType = 'text' | 'email' | 'phone' | 'textarea' | 'select' | 'radio' | 'date' | 'time' | 'embed'
type CaptureField = {
  id: string
  type: FieldType
  label: string
  required?: boolean
  placeholder?: string
  description?: string
  options?: string[]
  embedUrl?: string
  embedHeight?: number
}
type CaptureTheme = {
  background?: { type: 'solid' | 'gradient'; color?: string; from?: string; to?: string; direction?: string }
  textMode?: 'auto' | 'custom'
  textColor?: string
  fontFamily?: 'system' | 'inter' | 'poppins'
}

interface CapturePageInfo {
  name: string
  headline: string
  description: string | null
  logo_url: string | null
  banner_url: string | null
  include_meeting: boolean
  calendly_url: string | null
  lead_magnet_url: string | null
  fields?: CaptureField[] | null
  theme?: CaptureTheme | null
}

function defaultFields(): CaptureField[] {
  return [
    { id: 'name', type: 'text', label: 'Name', required: true, placeholder: 'Your name' },
    { id: 'email', type: 'email', label: 'Email', required: true, placeholder: 'you@example.com' },
    { id: 'phone', type: 'phone', label: 'Phone', required: true, placeholder: '+1 234 567 890' },
    { id: 'notes', type: 'textarea', label: 'Notes', required: false, placeholder: 'Anything you’d like to share?' },
  ]
}

interface RawFieldData {
  id?: unknown;
  type?: unknown;
  label?: unknown;
  required?: unknown;
  placeholder?: unknown;
  description?: unknown;
  options?: unknown;
  embedUrl?: unknown;
  embedHeight?: unknown;
}

function normalizeFields(f: unknown): CaptureField[] {
  if (!Array.isArray(f) || f.length === 0) return defaultFields()
  return (f as RawFieldData[]).map((x) => ({
    id: String(x.id || ''),
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

function detectEmbed(raw?: string) {
  const url = (raw || '').trim()
  if (!url) return { kind: 'none' as const, src: '' }

  // Direct images
  if (/\.(png|jpe?g|gif|webp)$/i.test(url)) {
    return { kind: 'image' as const, src: url }
  }

  // Direct video
  if (/\.(mp4|webm|ogg)$/i.test(url)) {
    return { kind: 'video' as const, src: url }
  }

  // Google Drive file => preview
  if (url.includes('drive.google.com')) {
    const m1 = url.match(/\/file\/d\/([^/]+)/)
    if (m1?.[1]) return { kind: 'iframe' as const, src: `https://drive.google.com/file/d/${m1[1]}/preview` }
    const m2 = url.match(/[?&]id=([^&]+)/)
    if (m2?.[1]) return { kind: 'iframe' as const, src: `https://drive.google.com/file/d/${m2[1]}/preview` }
  }

  // YouTube
  if (url.includes('youtube.com/watch')) {
    const m = url.match(/[?&]v=([^&]+)/)
    if (m?.[1]) return { kind: 'iframe' as const, src: `https://www.youtube.com/embed/${m[1]}` }
  }
  if (url.includes('youtu.be/')) {
    const m = url.match(/youtu\.be\/([^?]+)/)
    if (m?.[1]) return { kind: 'iframe' as const, src: `https://www.youtube.com/embed/${m[1]}` }
  }

  // YouTube Shorts
if (url.includes('youtube.com/shorts/')) {
  const m = url.match(/youtube\.com\/shorts\/([^?\/]+)/)
  if (m?.[1]) return { kind: 'iframe' as const, src: `https://www.youtube.com/embed/${m[1]}` }
}
  // Vimeo
  if (url.includes('vimeo.com/')) {
    const m = url.match(/vimeo\.com\/(\d+)/)
    if (m?.[1]) return { kind: 'iframe' as const, src: `https://player.vimeo.com/video/${m[1]}` }
  }

  // Loom
  if (url.includes('loom.com/share/')) {
    const m = url.match(/loom\.com\/share\/([^?]+)/)
    if (m?.[1]) return { kind: 'iframe' as const, src: `https://www.loom.com/embed/${m[1]}` }
  }

  // TikTok/Instagram often block iframe. We'll show a link fallback.
  if (url.includes('tiktok.com') || url.includes('instagram.com')) {
    return { kind: 'link' as const, src: url }
  }

  // Default: try iframe
  return { kind: 'iframe' as const, src: url }
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

    const [values, setValues] = useState<Record<string, string>>({})
  const [meeting_date, setMeetingDate] = useState('')
  const [meeting_time, setMeetingTime] = useState('')

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
            banner_url: page.banner_url || null,
            include_meeting: page.include_meeting ?? false,
            calendly_url: page.calendly_url || null,
            lead_magnet_url: page.lead_magnet_url || null,
            fields: page.fields || null,
            theme: (() => {
            const t = page.theme
            if (!t) return null
            if (typeof t === 'string') {
            try { return JSON.parse(t) } catch { return null }
            }
            return t
            })(),
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

  const fields = useMemo(() => normalizeFields(pageInfo?.fields), [pageInfo])

  const bgStyle = useMemo(() => {
    const bg = pageInfo?.theme?.background
    if (!bg) return { background: '#f9fafb' }

    if (bg.type === 'gradient') {
      const from = bg.from || '#2B79F7'
      const to = bg.to || '#143A80'
      const dir = bg.direction || '135deg'
      return { background: `linear-gradient(${dir}, ${from}, ${to})` }
    }

    return { background: bg.color || '#f9fafb' }
  }, [pageInfo])

  const fontStyle = useMemo(() => {
    const f = pageInfo?.theme?.fontFamily || 'system'
    if (f === 'inter') return { fontFamily: 'Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif' }
    if (f === 'poppins') return { fontFamily: 'Poppins, system-ui, -apple-system, Segoe UI, Roboto, sans-serif' }
    return { fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Poppins, sans-serif' }
  }, [pageInfo])

  const fontClass =
  pageInfo?.theme?.fontFamily === 'poppins'
    ? 'font-poppins'
    : pageInfo?.theme?.fontFamily === 'inter'
    ? 'font-inter'
    : ''

    const setValue = (id: string, val: string) => setValues((prev) => ({ ...prev, [id]: val }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!pageInfo) return

    setIsSubmitting(true)
    setError('')
    setSuccess(false)
    setLeadMagnetUrl(null)

    try {
      // required validation
      for (const f of fields) {
        if (f.type === 'embed') continue
        if (!f.required) continue
        const v = values[f.id]
        if (v === undefined || v === null || String(v).trim() === '') {
          setError(`Please fill: ${f.label}`)
          setIsSubmitting(false)
          return
        }
      }

      const res = await fetch('/api/capture/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug,
          values,
          // backwards compatibility:
          name: values.name || '',
          email: values.email || '',
          phone: values.phone || '',
          notes: values.notes || '',
          meeting_date: pageInfo.include_meeting ? meeting_date : null,
          meeting_time: pageInfo.include_meeting ? meeting_time : null,
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
      <div className="min-h-screen flex items-center justify-center" style={{ ...bgStyle, ...fontStyle }}>
        <p className="text-white">Loading…</p>
      </div>
    )
  }

  if (error && !pageInfo) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ ...bgStyle, ...fontStyle }}>
        <Card className="w-full max-w-md">
          <CardContent className="p-8 text-center">
            <h1 className="text-xl font-bold text-gray-900 mb-2">This page is no longer available</h1>
            <p className="text-gray-500">{error}</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
<div className={`min-h-screen flex items-center justify-center p-4 overflow-x-hidden ${fontClass}`} style={bgStyle}>      <div className="w-full max-w-lg overflow-x-hidden">
        <Card>
          <CardContent className="p-6 md:p-8">
            {/* Banner + logo */}
            {pageInfo?.banner_url ? (
              <div className="mb-4">
                <div className="relative w-full rounded-xl overflow-hidden border border-gray-200 bg-gray-100">
                  <img src={pageInfo.banner_url} alt="Banner" className="w-full h-40 sm:h-48 object-cover" />
                  {pageInfo.logo_url && (
                    <div className="absolute left-3 bottom-3 h-12 w-12 rounded-full bg-white/90 border border-white/60 shadow-md overflow-hidden">
                      <img src={pageInfo.logo_url} alt={pageInfo.name || 'Logo'} className="h-full w-full object-cover" />
                    </div>
                  )}
                </div>
              </div>
            ) : pageInfo?.logo_url ? (
              <div className="flex justify-center mb-4">
                <div className="h-16 w-16 rounded-full bg-gray-100 overflow-hidden">
                  <img src={pageInfo.logo_url} alt={pageInfo.name || 'Logo'} className="h-full w-full object-cover" />
                </div>
              </div>
            ) : null}

            <h1 className="text-2xl font-bold text-gray-900 mb-2 text-center">
              {pageInfo?.headline || 'Get your free resource'}
            </h1>

            {pageInfo?.description && (
              <p className="text-gray-600 mb-6 text-center">{pageInfo.description}</p>
            )}

            {success ? (
              <div className="space-y-4">
                                <p className="text-green-700 bg-green-50 border border-green-200 px-4 py-3 rounded-lg text-sm">
                  You&rsquo;re in! Let&apos;s Keep Going.
                </p>
                {leadMagnetUrl && (
                  <a
                    href={leadMagnetUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center px-4 py-2.5 bg-[#2B79F7] text-white rounded-lg text-sm font-medium hover:bg-[#1E54B7] w-full"
                  >
                    Access Your Free Resource
                  </a>
                )}
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                {fields.map((f) => {
                  if (f.type === 'embed') {
                    const embed = detectEmbed(f.embedUrl)

if (embed.kind === 'image') {
  return (
    <div key={f.id} className="rounded-lg border border-gray-200 overflow-hidden">
      <img src={embed.src} alt={f.label} className="w-full h-auto object-contain" />
    </div>
  )
}

if (embed.kind === 'video') {
  return (
    <div key={f.id} className="rounded-lg border border-gray-200 overflow-hidden bg-black">
      <video src={embed.src} controls className="w-full h-auto" />
    </div>
  )
}

if (embed.kind === 'link') {
  return (
    <div key={f.id} className="rounded-lg border border-gray-200 p-4 bg-gray-50">
      <p className="text-sm text-gray-700 font-medium">{f.label || 'Embed'}</p>
      <p className="text-xs text-gray-500 mt-1">
        This provider may block embedding on external sites. Open it here:
      </p>
      <a href={embed.src} target="_blank" rel="noopener noreferrer" className="text-sm text-[#2B79F7] hover:underline break-all">
        {embed.src}
      </a>
    </div>
  )
}

// iframe
return (
  <div key={f.id} className="rounded-lg border border-gray-200 overflow-hidden">
    <iframe
      src={embed.src}
      className="w-full border-0"
      style={{ height: f.embedHeight || 520 }}
      loading="lazy"
      title={f.label || 'Embed'}
      allow="autoplay; fullscreen; picture-in-picture"
      allowFullScreen
    />
  </div>
)
                  }

                  if (f.type === 'textarea') {
                    return (
                      <div key={f.id} className="min-w-0">
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          {f.label}{f.required ? ' *' : ''}
                        </label>
                        <textarea
                          value={values[f.id] || ''}
                          onChange={(e) => setValue(f.id, e.target.value)}
                          rows={3}
                          className="w-full max-w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2B79F7] resize-none text-sm"
                          placeholder={f.placeholder || ''}
                        />
                        {f.description && <p className="text-xs text-gray-400 mt-1">{f.description}</p>}
                      </div>
                    )
                  }

                  if (f.type === 'select') {
                    return (
                      <div key={f.id} className="min-w-0">
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          {f.label}{f.required ? ' *' : ''}
                        </label>
                        <select
                          value={values[f.id] || ''}
                          onChange={(e) => setValue(f.id, e.target.value)}
                          className="w-full max-w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                        >
                          <option value="">Select…</option>
                          {(f.options || []).map((opt) => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                        {f.description && <p className="text-xs text-gray-400 mt-1">{f.description}</p>}
                      </div>
                    )
                  }

                  if (f.type === 'radio') {
                    return (
                      <div key={f.id} className="min-w-0">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          {f.label}{f.required ? ' *' : ''}
                        </label>
                        <div className="space-y-2">
                          {(f.options || []).map((opt) => (
                            <label key={opt} className="flex items-center gap-2 text-sm text-gray-700">
                              <input
                                type="radio"
                                name={f.id}
                                checked={(values[f.id] || '') === opt}
                                onChange={() => setValue(f.id, opt)}
                              />
                              <span>{opt}</span>
                            </label>
                          ))}
                        </div>
                        {f.description && <p className="text-xs text-gray-400 mt-1">{f.description}</p>}
                      </div>
                    )
                  }

                  // default input
                  return (
                    <div key={f.id} className="min-w-0">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        {f.label}{f.required ? ' *' : ''}
                      </label>
                      <input
                        type={f.type === 'phone' ? 'tel' : f.type}
                        value={values[f.id] || ''}
                        onChange={(e) => setValue(f.id, e.target.value)}
                        placeholder={f.placeholder || ''}
                        className="w-full max-w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                      />
                      {f.description && <p className="text-xs text-gray-400 mt-1">{f.description}</p>}
                    </div>
                  )
                })}

                {/* Meeting section */}
                {pageInfo?.include_meeting && (
                  <div className="space-y-4 border-t border-gray-200 pt-4 mt-2">
                    {pageInfo.calendly_url && (
                      <div className="rounded-lg border border-gray-200 overflow-hidden">
                        <iframe
                          src={pageInfo.calendly_url || ''}
                          className="w-full border-0"
                          style={{ height: 600 }}
                          loading="lazy"
                          title="Schedule a meeting"
                        />
                      </div>
                    )}

                    <div className="space-y-2">
                      <p className="text-sm font-medium text-gray-800">
                        {pageInfo.calendly_url
                          ? 'After you book, please confirm the date and time you scheduled'
                          : 'Preferred meeting time'}
                      </p>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-full">
                        <div className="min-w-0">
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            {pageInfo.calendly_url ? 'Date you scheduled' : 'Preferred date'} *
                          </label>
                          <input
                            type="date"
                            value={meeting_date}
                            onChange={(e) => setMeetingDate(e.target.value)}
                            className="w-full max-w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-900"
                            required
                          />
                        </div>

                        <div className="min-w-0">
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            {pageInfo.calendly_url ? 'Time you scheduled' : 'Preferred time'} *
                          </label>
                          <input
                            type="time"
                            value={meeting_time}
                            onChange={(e) => setMeetingTime(e.target.value)}
                            className="w-full max-w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-900"
                            required
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {error && <p className="text-sm text-red-500">{error}</p>}

                <Button type="submit" className="w-full" size="lg" isLoading={isSubmitting}>
                  Submit
                </Button>
              </form>
            )}

            <p className="mt-6 text-xs text-gray-400 text-center">Powered by Fokus Kreativez</p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}