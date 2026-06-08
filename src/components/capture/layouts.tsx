'use client'

/* eslint-disable @next/next/no-img-element */

// Six visual shells for the public capture page. Each takes the same
// CaptureLayoutProps (page info + form bag + style) and arranges the
// brand block (logo + banner + headline + description) and the form
// body differently.
//
// LAYOUTS (in picker order):
//   compact      | single centered card, optional banner header (default)
//   split-right  | image right column, form/text left column
//   split-left   | flipped: image left, form/text right
//   hero-overlay | full-bleed image bg, form in frosted card on top
//   banner-top   | full-width banner image, form stacked below in a column
//   minimal      | no image, big typography + form, plain background
//
// The form body (fields + meeting section + submit + success state)
// lives in CaptureFormBody and renders identically in every shell.

import { Card, CardContent } from '@/components/ui/Card'
import { CaptureFormBody } from './CaptureFormBody'
import type {
  CapturePageInfo,
  CaptureFormBag,
  LayoutTemplate,
} from './types'

export interface CaptureLayoutProps {
  pageInfo: CapturePageInfo
  form: CaptureFormBag
  /** Page background style. Applied to the outer layout element. */
  bgStyle: React.CSSProperties
  /** Form-card style. When the theme has cardColor set, this carries
   *  `background` (and dark-card text color) so the card surface in
   *  each layout matches the picked palette. Empty object when no
   *  override - layout falls back to the app's `--bg-card` token. */
  cardStyle: React.CSSProperties
  fontStyle: React.CSSProperties
  fontClass: string
}

// Shared header (logo + headline + description). Centered by default
// but layouts can override alignment via the `align` prop.
function CaptureHeader({
  pageInfo,
  align = 'center',
  size = 'md',
}: {
  pageInfo: CapturePageInfo
  align?: 'center' | 'left'
  size?: 'md' | 'lg' | 'xl'
}) {
  const titleSize =
    size === 'xl' ? 'text-3xl sm:text-5xl' : size === 'lg' ? 'text-3xl sm:text-4xl' : 'text-2xl sm:text-3xl'
  return (
    <div className={align === 'center' ? 'text-center' : 'text-left'}>
      {pageInfo.logo_url && (
        <div
          className={`mb-4 ${align === 'center' ? 'flex justify-center' : ''}`}
        >
          <div className="h-14 w-14 rounded-full bg-[var(--bg-tertiary)] overflow-hidden ring-1 ring-[var(--border-primary)]">
            <img src={pageInfo.logo_url} alt={pageInfo.name || 'Logo'} className="h-full w-full object-cover" />
          </div>
        </div>
      )}
      <h1 className={`${titleSize} font-bold text-[var(--text-primary)] tracking-tight`}>
        {pageInfo.headline || 'Get your free resource'}
      </h1>
      {pageInfo.description && (
        <p className="mt-3 text-base text-[var(--text-secondary)] leading-relaxed">
          {pageInfo.description}
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// COMPACT - the legacy / default layout. Byte-equivalent to the rendering
// users saw before layout_template existed. Kept exactly as-is so
// existing pages don't change after the migration.
// ---------------------------------------------------------------------------

function CompactLayout({ pageInfo, form, bgStyle, cardStyle, fontClass }: CaptureLayoutProps) {
  return (
    <div
      className={`min-h-screen flex items-center justify-center p-4 overflow-x-hidden ${fontClass}`}
      style={bgStyle}
    >
      <div className="w-full max-w-lg overflow-x-hidden">
        <Card style={cardStyle}>
          <CardContent className="p-6 md:p-8">
            {pageInfo.banner_url ? (
              <div className="mb-4">
                <div className="relative w-full rounded-xl overflow-hidden border border-[var(--border-primary)] bg-[var(--bg-tertiary)]">
                  <img src={pageInfo.banner_url} alt="Banner" className="w-full h-40 sm:h-48 object-cover" />
                  {pageInfo.logo_url && (
                    <div className="absolute left-3 bottom-3 h-12 w-12 rounded-full bg-white/90 border border-white/60 shadow-md overflow-hidden">
                      <img src={pageInfo.logo_url} alt={pageInfo.name || 'Logo'} className="h-full w-full object-cover" />
                    </div>
                  )}
                </div>
              </div>
            ) : pageInfo.logo_url ? (
              <div className="flex justify-center mb-4">
                <div className="h-16 w-16 rounded-full bg-[var(--bg-tertiary)] overflow-hidden">
                  <img src={pageInfo.logo_url} alt={pageInfo.name || 'Logo'} className="h-full w-full object-cover" />
                </div>
              </div>
            ) : null}

            <h1 className="text-2xl font-bold text-[var(--text-primary)] mb-2 text-center">
              {pageInfo.headline || 'Get your free resource'}
            </h1>
            {pageInfo.description && (
              <p className="text-[var(--text-secondary)] mb-6 text-center">{pageInfo.description}</p>
            )}

            <CaptureFormBody pageInfo={pageInfo} {...form} />

            <p className="mt-6 text-xs text-[var(--capture-footer)] opacity-70 text-center">
              Powered by Fokus Kreativez
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// SPLIT-RIGHT - image (or solid gradient if no banner) on the right
// column, brand+form on the left. Mobile stacks: form on top, image
// below. Image area fills 100% of its column.
// ---------------------------------------------------------------------------

function SplitLayout({
  pageInfo,
  form,
  bgStyle,
  cardStyle,
  fontClass,
  side,
}: CaptureLayoutProps & { side: 'right' | 'left' }) {
  // Form column uses the card surface so the picked card color
  // fills the half where fields live. Falls back to the page bg
  // when no card override is set.
  const formColStyle =
    cardStyle && Object.keys(cardStyle).length > 0 ? cardStyle : {}

  const formCol = (
    <div
      className="flex items-center justify-center p-6 sm:p-10 lg:p-16 min-h-[100vh] lg:min-h-screen bg-[var(--bg-card)]"
      style={formColStyle}
    >
      <div className="w-full max-w-md">
        <CaptureHeader pageInfo={pageInfo} align="left" size="lg" />
        <div className="mt-6">
          <CaptureFormBody pageInfo={pageInfo} {...form} />
        </div>
        <p className="mt-6 text-xs text-[var(--capture-footer)] opacity-70">Powered by Fokus Kreativez</p>
      </div>
    </div>
  )

  const mediaCol = (
    <div className="relative min-h-[260px] lg:min-h-screen overflow-hidden">
      {pageInfo.banner_url ? (
        <img
          src={pageInfo.banner_url}
          alt={pageInfo.name || 'Banner'}
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <div className="absolute inset-0" style={bgStyle} />
      )}
      <div className="absolute inset-0 bg-gradient-to-br from-black/10 to-transparent pointer-events-none" />
    </div>
  )

  // bgStyle is applied to the OUTERMOST element so the CSS var
  // overrides it carries (--bg-card, --text-primary, etc.) cascade
  // into every child - including the form column's text/inputs.
  // Without this the layout subtree would inherit the admin app's
  // theme tokens, breaking contrast for light-card pages on dark-
  // mode admin (and vice versa).
  return (
    <div className={`min-h-screen ${fontClass}`} style={bgStyle}>
      <div className="grid grid-cols-1 lg:grid-cols-2 min-h-screen">
        {side === 'right' ? formCol : mediaCol}
        {side === 'right' ? mediaCol : formCol}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// HERO-OVERLAY - banner image fills the viewport, brand+form sit in a
// frosted card centered on top.
// ---------------------------------------------------------------------------

function HeroOverlayLayout({ pageInfo, form, bgStyle, cardStyle, fontClass }: CaptureLayoutProps) {
  return (
    <div className={`relative min-h-screen overflow-hidden ${fontClass}`} style={bgStyle}>
      {pageInfo.banner_url && (
        <>
          <img
            src={pageInfo.banner_url}
            alt={pageInfo.name || 'Banner'}
            className="absolute inset-0 w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-black/50" />
        </>
      )}

      <div className="relative z-10 min-h-screen flex items-center justify-center p-4 sm:p-8">
        <div
          className="w-full max-w-lg rounded-2xl bg-[var(--bg-card)]/95 backdrop-blur-md border border-[var(--border-primary)] shadow-2xl p-6 sm:p-8"
          style={cardStyle}
        >
          <CaptureHeader pageInfo={pageInfo} align="center" size="lg" />
          <div className="mt-6">
            <CaptureFormBody pageInfo={pageInfo} {...form} />
          </div>
          <p className="mt-6 text-xs text-[var(--capture-footer)] opacity-70 text-center">
            Powered by Fokus Kreativez
          </p>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// BANNER-TOP - full-width banner image up top, brand+form stacked
// below in a single centered column. No card chrome - the banner IS
// the visual anchor.
// ---------------------------------------------------------------------------

function BannerTopLayout({ pageInfo, form, bgStyle, cardStyle, fontClass }: CaptureLayoutProps) {
  return (
    // Center the banner+card+footer as one block. On tall viewports the
    // form is shorter than the screen; without centering, all the leftover
    // height piled up below "Powered by" as dead space. min-h-screen still
    // fills short pages, and because it grows (not a fixed height) a form
    // taller than the viewport just flows from the top and scrolls -
    // justify-center becomes a no-op, so nothing clips.
    <div className={`min-h-screen flex flex-col justify-center ${fontClass}`} style={bgStyle}>
      {pageInfo.banner_url && (
        <div className="relative w-full h-44 sm:h-64 md:h-80 overflow-hidden shrink-0">
          <img
            src={pageInfo.banner_url}
            alt={pageInfo.name || 'Banner'}
            className="w-full h-full object-cover"
          />
        </div>
      )}
      <div className="max-w-2xl mx-auto px-4 sm:px-6 mt-10 sm:mt-14 pb-12 sm:pb-16 relative z-10">
        {/* Card sits BELOW the banner with a comfortable gap. The
            logo floats in that gap, half above the card / half on it,
            so it bridges banner → card without obstructing either. */}
        <div
          className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border-primary)] shadow-xl p-6 sm:p-10 relative"
          style={cardStyle}
        >
          {pageInfo.logo_url && (
            <div className="absolute left-1/2 -translate-x-1/2 -top-10 sm:-top-12">
              <div className="h-20 w-20 sm:h-24 sm:w-24 rounded-full bg-white shadow-lg ring-4 ring-[var(--bg-card)] overflow-hidden">
                <img src={pageInfo.logo_url} alt={pageInfo.name || 'Logo'} className="h-full w-full object-cover" />
              </div>
            </div>
          )}
          <div className={`text-center mb-6 ${pageInfo.logo_url ? 'mt-10 sm:mt-12' : ''}`}>
            <h1 className="text-2xl sm:text-4xl font-bold text-[var(--text-primary)] tracking-tight">
              {pageInfo.headline || 'Get your free resource'}
            </h1>
            {pageInfo.description && (
              <p className="mt-3 text-base text-[var(--text-secondary)] leading-relaxed">
                {pageInfo.description}
              </p>
            )}
          </div>
          <CaptureFormBody pageInfo={pageInfo} {...form} />
        </div>
        <p className="mt-6 text-xs text-[var(--capture-footer)] opacity-70 text-center">
          Powered by Fokus Kreativez
        </p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// MINIMAL - no image at all. Just big typography + form on a plain
// (or themed) background. The cleanest, Tally-style "all attention on
// the question" look.
// ---------------------------------------------------------------------------

function MinimalLayout({ pageInfo, form, bgStyle, cardStyle, fontClass }: CaptureLayoutProps) {
  // The form area gets the cardStyle so the picked color fills the
  // content region, not just the strip behind the headline. Combined
  // with wider max-w and bigger type, the page feels intentional
  // rather than a thin form floating in empty space.
  const hasCardOverride = cardStyle && Object.keys(cardStyle).length > 0

  return (
    <div className={`min-h-screen flex items-center justify-center p-4 sm:p-8 ${fontClass}`} style={bgStyle}>
      <div
        className={`w-full max-w-2xl py-10 sm:py-16 px-6 sm:px-12 ${
          hasCardOverride
            ? 'rounded-3xl border border-[var(--border-primary)] shadow-xl'
            : ''
        }`}
        style={hasCardOverride ? cardStyle : undefined}
      >
        {pageInfo.logo_url && (
          <div className="flex justify-center mb-6">
            <div className="h-20 w-20 rounded-full bg-white overflow-hidden shadow-md ring-1 ring-[var(--border-primary)]">
              <img src={pageInfo.logo_url} alt={pageInfo.name || 'Logo'} className="h-full w-full object-cover" />
            </div>
          </div>
        )}
        <div className="text-center mb-10">
          <h1 className="text-4xl sm:text-6xl font-bold text-[var(--text-primary)] tracking-tight leading-[1.05]">
            {pageInfo.headline || 'Get your free resource'}
          </h1>
          {pageInfo.description && (
            <p className="mt-5 text-lg sm:text-xl text-[var(--text-secondary)] leading-relaxed">
              {pageInfo.description}
            </p>
          )}
        </div>
        <CaptureFormBody pageInfo={pageInfo} {...form} />
        <p className="mt-10 text-xs text-[var(--capture-footer)] opacity-70 text-center">
          Powered by Fokus Kreativez
        </p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export function CaptureLayout(props: CaptureLayoutProps) {
  const layout: LayoutTemplate = (props.pageInfo.layout_template ?? 'compact') as LayoutTemplate
  switch (layout) {
    case 'split-right':
      return <SplitLayout {...props} side="right" />
    case 'split-left':
      return <SplitLayout {...props} side="left" />
    case 'hero-overlay':
      return <HeroOverlayLayout {...props} />
    case 'banner-top':
      return <BannerTopLayout {...props} />
    case 'minimal':
      return <MinimalLayout {...props} />
    case 'compact':
    default:
      return <CompactLayout {...props} />
  }
}

/** Layouts exposed for the picker UI. Each row also carries the
 *  recommended banner image aspect ratio + dimensions so the modal
 *  can show users what to upload BEFORE they upload the wrong shape. */
export const LAYOUT_TEMPLATES: Array<{
  key: LayoutTemplate
  label: string
  description: string
  /** Human label for the recommended banner aspect (e.g. "16:9 wide"). */
  bannerAspect: string
  /** Exact pixel dimensions the layout looks best at. */
  bannerSize: string
  /** Whether this layout uses the banner image at all. */
  usesBanner: boolean
}> = [
  {
    key: 'compact',
    label: 'Compact',
    description: 'Centered card. The original look.',
    bannerAspect: '5:2 wide',
    bannerSize: '1200×480 px',
    usesBanner: true,
  },
  {
    key: 'split-right',
    label: 'Split (image right)',
    description: 'Two columns. Form left, image right.',
    bannerAspect: '3:4 portrait or 1:1',
    bannerSize: '900×1200 px',
    usesBanner: true,
  },
  {
    key: 'split-left',
    label: 'Split (image left)',
    description: 'Two columns. Image left, form right.',
    bannerAspect: '3:4 portrait or 1:1',
    bannerSize: '900×1200 px',
    usesBanner: true,
  },
  {
    key: 'hero-overlay',
    label: 'Hero overlay',
    description: 'Image fills the viewport, form floats on top.',
    bannerAspect: '16:9 widescreen',
    bannerSize: '1920×1080 px',
    usesBanner: true,
  },
  {
    key: 'banner-top',
    label: 'Banner top',
    description: 'Wide image header, form stacked below.',
    bannerAspect: '8:3 ultra-wide',
    bannerSize: '1600×600 px',
    usesBanner: true,
  },
  {
    key: 'minimal',
    label: 'Minimal',
    description: 'No image. Big typography + form.',
    bannerAspect: 'N/A',
    bannerSize: 'Not used',
    usesBanner: false,
  },
]
