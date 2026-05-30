'use client'

/* eslint-disable @next/next/no-img-element */

// Form body + meeting section + submit + success state for the public
// capture page. Identical behaviour across every layout shell - the
// shells just wrap this differently.
//
// Supports multi-section (multi-step) forms: when the page has sections,
// fields are grouped by section.id and shown one step at a time with
// Next/Back; the last step carries the meeting block + submit. Pages with
// no sections render every field on a single page (legacy behaviour).

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { DatePicker } from '@/components/ui/DatePicker'
import { TimePicker } from '@/components/ui/TimePicker'
import { AvailabilitySlotPicker } from './AvailabilitySlotPicker'
import { CalendlyInlineWidget } from './CalendlyInlineWidget'
import type { CaptureField, CaptureSection, CapturePageInfo, CaptureFormBag } from './types'

// Turn any pasted URL into the best in-page render: a direct image, a
// native video, a provider embed (YouTube / Vimeo / Loom / Drive / etc.),
// or - when the source can't be framed - a plain link. Unknown URLs fall
// back to a bare iframe so "any link" still has a chance of embedding.
function detectEmbed(raw?: string) {
  const url = (raw || '').trim()
  if (!url) return { kind: 'none' as const, src: '' }

  // Direct media by extension, tolerant of trailing ?query / #hash.
  if (/\.(png|jpe?g|gif|webp|avif|svg)(\?|#|$)/i.test(url)) return { kind: 'image' as const, src: url }
  if (/\.(mp4|webm|ogg|mov|m4v)(\?|#|$)/i.test(url)) return { kind: 'video' as const, src: url }

  if (url.includes('drive.google.com')) {
    const m1 = url.match(/\/file\/d\/([^/]+)/)
    if (m1?.[1]) return { kind: 'iframe' as const, src: `https://drive.google.com/file/d/${m1[1]}/preview` }
    const m2 = url.match(/[?&]id=([^&]+)/)
    if (m2?.[1]) return { kind: 'iframe' as const, src: `https://drive.google.com/file/d/${m2[1]}/preview` }
  }
  if (url.includes('youtube.com/watch')) {
    const m = url.match(/[?&]v=([^&]+)/)
    if (m?.[1]) return { kind: 'iframe' as const, src: `https://www.youtube.com/embed/${m[1]}` }
  }
  if (url.includes('youtu.be/')) {
    const m = url.match(/youtu\.be\/([^?]+)/)
    if (m?.[1]) return { kind: 'iframe' as const, src: `https://www.youtube.com/embed/${m[1]}` }
  }
  if (url.includes('youtube.com/shorts/')) {
    const m = url.match(/youtube\.com\/shorts\/([^?/]+)/)
    if (m?.[1]) return { kind: 'iframe' as const, src: `https://www.youtube.com/embed/${m[1]}` }
  }
  if (url.includes('youtube.com/embed/')) {
    return { kind: 'iframe' as const, src: url }
  }
  if (url.includes('vimeo.com/')) {
    const m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/)
    if (m?.[1]) return { kind: 'iframe' as const, src: `https://player.vimeo.com/video/${m[1]}` }
  }
  // Loom: share links become embed links; already-embed links pass through.
  if (url.includes('loom.com/embed/')) {
    return { kind: 'iframe' as const, src: url }
  }
  if (url.includes('loom.com/share/')) {
    const m = url.match(/loom\.com\/share\/([^?/]+)/)
    if (m?.[1]) return { kind: 'iframe' as const, src: `https://www.loom.com/embed/${m[1]}` }
  }
  // Providers that block being framed elsewhere - show a link instead.
  if (url.includes('tiktok.com') || url.includes('instagram.com')) {
    return { kind: 'link' as const, src: url }
  }
  // Anything else: try to iframe it.
  return { kind: 'iframe' as const, src: url }
}

interface Props extends CaptureFormBag {
  pageInfo: CapturePageInfo
}

export function CaptureFormBody({
  pageInfo,
  fields,
  values,
  setValue,
  meetingDate,
  setMeetingDate,
  meetingTime,
  setMeetingTime,
  success,
  error,
  isSubmitting,
  leadMagnetUrl,
  onSubmit,
  onFieldFocus,
  preview,
}: Props) {
  // Tiny helper - shadows undefined so we never pass it as a real
  // onFocus listener (would still create an event listener for nothing).
  const focusHandler = (id: string) =>
    onFieldFocus ? () => onFieldFocus(id) : undefined

  const accent =
    (pageInfo.accent_color && pageInfo.accent_color.trim()) || '#2B79F7'
  const successMessage =
    (pageInfo.success_message && pageInfo.success_message.trim()) ||
    "You're in! Let's Keep Going."

  // --- Build steps from sections -----------------------------------------
  const sections = pageInfo.sections ?? []
  const steps: { section: CaptureSection | null; fields: CaptureField[] }[] =
    sections.length === 0
      ? [{ section: null, fields }]
      : (() => {
          const known = new Set(sections.map((s) => s.id))
          const grouped = sections.map((s) => ({
            section: s,
            fields: fields.filter((f) => f.sectionId === s.id),
          }))
          // Fields with no / unknown section fall into the first step.
          const orphans = fields.filter((f) => !f.sectionId || !known.has(f.sectionId))
          if (orphans.length && grouped.length) {
            grouped[0] = { section: grouped[0].section, fields: [...orphans, ...grouped[0].fields] }
          }
          return grouped
        })()

  const [step, setStep] = useState(0)
  // True only after the visitor tries to advance/submit with a required
  // field still empty. The "Please fill" message is DERIVED from this plus a
  // live check (missingLabel below), so it never shows on load and clears the
  // instant the field is filled.
  const [triedSubmit, setTriedSubmit] = useState(false)
  const current = steps[Math.min(step, steps.length - 1)]
  const isLast = step >= steps.length - 1
  const isMultiStep = steps.length > 1

  // Required-field check for the fields on a given step.
  const firstMissing = (stepFields: CaptureField[]): string | null => {
    for (const f of stepFields) {
      if (f.type === 'embed') continue
      if (!f.required) continue
      const v = values[f.id]
      if (v === undefined || v === null || String(v).trim() === '') return f.label
    }
    return null
  }

  // Only after an attempt, and only while a field on the current step is
  // actually still empty. Recomputed every render, so filling the field hides
  // it automatically.
  const missingLabel = triedSubmit ? firstMissing(current.fields) : null

  const goNext = () => {
    // In the editor preview we let the builder click through every section
    // regardless of required fields.
    if (!preview && firstMissing(current.fields)) {
      setTriedSubmit(true)
      return
    }
    setTriedSubmit(false)
    setStep((s) => Math.min(s + 1, steps.length - 1))
  }

  const goBack = () => {
    setTriedSubmit(false)
    setStep((s) => Math.max(s - 1, 0))
  }

  const handleSetValue = (id: string, val: string) => {
    setValue(id, val)
    if (triedSubmit) setTriedSubmit(false)
  }

  if (success) {
    const buttonText =
      (pageInfo.success_button_text && pageInfo.success_button_text.trim()) ||
      'Access Your Free Resource'
    return (
      <div className="space-y-4">
        <p className="text-green-700 bg-green-50 border border-green-200 px-4 py-3 rounded-lg text-sm">
          {successMessage}
        </p>
        {leadMagnetUrl && (
          <a
            href={leadMagnetUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ backgroundColor: accent }}
            className="inline-flex items-center justify-center px-4 py-2.5 text-white rounded-lg text-sm font-medium hover:opacity-90 w-full transition-opacity"
          >
            {buttonText}
          </a>
        )}
      </div>
    )
  }

  // --- Single field renderer (reused on every step) ----------------------
  const renderField = (f: CaptureField) => {
    if (f.type === 'embed') {
      const embed = detectEmbed(f.embedUrl)
      if (embed.kind === 'image') {
        return (
          <div key={f.id} className="rounded-lg border border-[var(--border-primary)] overflow-hidden">
            <img src={embed.src} alt={f.label} className="w-full h-auto object-contain" />
          </div>
        )
      }
      if (embed.kind === 'video') {
        return (
          <div key={f.id} className="rounded-lg border border-[var(--border-primary)] overflow-hidden bg-black">
            <video src={embed.src} controls className="w-full h-auto" />
          </div>
        )
      }
      if (embed.kind === 'link') {
        return (
          <div key={f.id} className="rounded-lg border border-[var(--border-primary)] p-4 bg-[var(--bg-tertiary)]">
            <p className="text-sm text-[var(--text-secondary)] font-medium">{f.label || 'Embed'}</p>
            <p className="text-xs text-[var(--text-tertiary)] mt-1">
              This provider may block embedding on external sites. Open it here:
            </p>
            <a
              href={embed.src}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-[#2B79F7] hover:underline break-all"
            >
              {embed.src}
            </a>
          </div>
        )
      }
      return (
        <div key={f.id} className="rounded-lg border border-[var(--border-primary)] overflow-hidden">
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
          <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
            {f.label}
            {f.required ? ' *' : ''}
          </label>
          <textarea
            value={values[f.id] || ''}
            onChange={(e) => handleSetValue(f.id, e.target.value)}
            onFocus={focusHandler(f.id)}
            rows={3}
            className="w-full max-w-full px-4 py-2.5 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7] resize-none text-sm"
            placeholder={f.placeholder || ''}
          />
          {f.description && <p className="text-xs text-[var(--text-tertiary)] mt-1">{f.description}</p>}
        </div>
      )
    }

    if (f.type === 'select') {
      return (
        <div key={f.id} className="min-w-0">
          <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
            {f.label}
            {f.required ? ' *' : ''}
          </label>
          <select
            value={values[f.id] || ''}
            onChange={(e) => handleSetValue(f.id, e.target.value)}
            onFocus={focusHandler(f.id)}
            className="w-full max-w-full px-4 py-2.5 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
          >
            <option value="">Select…</option>
            {(f.options || []).map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
          {f.description && <p className="text-xs text-[var(--text-tertiary)] mt-1">{f.description}</p>}
        </div>
      )
    }

    if (f.type === 'radio') {
      return (
        <div key={f.id} className="min-w-0">
          <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
            {f.label}
            {f.required ? ' *' : ''}
          </label>
          <div className="space-y-2">
            {(f.options || []).map((opt) => (
              <label key={opt} className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                <input
                  type="radio"
                  name={f.id}
                  checked={(values[f.id] || '') === opt}
                  onChange={() => handleSetValue(f.id, opt)}
                  onFocus={focusHandler(f.id)}
                />
                <span>{opt}</span>
              </label>
            ))}
          </div>
          {f.description && <p className="text-xs text-[var(--text-tertiary)] mt-1">{f.description}</p>}
        </div>
      )
    }

    return (
      <div key={f.id} className="min-w-0">
        <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
          {f.label}
          {f.required ? ' *' : ''}
        </label>
        <input
          type={f.type === 'phone' ? 'tel' : f.type}
          value={values[f.id] || ''}
          onChange={(e) => handleSetValue(f.id, e.target.value)}
          onFocus={focusHandler(f.id)}
          placeholder={f.placeholder || ''}
          className="w-full max-w-full px-4 py-2.5 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
        />
        {f.description && <p className="text-xs text-[var(--text-tertiary)] mt-1">{f.description}</p>}
      </div>
    )
  }

  // --- Meeting block (only on the last step) -----------------------------
  const renderMeeting = () => {
    if (!pageInfo.include_meeting) return null
    const isCalendlyIntegration = pageInfo.meeting_integration === 'calendly'
    const isGoogleMeet = pageInfo.meeting_integration === 'google_meet'
    const isZoom = pageInfo.meeting_integration === 'zoom'
    const isLegacyCalendlyUrl = !pageInfo.meeting_integration && !!pageInfo.calendly_url

    let dateTimeIntro: string
    let dateLabel: string
    let timeLabel: string
    if (isGoogleMeet) {
      dateTimeIntro = "Pick a date and time below. We'll send you a Google Meet invite via email."
      dateLabel = 'Pick a date'
      timeLabel = 'Pick a time'
    } else if (isZoom) {
      dateTimeIntro = "Pick a date and time below. We'll send you a Zoom link via email."
      dateLabel = 'Pick a date'
      timeLabel = 'Pick a time'
    } else if (isLegacyCalendlyUrl) {
      dateTimeIntro = 'After you book, please confirm the date and time you scheduled'
      dateLabel = 'Date you scheduled'
      timeLabel = 'Time you scheduled'
    } else {
      dateTimeIntro = 'Preferred meeting time'
      dateLabel = 'Preferred date'
      timeLabel = 'Preferred time'
    }

    return (
      <div className="space-y-4 border-t border-[var(--border-primary)] pt-4 mt-2">
        {isCalendlyIntegration && pageInfo.calendly_url && pageInfo.slug ? (
          <CalendlyInlineWidget
            url={pageInfo.calendly_url}
            slug={pageInfo.slug}
            prefill={{
              name: values['name'] || undefined,
              email: values['email'] || undefined,
            }}
          />
        ) : isLegacyCalendlyUrl ? (
          <div className="rounded-lg border border-[var(--border-primary)] overflow-hidden">
            <iframe
              src={pageInfo.calendly_url || ''}
              className="w-full border-0"
              style={{ height: 600 }}
              loading="lazy"
              title="Schedule a meeting"
            />
          </div>
        ) : null}

        {!pageInfo.meeting_auto_logged && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-[var(--text-primary)]">{dateTimeIntro}</p>
            {isGoogleMeet || isZoom ? (
              <div className="space-y-3 w-full max-w-full">
                <div className="min-w-0">
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
                    {dateLabel} *
                  </label>
                  <DatePicker
                    value={meetingDate}
                    onChange={(d) => {
                      setMeetingDate(d)
                      setMeetingTime('')
                    }}
                    placeholder="Pick a date"
                    disablePast
                  />
                </div>
                {pageInfo.slug && (
                  <div className="min-w-0">
                    <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
                      Available times *
                    </label>
                    <AvailabilitySlotPicker
                      slug={pageInfo.slug}
                      date={meetingDate}
                      value={meetingTime}
                      onChange={setMeetingTime}
                    />
                  </div>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-full">
                <div className="min-w-0">
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
                    {dateLabel} *
                  </label>
                  <DatePicker value={meetingDate} onChange={setMeetingDate} placeholder="Pick a date" disablePast />
                </div>
                <div className="min-w-0">
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
                    {timeLabel} *
                  </label>
                  <TimePicker value={meetingTime} onChange={setMeetingTime} placeholder="Pick a time" />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <form
      onSubmit={(e) => {
        // In a multi-step form, only the last step submits. Guard against
        // Enter-key submits on earlier steps.
        if (!isLast) {
          e.preventDefault()
          return
        }
        // Validate every section's required fields. If one's missing, jump
        // to its section and show the error THERE - so the visitor sees the
        // exact field instead of a message on a step they can't act on.
        if (!preview) {
          for (let i = 0; i < steps.length; i++) {
            if (firstMissing(steps[i].fields)) {
              e.preventDefault()
              setStep(i)
              setTriedSubmit(true)
              return
            }
          }
        }
        setTriedSubmit(false)
        onSubmit(e)
      }}
      className="space-y-4"
    >
      {current.section && (current.section.title || current.section.description) && (
        <div>
          {current.section.title && (
            <h3 className="text-base font-semibold text-[var(--text-primary)]">{current.section.title}</h3>
          )}
          {current.section.description && (
            <p className="text-sm text-[var(--text-tertiary)] mt-0.5">{current.section.description}</p>
          )}
        </div>
      )}

      {current.fields.map((f) => renderField(f))}

      {isLast && renderMeeting()}

      {missingLabel && <p className="text-sm text-red-500">Please fill: {missingLabel}</p>}
      {isLast && error && <p className="text-sm text-red-500">{error}</p>}

      <div className="flex items-center gap-3">
        {isMultiStep && step > 0 && (
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={goBack}
            className="shrink-0"
            data-preview-nav
          >
            Back
          </Button>
        )}
        {isLast ? (
          <Button
            type="submit"
            className="w-full"
            size="lg"
            isLoading={isSubmitting}
            style={{ backgroundColor: accent }}
          >
            Submit
          </Button>
        ) : (
          <Button
            type="button"
            className="w-full"
            size="lg"
            onClick={goNext}
            style={{ backgroundColor: accent }}
            data-preview-nav
          >
            Next
          </Button>
        )}
      </div>

      {/* Section progress - centered at the bottom of the card. */}
      {isMultiStep && (
        <div className="flex flex-col items-center gap-1.5 pt-1">
          <div className="flex gap-1">
            {steps.map((_, i) => (
              <span
                key={i}
                className="h-1.5 w-6 rounded-full transition-colors"
                style={{
                  backgroundColor: i <= step ? accent : 'var(--border-primary)',
                  opacity: i <= step ? 1 : 0.4,
                }}
              />
            ))}
          </div>
          <span className="text-xs text-[var(--text-tertiary)]">
            Section {step + 1} of {steps.length}
          </span>
        </div>
      )}
    </form>
  )
}
