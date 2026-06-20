'use client'

// Public capture page. Hydrates the page config + renders one of the
// layout shells based on `pageInfo.layout_template`. All the heavy
// rendering lives in src/components/capture/layouts.tsx; this file
// owns state and submission only.

import { useState, useEffect, useMemo } from 'react'
import { useParams } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/Card'
import { CaptureLayout } from '@/components/capture/layouts'
import { isColorDark, relativeLuminance, buildCaptureThemeVars } from '@/components/capture/colorUtils'
import { useSessionTracking } from '@/components/capture/useSessionTracking'
import type {
  CaptureField,
  CapturePageInfo,
  LayoutTemplate,
} from '@/components/capture/types'

function defaultFields(): CaptureField[] {
  return [
    { id: 'name', type: 'text', label: 'Name', required: true, placeholder: 'Your name' },
    { id: 'email', type: 'email', label: 'Email', required: true, placeholder: 'you@example.com' },
    { id: 'phone', type: 'phone', label: 'Phone', required: true, placeholder: '+1 234 567 890' },
    { id: 'notes', type: 'textarea', label: 'Notes', required: false, placeholder: 'Anything you’d like to share?' },
  ]
}

interface RawFieldData {
  id?: unknown
  type?: unknown
  label?: unknown
  required?: unknown
  placeholder?: unknown
  description?: unknown
  options?: unknown
  embedUrl?: unknown
  embedHeight?: unknown
  repeatable?: unknown
  packages?: unknown
  sectionId?: unknown
}

function normalizeFields(f: unknown): CaptureField[] {
  if (!Array.isArray(f) || f.length === 0) return defaultFields()
  return (f as RawFieldData[]).map((x) => ({
    id: String(x.id || ''),
    type: (x.type as CaptureField['type']) || 'text',
    label: String(x.label || 'Field'),
    required: !!x.required,
    placeholder: x.placeholder ? String(x.placeholder) : undefined,
    description: x.description ? String(x.description) : undefined,
    options: Array.isArray(x.options) ? x.options.map(String) : undefined,
    embedUrl: x.embedUrl ? String(x.embedUrl) : undefined,
    embedHeight: x.embedHeight ? Number(x.embedHeight) : undefined,
    // Preserve repeatable + packages or they vanish on the public page.
    repeatable: x.repeatable ? true : undefined,
    packages: Array.isArray(x.packages)
      ? (x.packages as Array<Record<string, unknown>>).map((p, i) => ({
          id: String(p.id || `pkg-${i}`),
          name: String(p.name || ''),
          subtitle: p.subtitle ? String(p.subtitle) : undefined,
          price: p.price ? String(p.price) : undefined,
          features: Array.isArray(p.features) ? (p.features as unknown[]).map(String) : undefined,
        }))
      : undefined,
    sectionId: x.sectionId ? String(x.sectionId) : undefined,
  }))
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
  const [leadMagnetType, setLeadMagnetType] = useState<string | null>(null)

  const [values, setValues] = useState<Record<string, string>>({})
  const [meeting_date, setMeetingDate] = useState('')
  const [meeting_time, setMeetingTime] = useState('')

  // Anonymous visit tracking (sessions, drop-offs, duration). Posts
  // to /api/capture/track. Returns sessionId so we can send it on
  // submit and mark the session as converted.
  const { sessionId, trackFieldFocus } = useSessionTracking(slug)

  useEffect(() => {
    const loadPage = async () => {
      try {
        // `cache: 'no-store'` prevents the browser from holding a
        // stale response when the page's owner toggles is_active.
        // Without it, refreshing the public page after a toggle-off
        // can still hit the cached "active" response, making the
        // Active control feel broken.
        const res = await fetch(`/api/capture/info?slug=${encodeURIComponent(slug)}`, {
          cache: 'no-store',
        })
        const data = await res.json()

        if (!data.success) {
          setError(data.error || 'This page is not available.')
        } else {
          const page = data.page
          setPageInfo({
            slug,
            name: page.name || '',
            headline: page.headline || 'Get your free resource',
            description: page.description || null,
            logo_url: page.logo_url || null,
            banner_url: page.banner_url || null,
            include_meeting: page.include_meeting ?? false,
            calendly_url: page.calendly_url || null,
            meeting_integration: (page.meeting_integration as CapturePageInfo['meeting_integration']) ?? null,
            meeting_auto_logged: !!page.meeting_auto_logged,
            lead_magnet_url: page.lead_magnet_url || null,
            success_button_text: page.success_button_text || null,
            success_message: page.success_message || null,
            accent_color: page.accent_color || null,
            fields: page.fields || null,
            sections: (page.sections as CapturePageInfo['sections']) || null,
            layout_template: (page.layout_template ?? 'compact') as LayoutTemplate,
            theme: (() => {
              const t = page.theme
              if (!t) return null
              if (typeof t === 'string') {
                try {
                  return JSON.parse(t)
                } catch {
                  return null
                }
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

  const bgStyle = useMemo<React.CSSProperties>(() => {
    const bg = pageInfo?.theme?.background
    let style: React.CSSProperties = { background: '#f9fafb' }
    if (bg) {
      if (bg.type === 'gradient') {
        const from = bg.from || '#2B79F7'
        const to = bg.to || '#143A80'
        const dir = bg.direction || '135deg'
        style = { background: `linear-gradient(${dir}, ${from}, ${to})` }
      } else {
        style = { background: bg.color || '#f9fafb' }
      }
    }
    // Merge CSS custom-property overrides so the capture page renders
    // independent of the admin's light/dark theme. Cascades through
    // the layout subtree so every `bg-[var(--bg-card)]`,
    // `text-[var(--text-primary)]`, etc. inside resolves to the
    // capture-page-specific palette derived from the card color.
    // When the user hasn't set a card color we default to a white
    // card so the page ALWAYS looks like a light-mode form by
    // default, regardless of the admin's theme.
    const cardColor = pageInfo?.theme?.cardColor || '#ffffff'
    const vars = buildCaptureThemeVars(cardColor)
    // Footer ("Powered by …") sits on the PAGE background, not the card, so
    // its colour must contrast with the page bg: white on dark, near-black on
    // light. For gradients we average the two stops' luminance.
    let pageBgDark = false
    if (bg) {
      if (bg.type === 'gradient') {
        const lum =
          (relativeLuminance(bg.from || '#2B79F7') + relativeLuminance(bg.to || '#143A80')) / 2
        pageBgDark = lum < 0.5
      } else {
        pageBgDark = isColorDark(bg.color || '#f9fafb')
      }
    }
    vars['--capture-footer'] = pageBgDark ? '#ffffff' : '#0f172a'
    style = { ...style, ...(vars as React.CSSProperties) }
    return style
  }, [pageInfo])

  // Card surface style. When the theme has cardColor set we apply
  // that as the card background; otherwise leave it empty so the
  // layout falls back to --bg-card. Dark cards also flip text color
  // to white so labels and headings stay readable.
  const cardStyle = useMemo<React.CSSProperties>(() => {
    const c = pageInfo?.theme?.cardColor
    if (!c) return {}
    const dark = isColorDark(c)
    return {
      background: c,
      color: dark ? '#f8fafc' : '#0f172a',
    }
  }, [pageInfo])

  const fontStyle = useMemo<React.CSSProperties>(() => {
    const f = pageInfo?.theme?.fontFamily || 'system'
    if (f === 'inter')
      return { fontFamily: 'Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif' }
    if (f === 'poppins')
      return { fontFamily: 'Poppins, system-ui, -apple-system, Segoe UI, Roboto, sans-serif' }
    return { fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Poppins, sans-serif' }
  }, [pageInfo])

  const fontClass =
    pageInfo?.theme?.fontFamily === 'poppins'
      ? 'font-poppins'
      : pageInfo?.theme?.fontFamily === 'inter'
        ? 'font-inter'
        : ''

  const setValue = (id: string, val: string) => {
    setValues((prev) => ({ ...prev, [id]: val }))
    // Clear any lingering submit error as soon as the visitor edits a field,
    // so a "Please fill: …" message doesn't stick around after they fix it.
    setError('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!pageInfo) return

    setIsSubmitting(true)
    setError('')
    setSuccess(false)
    setLeadMagnetUrl(null)

    try {
      // Required-field validation lives in CaptureFormBody now (it gates the
      // message behind an actual submit attempt and jumps to the offending
      // section). The form only reaches this handler once those pass, so we
      // don't re-validate fields here - doing so re-introduced a stray
      // "Please fill: …" banner. Only the meeting block is validated below.

      // Meeting date/time are required when the manual picker is
      // visible (i.e. not auto-logged by Calendly). The custom
      // DatePicker / TimePicker don't carry the HTML5 `required`
      // attribute the native inputs did, so we validate here.
      const needsManualMeeting =
        pageInfo.include_meeting && !pageInfo.meeting_auto_logged
      if (needsManualMeeting) {
        if (!meeting_date) {
          setError('Please pick a date for your meeting')
          setIsSubmitting(false)
          return
        }
        if (!meeting_time) {
          setError('Please pick a time for your meeting')
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
          name: values.name || '',
          email: values.email || '',
          phone: values.phone || '',
          notes: values.notes || '',
          // Skip manual date/time when the meeting is auto-logged by
          // the integration webhook - the booking row is already
          // recorded server-side, so we'd duplicate it.
          meeting_date:
            pageInfo.include_meeting && !pageInfo.meeting_auto_logged
              ? meeting_date
              : null,
          meeting_time:
            pageInfo.include_meeting && !pageInfo.meeting_auto_logged
              ? meeting_time
              : null,
          // Lets the submit endpoint flip the matching session row
          // to submitted=true, completing the funnel.
          session_id: sessionId,
        }),
      })

      const data = await res.json()

      if (!data.success) {
        setError(data.error || 'Something went wrong. Please try again.')
      } else {
        setSuccess(true)
        setLeadMagnetUrl(data.lead_magnet_url || null)
        setLeadMagnetType(data.lead_magnet_type || null)
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
            <h1 className="text-xl font-bold text-[var(--text-primary)]">
              This page is no longer available
            </h1>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!pageInfo) return null

  return (
    <CaptureLayout
      pageInfo={pageInfo}
      bgStyle={bgStyle}
      cardStyle={cardStyle}
      fontStyle={fontStyle}
      fontClass={fontClass}
      form={{
        fields,
        values,
        setValue,
        meetingDate: meeting_date,
        setMeetingDate: (v: string) => {
          setMeetingDate(v)
          setError('')
        },
        meetingTime: meeting_time,
        setMeetingTime: (v: string) => {
          setMeetingTime(v)
          setError('')
        },
        success,
        error,
        isSubmitting,
        leadMagnetUrl,
        leadMagnetType,
        onSubmit: handleSubmit,
        onFieldFocus: trackFieldFocus,
      }}
    />
  )
}
