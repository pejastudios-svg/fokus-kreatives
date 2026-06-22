// Shared types for the public capture page + its layout shells.
// The public page hydrates a CapturePageInfo and renders one of N
// layouts based on `layout_template`. Every layout reuses the same
// fields + meeting + success surface so behaviour stays uniform.

export type FieldType =
  | 'text'
  | 'email'
  | 'phone'
  | 'url'
  | 'textarea'
  | 'select'
  | 'radio'
  | 'date'
  | 'time'
  | 'embed'
  | 'package'

/** One selectable plan in a `package` field. The visitor picks one; the
 *  chosen package's name is saved as the field's value. */
export interface PackageOption {
  id: string
  name: string
  subtitle?: string
  price?: string
  /** "What's included" - one line per feature. */
  features?: string[]
}

export interface CaptureField {
  id: string
  type: FieldType
  label: string
  required?: boolean
  placeholder?: string
  description?: string
  options?: string[]
  embedUrl?: string
  embedHeight?: number
  /** Text/email/phone/url fields only: let the visitor add several entries
   *  (e.g. multiple social handles), each on its own line. Stored newline-
   *  joined under the field id. */
  repeatable?: boolean
  /** Save this answer onto the lead: creates a matching column on the
   *  Leads page (keyed by a slug of the label) and writes each new
   *  submission's answer there. Existing lead values are never
   *  overwritten by later submissions from the same email. */
  mapToLead?: boolean
  /** `package` fields only: the selectable plan cards. */
  packages?: PackageOption[]
  /** Which form section (multi-step page) this field belongs to. Empty
   *  / unknown means it falls into the first step. Pages with no sections
   *  ignore this and render every field on one page. */
  sectionId?: string
}

/** A step in a multi-section capture form. Fields reference a section by id.
 *  A page can have up to 10. The last section carries the submit button; all
 *  earlier ones get a "Next" button. */
export interface CaptureSection {
  id: string
  /** Shown as the step heading. Optional - empty renders no heading. */
  title?: string
  /** Optional sub-text under the heading. */
  description?: string
}

export interface CaptureTheme {
  // `background` is always present after normalization. Mirrors the
  // shape in src/app/crm/[clientId]/capture/page.tsx so types align
  // when state passes through the ThemePicker + layout components.
  background: {
    type: 'solid' | 'gradient'
    color?: string
    from?: string
    to?: string
    direction?: string
  }
  /** Optional override for the form-card surface color. When null/
   *  undefined, layouts use the app's default `--bg-card`. Presets
   *  set it explicitly; in custom mode it's auto-derived from the
   *  background so the two read as related shades. */
  cardColor?: string | null
  textMode: 'auto' | 'custom'
  textColor?: string
  fontFamily: 'system' | 'inter' | 'poppins'
}

export type LayoutTemplate =
  | 'compact'
  | 'split-right'
  | 'split-left'
  | 'hero-overlay'
  | 'banner-top'
  | 'minimal'
  | 'landing'

/** Content elements for the 'landing' layout's drag-and-drop builder. A
 *  capture page stores an ordered array of these in `blocks`; the public
 *  Landing layout renders them top to bottom. One block of type 'form'
 *  renders the actual lead form (fields + meeting + submit). Props are kept
 *  flat (all optional) so the editor can mutate any block in place. */
export type CaptureBlockType =
  | 'heading'
  | 'text'
  | 'button'
  | 'image'
  | 'embed'
  | 'divider'
  | 'spacer'
  | 'logos'
  | 'card'
  | 'form'
  | 'row'
  | 'testimonials'
  | 'gallery'

export type BlockAlign = 'left' | 'center' | 'right'

/** One quote in a testimonials carousel. When `imageUrl` is set the card shows
 *  that image (e.g. a screenshot of a review) instead of the quote + profile. */
export interface TestimonialItem {
  quote: string
  name: string
  subtitle?: string
  avatarUrl?: string
  imageUrl?: string
}

/** One column inside a 'row' block. Holds its own stacked leaf blocks
 *  (text, image, form, embed, button, etc.) so elements sit side by side. */
export interface CaptureColumn {
  id: string
  blocks: CaptureBlock[]
}

export interface CaptureBlock {
  id: string
  type: CaptureBlockType
  align?: BlockAlign
  /** Optional font override (a CSS font-family stack from DOC_FONTS; empty =
   *  inherit the page font). */
  font?: string
  /** heading / text body. */
  content?: string
  /** heading size. */
  size?: 'sm' | 'md' | 'lg' | 'xl'
  /** button: label + link; variant shared with card's button. */
  label?: string
  url?: string
  variant?: 'solid' | 'outline'
  /** image. */
  alt?: string
  maxWidth?: number
  rounded?: boolean
  /** embed caption (video/iframe). */
  title?: string
  /** embed frame orientation (iframes can't self-size). Default landscape. */
  embedAspect?: '16/9' | '9/16' | '1/1'
  /** spacer height. */
  space?: 'sm' | 'md' | 'lg'
  /** logos / trust row. */
  logos?: { url: string }[]
  caption?: string
  /** card / panel: a styled container holding copy, an image and a CTA. */
  heading?: string
  text?: string
  imageUrl?: string
  /** card image display: 'natural' keeps the real aspect; 'banner' crops to a
   *  wide banner strip. */
  imageMode?: 'natural' | 'banner'
  buttonLabel?: string
  buttonUrl?: string
  cardVariant?: 'soft' | 'bordered' | 'elevated'
  /** row: side-by-side columns of blocks, with an optional section
   *  background colour and vertical alignment. 1-3 columns; stacks on
   *  mobile. */
  columns?: CaptureColumn[]
  bgColor?: string
  vAlign?: 'top' | 'center'
  /** row: draw a thin vertical divider between columns (desktop). */
  vDividers?: boolean
  /** testimonials: the quotes shown in the auto-sliding carousel. */
  testimonials?: TestimonialItem[]
  /** gallery (and card): a row of images (up to 5) at natural aspect. */
  gallery?: { url: string }[]
  /** card: embedded videos / links (up to 2) shown side by side. */
  embeds?: { url: string; title?: string; aspect?: '16/9' | '9/16' | '1/1' }[]
}

export interface CapturePageInfo {
  /** Capture page slug. Threaded into the renderer so the inline
   *  Calendly widget can identify which CRM/integration to log
   *  bookings against via /api/integrations/calendly/embed-callback. */
  slug?: string
  name: string
  headline: string
  description: string | null
  logo_url: string | null
  banner_url: string | null
  include_meeting: boolean
  calendly_url: string | null
  /** Which meeting integration this page uses (if any). When set, the
   *  renderer swaps the bare iframe / manual date-time inputs for the
   *  provider's official embed widget, which can fire booking
   *  callbacks even on plans that don't support webhooks. */
  meeting_integration?: 'calendly' | 'google_meet' | 'zoom' | null
  /** True when bookings flow into the meetings table without the
   *  visitor having to confirm date/time on the form. Used by the
   *  renderer to hide the manual confirmation block. */
  meeting_auto_logged?: boolean
  lead_magnet_url: string | null
  /** Label shown on the success-state CTA. Falls back to
   *  "Access Your Free Resource" when null/empty. */
  success_button_text?: string | null
  /** Custom message shown in the green confirmation banner after a
   *  successful submission. Falls back to "You're in! Let's Keep
   *  Going." when null/empty. */
  success_message?: string | null
  /** Brand accent color (hex) applied to both the Submit button and
   *  the success-state lead-magnet button. Null falls back to the
   *  default blue (#2B79F7). */
  accent_color?: string | null
  fields?: CaptureField[] | null
  /** Ordered multi-step sections. Empty / null = single-page form (legacy
   *  behaviour - every field on one page). */
  sections?: CaptureSection[] | null
  /** Landing-layout content blocks (ordered). Empty/null on non-landing
   *  pages; the Landing layout falls back to headline/description + form
   *  when this is empty. */
  blocks?: CaptureBlock[] | null
  theme?: CaptureTheme | null
  layout_template?: LayoutTemplate | null
}

/** Shared state every layout needs to render the form body + meeting
 *  section + submit + success state. Threaded through as a single prop
 *  bag so we don't pass 15 props per layout. */
export interface CaptureFormBag {
  fields: CaptureField[]
  values: Record<string, string>
  setValue: (id: string, val: string) => void
  meetingDate: string
  setMeetingDate: (v: string) => void
  meetingTime: string
  setMeetingTime: (v: string) => void
  success: boolean
  error: string
  isSubmitting: boolean
  leadMagnetUrl: string | null
  /** 'file' (uploaded PDF/doc) opens and downloads on click; 'url' (or
   *  unset) just opens the external link in a new tab. */
  leadMagnetType?: string | null
  onSubmit: (e: React.FormEvent) => void
  /** Optional - called when a field gains focus. Wired by the public
   *  capture page to the session-tracking hook so the analytics tab
   *  can show drop-off (which field they bounced from). */
  onFieldFocus?: (fieldId: string) => void
  /** Editor live-preview mode: lets the Next/Back buttons step through
   *  sections without required-field validation so the builder can see
   *  every section while editing. */
  preview?: boolean
}
