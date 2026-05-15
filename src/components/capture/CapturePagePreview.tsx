'use client'

// Live preview of the capture page. Builds a CapturePageInfo from the
// builder form state and renders the same CaptureLayout the public
// page uses, so the editor shows EXACTLY what visitors will see when
// the page is published.
//
// Scaled down via CSS transform so the desktop-sized layout fits
// inside the modal's right pane (Tally pattern).

import { CaptureLayout } from './layouts'
import { isColorDark, buildCaptureThemeVars } from './colorUtils'
import type {
  CaptureField,
  CapturePageInfo,
  CaptureFormBag,
  CaptureTheme,
  LayoutTemplate,
} from './types'

interface FormShape {
  name: string
  slug: string
  headline: string
  description: string
  lead_magnet_url: string
  logo_url: string
  banner_url: string
  is_active: boolean
  include_meeting: boolean
  calendly_url: string
  success_button_text?: string
  success_message?: string
  accent_color?: string
  fields: CaptureField[]
  theme: CaptureTheme
  layout_template: LayoutTemplate
}

interface Props {
  form: FormShape
}

export function CapturePagePreview({ form }: Props) {
  const pageInfo: CapturePageInfo = {
    name: form.name,
    headline: form.headline || 'Get your free resource',
    description: form.description || null,
    logo_url: form.logo_url || null,
    banner_url: form.banner_url || null,
    include_meeting: form.include_meeting,
    calendly_url: form.calendly_url || null,
    lead_magnet_url: form.lead_magnet_url || null,
    success_button_text: form.success_button_text || null,
    success_message: form.success_message || null,
    accent_color: form.accent_color || null,
    fields: form.fields,
    theme: form.theme,
    layout_template: form.layout_template,
  }

  // No-op form bag for the preview - submission is disabled, fields
  // render with empty values, success state never triggers. The
  // visitor experience renders visually; nothing reaches the server.
  const formBag: CaptureFormBag = {
    fields: form.fields,
    values: {},
    setValue: () => {},
    meetingDate: '',
    setMeetingDate: () => {},
    meetingTime: '',
    setMeetingTime: () => {},
    success: false,
    error: '',
    isSubmitting: false,
    leadMagnetUrl: null,
    onSubmit: (e) => e.preventDefault(),
  }

  const bgStyle: React.CSSProperties = (() => {
    const bg = form.theme?.background
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
    // Default to a white card so the preview always renders as a
    // light-mode form by default, decoupled from the admin theme.
    const cardColor = form.theme?.cardColor || '#ffffff'
    style = { ...style, ...(buildCaptureThemeVars(cardColor) as React.CSSProperties) }
    return style
  })()

  const cardStyle: React.CSSProperties = (() => {
    const c = form.theme?.cardColor
    if (!c) return {}
    const dark = isColorDark(c)
    return { background: c, color: dark ? '#f8fafc' : '#0f172a' }
  })()

  // Scale the preview down using CSS `zoom` (not `transform: scale`).
  // The reason: `zoom` actually affects layout flow - a min-h-screen
  // child rendered with zoom 0.55 occupies 55vh of DOM box, so the
  // parent scroll container's scrollHeight matches what the user sees.
  // `transform: scale` only changes visual size while the DOM box
  // stays full-size, which meant the parent thought the content was
  // 80%+ taller than it actually appeared - that was the source of
  // the "I can scroll past the preview into empty space" bug.
  //
  // Browser support: zoom is standard CSS (Chrome/Safari forever,
  // Firefox 126+). All evergreen browsers support it.
  const SCALE = 0.55

  return (
    <div
      style={{
        zoom: SCALE,
        ...bgStyle,
      }}
      // Disable all interactivity inside the preview - it's purely
      // visual. Clicks shouldn't navigate, scroll-anchor, or focus
      // fields in the iframe-style sandbox.
      onClickCapture={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      onSubmitCapture={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      <CaptureLayout
        pageInfo={pageInfo}
        bgStyle={bgStyle}
        cardStyle={cardStyle}
        fontStyle={{}}
        fontClass=""
        form={formBag}
      />
    </div>
  )
}
