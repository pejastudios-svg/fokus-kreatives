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
import { Plus, X, Check } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Confetti } from '@/components/ui/Confetti'
import { DatePicker } from '@/components/ui/DatePicker'
import { TimePicker } from '@/components/ui/TimePicker'
import { AvailabilitySlotPicker } from './AvailabilitySlotPicker'
import { CalendlyInlineWidget } from './CalendlyInlineWidget'
import type { CaptureField, CaptureSection, CapturePageInfo, CaptureFormBag } from './types'

// Field types that can carry multiple visitor entries when `repeatable`.
const REPEATABLE_TYPES = new Set(['text', 'email', 'phone', 'url'])
// Hard cap on entries a visitor can add to one repeatable field.
const MAX_REPEAT_ENTRIES = 5

// Turn any pasted URL into the best in-page render: a direct image, a
// native video, a provider embed (YouTube / Vimeo / Loom / Drive / etc.),
// or - when the source can't be framed - a plain link. Unknown URLs fall
// back to a bare iframe so "any link" still has a chance of embedding.
export function detectEmbed(raw?: string) {
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
  leadMagnetType,
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
  // The live Calendly inline widget reports a real booking via postMessage.
  // When a form embeds it, a lead must book before they can submit - we hold
  // that "they booked" state here and gate the Submit button on it.
  const [calendlyBooked, setCalendlyBooked] = useState(false)
  // Set when the visitor tries to submit without having booked, so the prompt
  // reads as an error rather than a passive hint.
  const [bookingPrompt, setBookingPrompt] = useState(false)
  // True only after the visitor tries to advance/submit with a required
  // field still empty. The "Please fill" message is DERIVED from this plus a
  // live check (missingLabel below), so it never shows on load and clears the
  // instant the field is filled.
  const [triedSubmit, setTriedSubmit] = useState(false)
  // Per-field entry lists for repeatable fields. Derived from the stored
  // (newline-joined) value on first touch, then owned locally so empty rows
  // can exist while typing without being stripped from the saved value.
  const [repeatLists, setRepeatLists] = useState<Record<string, string[]>>({})
  // Brief celebratory burst when a package card is selected.
  const [showConfetti, setShowConfetti] = useState(false)
  const current = steps[Math.min(step, steps.length - 1)]
  const isLast = step >= steps.length - 1
  const isMultiStep = steps.length > 1

  // The Calendly gate only applies on the live page (slug present, not the
  // builder preview) where the inline widget can actually report a booking.
  // Legacy bare-iframe Calendly emits no booking signal, so it can't be gated.
  const requireCalendlyBooking =
    !preview &&
    pageInfo.include_meeting &&
    pageInfo.meeting_integration === 'calendly' &&
    !!pageInfo.calendly_url &&
    !!pageInfo.slug
  const bookingMissing = requireCalendlyBooking && !calendlyBooked

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

  // Repeatable-field helpers. The visible list keeps empty rows; the saved
  // value is the trimmed, non-empty entries joined by newlines.
  const getList = (id: string): string[] => {
    if (repeatLists[id]) return repeatLists[id]
    const v = values[id]
    const arr = v ? v.split('\n') : ['']
    return arr.length ? arr : ['']
  }
  const commitList = (id: string, list: string[]) => {
    setRepeatLists((m) => ({ ...m, [id]: list }))
    setValue(id, list.map((s) => s.trim()).filter(Boolean).join('\n'))
    if (triedSubmit) setTriedSubmit(false)
  }

  const selectPackage = (id: string, name: string) => {
    handleSetValue(id, name)
    setShowConfetti(false)
    // Next tick so re-selecting another card re-triggers the mount animation.
    window.requestAnimationFrame(() => setShowConfetti(true))
    window.setTimeout(() => setShowConfetti(false), 2200)
  }

  if (success) {
    const buttonText =
      (pageInfo.success_button_text && pageInfo.success_button_text.trim()) ||
      'Access Your Free Resource'
    const isFileMagnet = leadMagnetType === 'file'
    const btnClass =
      'inline-flex items-center justify-center px-4 py-2.5 text-white rounded-lg text-sm font-medium hover:opacity-90 w-full transition-opacity'
    const btnStyle = { backgroundColor: accent, backgroundImage: 'none' }

    // Uploaded files: open the file in a new tab (so they can read it) AND
    // push a download to their device. Supabase storage honours ?download for
    // the Content-Disposition: attachment header. External links just open.
    const openFileMagnet = () => {
      if (!leadMagnetUrl) return
      window.open(leadMagnetUrl, '_blank', 'noopener,noreferrer')
      const dlUrl = leadMagnetUrl + (leadMagnetUrl.includes('?') ? '&' : '?') + 'download'
      const a = document.createElement('a')
      a.href = dlUrl
      a.rel = 'noopener'
      document.body.appendChild(a)
      a.click()
      a.remove()
    }

    return (
      <div className="space-y-4">
        <p className="text-green-700 bg-green-50 border border-green-200 px-4 py-3 rounded-lg text-sm text-center">
          {successMessage}
        </p>
        {leadMagnetUrl &&
          (isFileMagnet ? (
            <button type="button" onClick={openFileMagnet} style={btnStyle} className={btnClass}>
              {buttonText}
            </button>
          ) : (
            <a
              href={leadMagnetUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={btnStyle}
              className={btnClass}
            >
              {buttonText}
            </a>
          ))}
      </div>
    )
  }

  // --- Single field renderer (reused on every step) ----------------------
  const renderField = (f: CaptureField) => {
    if (f.type === 'embed') {
      const embed = detectEmbed(f.embedUrl)
      let media: React.ReactNode
      if (embed.kind === 'image') {
        media = (
          <div className="rounded-lg border border-[var(--border-primary)] overflow-hidden">
            <img src={embed.src} alt={f.label} className="w-full h-auto object-contain" />
          </div>
        )
      } else if (embed.kind === 'video') {
        media = (
          <div className="rounded-lg border border-[var(--border-primary)] overflow-hidden bg-black">
            <video src={embed.src} controls className="w-full h-auto" />
          </div>
        )
      } else if (embed.kind === 'link') {
        media = (
          <div className="rounded-lg border border-[var(--border-primary)] p-4 bg-[var(--bg-tertiary)]">
            <p className="text-xs text-[var(--text-tertiary)]">
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
      } else {
        media = (
          <div className="rounded-lg border border-[var(--border-primary)] overflow-hidden">
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
      // Title (label) above, helper text (description) below - both were
      // settable in the builder but never rendered for embeds before.
      return (
        <div key={f.id} className="space-y-1.5 min-w-0">
          {f.label && (
            <p className="text-sm font-medium text-[var(--text-secondary)]">{f.label}</p>
          )}
          {media}
          {f.description && (
            <p className="text-xs text-[var(--text-tertiary)]">{f.description}</p>
          )}
        </div>
      )
    }

    // Repeatable text-like field: multiple entries, one per line.
    if (REPEATABLE_TYPES.has(f.type) && f.repeatable) {
      const list = getList(f.id)
      const inputType = f.type === 'phone' ? 'tel' : f.type
      return (
        <div key={f.id} className="min-w-0">
          <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
            {f.label}
            {f.required ? ' *' : ''}
          </label>
          <div className="space-y-2">
            {list.map((val, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type={inputType}
                  value={val}
                  onChange={(e) => {
                    const next = [...list]
                    next[i] = e.target.value
                    commitList(f.id, next)
                  }}
                  onFocus={focusHandler(f.id)}
                  placeholder={f.placeholder || ''}
                  className="flex-1 min-w-0 px-4 py-2.5 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                />
                {list.length > 1 && (
                  <button
                    type="button"
                    onClick={() => commitList(f.id, list.filter((_, j) => j !== i))}
                    className="p-2 rounded-md text-[var(--text-tertiary)] hover:text-red-500 shrink-0"
                    aria-label="Remove entry"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
          {list.length < MAX_REPEAT_ENTRIES && (
            <button
              type="button"
              onClick={() => commitList(f.id, [...list, ''])}
              className="mt-2 inline-flex items-center gap-1 text-sm font-medium hover:opacity-80"
              style={{ color: accent }}
            >
              <Plus className="h-4 w-4" /> Add another
            </button>
          )}
          {f.description && <p className="text-xs text-[var(--text-tertiary)] mt-1">{f.description}</p>}
        </div>
      )
    }

    // Package picker: selectable plan cards. Single-select; selecting shows a
    // check + a confetti pop and stays put (no auto-advance).
    if (f.type === 'package') {
      const selected = values[f.id] || ''
      const pkgs = f.packages || []
      return (
        <div key={f.id} className="min-w-0">
          {(f.label || f.description) && (
            <div className="mb-2">
              {f.label && (
                <label className="block text-sm font-medium text-[var(--text-secondary)]">
                  {f.label}
                  {f.required ? ' *' : ''}
                </label>
              )}
              {f.description && (
                <p className="text-xs text-[var(--text-tertiary)] mt-0.5">{f.description}</p>
              )}
            </div>
          )}
          <div className="flex flex-col gap-3">
            {pkgs.map((p) => {
              const isSel = selected === p.name
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => selectPackage(f.id, p.name)}
                  className="relative w-full text-left rounded-xl border-2 p-4 transition-all hover:shadow-md flex flex-col"
                  style={{
                    borderColor: isSel ? accent : 'var(--border-primary)',
                    backgroundColor: isSel ? `${accent}14` : 'var(--bg-input)',
                  }}
                >
                  {isSel && (
                    <span
                      className="absolute top-3 right-3 h-6 w-6 rounded-full flex items-center justify-center text-white"
                      style={{ backgroundColor: accent, backgroundImage: 'none' }}
                    >
                      <Check className="h-4 w-4" />
                    </span>
                  )}
                  <p className="text-base font-bold text-[var(--text-primary)] pr-7">{p.name}</p>
                  {p.subtitle && (
                    <p className="text-xs text-[var(--text-tertiary)]">{p.subtitle}</p>
                  )}
                  {p.price && (
                    <p className="mt-2 text-2xl font-extrabold text-[var(--text-primary)]">{p.price}</p>
                  )}
                  {(() => {
                    const feats = (p.features || []).filter((ft) => ft.trim() !== '')
                    if (feats.length === 0) return null
                    return (
                      <ul className="mt-3 space-y-1.5 flex-1">
                        {feats.map((ft, i) => (
                          <li
                            key={i}
                            className="flex items-start gap-2 text-sm text-[var(--text-secondary)]"
                          >
                            <Check className="h-4 w-4 mt-0.5 shrink-0" style={{ color: accent }} />
                            <span>{ft}</span>
                          </li>
                        ))}
                      </ul>
                    )
                  })()}
                  <span
                    className="mt-4 inline-flex items-center justify-center w-full rounded-full px-4 py-2 text-sm font-semibold"
                    style={
                      isSel
                        ? { backgroundColor: accent, color: '#fff' }
                        : { border: `1px solid ${accent}`, color: accent }
                    }
                  >
                    {isSel ? 'Selected' : 'Select'}
                  </span>
                </button>
              )
            })}
          </div>
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
            {(f.options || [])
              .filter((o) => o.trim() !== '')
              .map((opt) => (
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
            {(f.options || []).filter((o) => o.trim() !== '').map((opt) => (
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
            onBooked={() => {
              setCalendlyBooked(true)
              setBookingPrompt(false)
            }}
          />
        ) : isCalendlyIntegration && pageInfo.calendly_url ? (
          // No slug = the builder preview. Show a plain embed so Calendly is
          // visible while editing, without the booking-callback wiring (which
          // only matters on the live, slugged page).
          <div className="rounded-lg border border-[var(--border-primary)] overflow-hidden">
            <iframe
              src={pageInfo.calendly_url}
              className="w-full border-0"
              style={{ height: 600 }}
              loading="lazy"
              title="Schedule a meeting"
            />
          </div>
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
        // Calendly forms can't be submitted until the lead actually books.
        // Guard here too so an Enter-key submit can't bypass the disabled
        // button.
        if (bookingMissing) {
          e.preventDefault()
          setStep(steps.length - 1)
          setBookingPrompt(true)
          return
        }
        setTriedSubmit(false)
        onSubmit(e)
      }}
      className="space-y-4"
    >
      {showConfetti && <Confetti />}

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

      {/* Calendly booking gate: prompt while unbooked, confirm once booked. */}
      {isLast && bookingMissing && (
        <p className={`text-sm ${bookingPrompt ? 'text-red-500' : 'text-[var(--text-tertiary)]'}`}>
          Please pick a time above to book your call before submitting.
        </p>
      )}
      {isLast && requireCalendlyBooking && calendlyBooked && (
        <p className="flex items-center gap-1.5 text-sm text-green-600">
          <Check className="h-4 w-4" /> Your call is booked. You can submit now.
        </p>
      )}

      <div className="flex items-center gap-3">
        {isMultiStep && step > 0 && (
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={goBack}
            className="shrink-0"
            style={{ borderColor: accent, color: accent }}
            data-preview-nav
          >
            Back
          </Button>
        )}
        {isLast ? (
          // Distinct keys on Next vs Submit are load-bearing: without them
          // React reuses the same <button> DOM node and just flips type
          // "button" -> "submit". Because React flushes synchronously inside the
          // click event, the button you clicked for "Next" becomes a submit
          // button mid-click and the browser submits the form on that same tap.
          // Separate keys mount a fresh Submit node the click never touched.
          <Button
            key="nav-submit"
            type="submit"
            className="w-full"
            size="lg"
            isLoading={isSubmitting}
            disabled={bookingMissing}
            style={{ backgroundColor: accent, backgroundImage: 'none' }}
          >
            Submit
          </Button>
        ) : (
          <Button
            key="nav-next"
            type="button"
            className="w-full"
            size="lg"
            onClick={goNext}
            style={{ backgroundColor: accent, backgroundImage: 'none' }}
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
