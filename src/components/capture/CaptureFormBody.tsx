'use client'

/* eslint-disable @next/next/no-img-element */

// Form body + meeting section + submit + success state for the public
// capture page. Identical behaviour across every layout shell - the
// shells just wrap this differently.

import { Button } from '@/components/ui/Button'
import { DatePicker } from '@/components/ui/DatePicker'
import { TimePicker } from '@/components/ui/TimePicker'
import { AvailabilitySlotPicker } from './AvailabilitySlotPicker'
import { CalendlyInlineWidget } from './CalendlyInlineWidget'
import type { CaptureField, CapturePageInfo, CaptureFormBag } from './types'

function detectEmbed(raw?: string) {
  const url = (raw || '').trim()
  if (!url) return { kind: 'none' as const, src: '' }

  if (/\.(png|jpe?g|gif|webp)$/i.test(url)) return { kind: 'image' as const, src: url }
  if (/\.(mp4|webm|ogg)$/i.test(url)) return { kind: 'video' as const, src: url }

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
    const m = url.match(/youtube\.com\/shorts\/([^?\/]+)/)
    if (m?.[1]) return { kind: 'iframe' as const, src: `https://www.youtube.com/embed/${m[1]}` }
  }
  if (url.includes('vimeo.com/')) {
    const m = url.match(/vimeo\.com\/(\d+)/)
    if (m?.[1]) return { kind: 'iframe' as const, src: `https://player.vimeo.com/video/${m[1]}` }
  }
  if (url.includes('loom.com/share/')) {
    const m = url.match(/loom\.com\/share\/([^?]+)/)
    if (m?.[1]) return { kind: 'iframe' as const, src: `https://www.loom.com/embed/${m[1]}` }
  }
  if (url.includes('tiktok.com') || url.includes('instagram.com')) {
    return { kind: 'link' as const, src: url }
  }
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
}: Props) {
  // Tiny helper - shadows undefined so we never pass it as a real
  // onFocus listener (would still create an event listener for nothing).
  const focusHandler = (id: string) =>
    onFieldFocus ? () => onFieldFocus(id) : undefined
  // Resolve customizations. `accent` and `successMessage` fall back
  // to the legacy defaults when null/empty so untouched pages keep
  // rendering exactly as before.
  const accent =
    (pageInfo.accent_color && pageInfo.accent_color.trim()) || '#2B79F7'
  const successMessage =
    (pageInfo.success_message && pageInfo.success_message.trim()) ||
    "You're in! Let's Keep Going."

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

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {fields.map((f: CaptureField) => {
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
                onChange={(e) => setValue(f.id, e.target.value)}
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
                onChange={(e) => setValue(f.id, e.target.value)}
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
                      onChange={() => setValue(f.id, opt)}
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
              onChange={(e) => setValue(f.id, e.target.value)}
              onFocus={focusHandler(f.id)}
              placeholder={f.placeholder || ''}
              className="w-full max-w-full px-4 py-2.5 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
            />
            {f.description && <p className="text-xs text-[var(--text-tertiary)] mt-1">{f.description}</p>}
          </div>
        )
      })}

      {pageInfo.include_meeting && (() => {
        // Three rendering paths, picked by integration:
        //   calendly  → embed Calendly (widget or legacy iframe), hide
        //               manual date/time (booking + time are captured
        //               by Calendly itself).
        //   google_meet → no embed; show date/time picker labelled
        //               "Pick a date / time" since the visitor is the
        //               one choosing - we then create the Meet event
        //               from those values.
        //   none        → legacy bare iframe if calendly_url is set,
        //               otherwise plain manual picker.
        const isCalendlyIntegration = pageInfo.meeting_integration === 'calendly'
        const isGoogleMeet = pageInfo.meeting_integration === 'google_meet'
        const isZoom = pageInfo.meeting_integration === 'zoom'
        const isLegacyCalendlyUrl =
          !pageInfo.meeting_integration && !!pageInfo.calendly_url

        let dateTimeIntro: string
        let dateLabel: string
        let timeLabel: string
        if (isGoogleMeet) {
          dateTimeIntro =
            "Pick a date and time below. We'll send you a Google Meet invite via email."
          dateLabel = 'Pick a date'
          timeLabel = 'Pick a time'
        } else if (isZoom) {
          dateTimeIntro =
            "Pick a date and time below. We'll send you a Zoom link via email."
          dateLabel = 'Pick a date'
          timeLabel = 'Pick a time'
        } else if (isLegacyCalendlyUrl) {
          dateTimeIntro =
            'After you book, please confirm the date and time you scheduled'
          dateLabel = 'Date you scheduled'
          timeLabel = 'Time you scheduled'
        } else {
          dateTimeIntro = 'Preferred meeting time'
          dateLabel = 'Preferred date'
          timeLabel = 'Preferred time'
        }

        return (
          <div className="space-y-4 border-t border-[var(--border-primary)] pt-4 mt-2">
            {/* Calendly: official inline-embed widget (with auto-log
                callback) when wired to the integration. Legacy iframe
                only when no integration is set. */}
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

            {/* Manual date/time picker. Hidden only when the booking
                is auto-logged elsewhere (Calendly embed). Always
                visible for Google Meet because that's where the
                visitor picks their slot. */}
            {!pageInfo.meeting_auto_logged && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-[var(--text-primary)]">
                  {dateTimeIntro}
                </p>
                {/* Integration-wired pages (Google Meet, Zoom) need
                    real availability checking - we create the meeting
                    on the host's calendar, so showing already-booked
                    slots would let visitors double-book the host.
                    The slot picker fetches /api/capture/availability
                    and hides any slot that conflicts with an existing
                    meeting. Other paths (manual, legacy Calendly URL)
                    keep the plain time picker. */}
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
                          // Clear time when date changes - the
                          // available slots for the new date are
                          // different.
                          setMeetingTime('')
                        }}
                        placeholder="Pick a date"
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
                      <DatePicker
                        value={meetingDate}
                        onChange={setMeetingDate}
                        placeholder="Pick a date"
                      />
                    </div>
                    <div className="min-w-0">
                      <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
                        {timeLabel} *
                      </label>
                      <TimePicker
                        value={meetingTime}
                        onChange={setMeetingTime}
                        placeholder="Pick a time"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })()}

      {error && <p className="text-sm text-red-500">{error}</p>}

      {/* Inline accent overrides Button's default bg. The element's
          existing focus / loading styling stays intact. */}
      <Button
        type="submit"
        className="w-full"
        size="lg"
        isLoading={isSubmitting}
        style={{ backgroundColor: accent }}
      >
        Submit
      </Button>
    </form>
  )
}
