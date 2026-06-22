'use client'

/* eslint-disable @next/next/no-img-element */

// Renders the ordered content blocks of a 'landing' capture page. Shared by
// the public page and the editor's live preview, so what the builder sees is
// exactly what visitors get. The 'form' block renders the real lead form
// (CaptureFormBody) inside a card panel; a 'row' block lays its columns out
// side by side (stacking on mobile) with an optional section background;
// every other block is presentational.

import { useEffect, useRef, useState } from 'react'
import { Quote } from 'lucide-react'
import { CaptureFormBody, detectEmbed } from './CaptureFormBody'
import { buildCaptureThemeVars } from './colorUtils'
import { DOC_FONTS_URL } from '@/components/agreements/docStyles'
import type { CaptureBlock, CapturePageInfo, CaptureFormBag, BlockAlign, TestimonialItem } from './types'

const alignClass = (a?: BlockAlign) =>
  a === 'left' ? 'text-left' : a === 'right' ? 'text-right' : 'text-center'

const flexAlign = (a?: BlockAlign) =>
  a === 'left' ? 'justify-start' : a === 'right' ? 'justify-end' : 'justify-center'

const headingSize = (s?: string) =>
  s === 'sm'
    ? 'text-xl sm:text-2xl'
    : s === 'lg'
      ? 'text-3xl sm:text-5xl'
      : s === 'xl'
        ? 'text-4xl sm:text-6xl'
        : 'text-2xl sm:text-4xl'

const spacerH = (s?: string) => (s === 'sm' ? 16 : s === 'lg' ? 64 : 32)

const textSize = (s?: string) =>
  s === 'sm'
    ? 'text-sm sm:text-base'
    : s === 'lg'
      ? 'text-lg sm:text-2xl'
      : s === 'xl'
        ? 'text-xl sm:text-3xl'
        : 'text-base sm:text-lg'

const fontStyle = (f?: string): React.CSSProperties | undefined => (f ? { fontFamily: f } : undefined)

// Auto-sliding testimonials carousel. A transform-based marquee (not a scroll
// container) so it loops round forever no matter the card count. The set is
// repeated enough times to always overflow the container (so there's never a
// trailing gap), and the offset wraps at one set's width for a seamless loop.
// Each card has an equal right margin (not flex gap) so every set is the same
// width. Pauses on hover / touch.
function TestimonialsCarousel({ items }: { items: TestimonialItem[] }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const paused = useRef(false)
  const offset = useRef(0)
  const [repeats, setRepeats] = useState(3)

  // Grow `repeats` until one set's width + the container fits inside the
  // track, so a full screen of cards is always visible (no end gap). Recheck
  // on resize since the page is full-bleed and the width varies a lot.
  useEffect(() => {
    const measure = () => {
      const track = trackRef.current
      const wrap = wrapRef.current
      if (!track || !wrap || items.length === 0) return
      const oneSet = track.scrollWidth / repeats
      if (oneSet <= 0) return
      const needed = Math.ceil((wrap.clientWidth + oneSet) / oneSet) + 1
      if (needed > repeats) setRepeats(needed)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [repeats, items.length])

  useEffect(() => {
    const track = trackRef.current
    if (!track || items.length === 0) return
    let raf = 0
    let last = 0
    const tick = (t: number) => {
      if (last && !paused.current) {
        const dt = t - last
        offset.current -= dt * 0.04 // ~40px / second, leftward
        const oneSet = track.scrollWidth / repeats
        if (oneSet > 0 && -offset.current >= oneSet) offset.current += oneSet
        track.style.transform = `translate3d(${offset.current}px, 0, 0)`
      }
      last = t
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [repeats, items.length])

  if (items.length === 0) return null

  const list = Array.from({ length: repeats }, () => items).flat()

  return (
    <div
      ref={wrapRef}
      className="overflow-hidden"
      onMouseEnter={() => (paused.current = true)}
      onMouseLeave={() => (paused.current = false)}
      onTouchStart={() => (paused.current = true)}
      onTouchEnd={() => (paused.current = false)}
    >
      <div ref={trackRef} className="flex w-max items-start pb-2 will-change-transform">
        {list.map((it, i) =>
          // Every card is the same fixed size. Image cards fit the whole image
          // inside the box (object-contain, no crop, no stretch). Text cards
          // pin the person to the bottom so the card fills evenly. mr-4 (not
          // flex gap) keeps both halves equal width for a seamless wrap.
          it.imageUrl ? (
            <div key={i} className="shrink-0 mr-4 w-72 sm:w-80 h-60 rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] overflow-hidden flex items-center justify-center p-2">
              <img src={it.imageUrl} alt={it.name || ''} className="max-w-full max-h-full object-contain rounded-lg" />
            </div>
          ) : (
            <div
              key={i}
              className="shrink-0 mr-4 w-72 sm:w-80 h-60 rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-5 flex flex-col"
            >
            <div className="min-h-0 overflow-hidden">
              <Quote className="h-5 w-5 text-[var(--text-tertiary)]" />
              <p className="mt-3 text-sm leading-relaxed text-[var(--text-secondary)]">
                &ldquo;{it.quote}&rdquo;
              </p>
            </div>
            <div className="mt-auto pt-4 flex items-center gap-3">
              {it.avatarUrl ? (
                <img src={it.avatarUrl} alt={it.name} className="h-9 w-9 rounded-full object-cover" />
              ) : (
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--bg-tertiary)] text-xs font-semibold text-[var(--text-secondary)]">
                  {(it.name || '?').charAt(0).toUpperCase()}
                </span>
              )}
              <div className="min-w-0">
                <p className="text-sm font-medium text-[var(--text-primary)] truncate">{it.name}</p>
                {it.subtitle && <p className="text-xs text-[var(--text-tertiary)] truncate">{it.subtitle}</p>}
              </div>
            </div>
          </div>
          ),
        )}
      </div>
    </div>
  )
}

const gridColsClass = (n: number) =>
  n <= 1 ? 'grid-cols-1' : n === 2 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1 md:grid-cols-3'

/** Recursively detect a lead form anywhere in the tree (top level or nested
 *  in a row column). */
function hasFormBlock(blocks: CaptureBlock[]): boolean {
  return blocks.some(
    (b) =>
      b.type === 'form' ||
      (b.type === 'row' && (b.columns || []).some((c) => hasFormBlock(c.blocks || []))),
  )
}

/** Synthesize a sensible default block list from the page's headline +
 *  description + form, so a Landing page with no blocks still renders. Also
 *  guarantees a form is always present so visitors can submit. */
export function effectiveBlocks(pageInfo: CapturePageInfo): CaptureBlock[] {
  const blocks = pageInfo.blocks
  if (Array.isArray(blocks) && blocks.length > 0) {
    return hasFormBlock(blocks) ? blocks : [...blocks, { id: 'def-form', type: 'form' }]
  }
  const out: CaptureBlock[] = [
    { id: 'def-heading', type: 'heading', content: pageInfo.headline || 'Get your free resource', align: 'center', size: 'lg' },
  ]
  if (pageInfo.description) {
    out.push({ id: 'def-text', type: 'text', content: pageInfo.description, align: 'center' })
  }
  out.push({ id: 'def-form', type: 'form' })
  return out
}

function Button({ label, url, accent, variant }: { label: string; url: string; accent: string; variant?: string }) {
  const solid = variant !== 'outline'
  return (
    <a
      href={url || '#'}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center justify-center rounded-lg px-6 py-3 text-sm font-semibold transition-opacity hover:opacity-90"
      style={solid ? { backgroundColor: accent, color: '#fff' } : { border: `2px solid ${accent}`, color: accent }}
    >
      {label || 'Button'}
    </a>
  )
}

function EmbedBlock({ url, title, aspect }: { url: string; title?: string; aspect?: '16/9' | '9/16' | '1/1' }) {
  const embed = detectEmbed(url)
  if (embed.kind === 'none') return null
  const ar = aspect === '9/16' ? '9 / 16' : aspect === '1/1' ? '1 / 1' : '16 / 9'
  // Cap the frame by height (70vh) and derive the matching max width so a
  // portrait frame stays narrow + centered instead of full-bleed.
  const maxW = aspect === '9/16' ? 'calc(70vh * 9 / 16)' : aspect === '1/1' ? '70vh' : 'calc(70vh * 16 / 9)'
  let media: React.ReactNode
  if (embed.kind === 'image') {
    media = <img src={embed.src} alt={title || ''} className="w-full h-auto rounded-xl" />
  } else if (embed.kind === 'video') {
    // Cap the video by height and centre it so a portrait clip doesn't blow
    // up full-width on mobile (which made iOS render oversized controls).
    // playsInline keeps it in the page instead of forcing fullscreen.
    media = (
      <div className="flex justify-center">
        <video
          src={embed.src}
          controls
          playsInline
          preload="metadata"
          className="max-h-[70vh] max-w-full rounded-xl bg-black"
        />
      </div>
    )
  } else if (embed.kind === 'link') {
    media = (
      <a href={embed.src} target="_blank" rel="noopener noreferrer" className="text-sm underline break-all" style={{ color: '#2B79F7' }}>
        {embed.src}
      </a>
    )
  } else {
    // Responsive frame in the chosen orientation (capped on tall screens)
    // instead of a fixed height, so it scales cleanly down to mobile widths.
    media = (
      <div
        className="relative w-full overflow-hidden rounded-xl border border-[var(--border-primary)] mx-auto"
        style={{ aspectRatio: ar, maxHeight: '70vh', maxWidth: maxW }}
      >
        <iframe
          src={embed.src}
          className="absolute inset-0 h-full w-full border-0"
          loading="lazy"
          title={title || 'Embed'}
          allow="autoplay; fullscreen; picture-in-picture"
          allowFullScreen
        />
      </div>
    )
  }
  return (
    <div>
      {media}
      {title && <p className="mt-2 text-sm text-[var(--text-tertiary)] text-center">{title}</p>}
    </div>
  )
}

interface RenderCtx {
  pageInfo: CapturePageInfo
  form: CaptureFormBag
  cardStyle: React.CSSProperties
  accent: string
}

function renderBlock(b: CaptureBlock, ctx: RenderCtx): React.ReactNode {
  const { accent, cardStyle, pageInfo, form } = ctx
  switch (b.type) {
    case 'heading':
      return (
        <h2 key={b.id} style={fontStyle(b.font)} className={`${headingSize(b.size)} font-bold tracking-tight text-[var(--text-primary)] ${alignClass(b.align)}`}>
          {b.content || ''}
        </h2>
      )

    case 'text':
      return (
        <p key={b.id} style={fontStyle(b.font)} className={`${textSize(b.size)} leading-relaxed text-[var(--text-secondary)] whitespace-pre-wrap ${alignClass(b.align)}`}>
          {b.content || ''}
        </p>
      )

    case 'button':
      return (
        <div key={b.id} className={`flex ${flexAlign(b.align)}`}>
          <Button label={b.label || ''} url={b.url || ''} accent={accent} variant={b.variant} />
        </div>
      )

    case 'image':
      return (
        <div key={b.id} className={`flex ${flexAlign(b.align)}`}>
          {b.url ? (
            <img src={b.url} alt={b.alt || ''} className={`h-auto w-full ${b.rounded === false ? '' : 'rounded-xl'}`} style={{ maxWidth: b.maxWidth || 640 }} />
          ) : null}
        </div>
      )

    case 'embed':
      return <EmbedBlock key={b.id} url={b.url || ''} title={b.title} aspect={b.embedAspect} />

    case 'divider':
      return <hr key={b.id} className="border-t border-[var(--border-primary)]" />

    case 'spacer':
      return <div key={b.id} style={{ height: spacerH(b.space) }} />

    case 'logos':
      return (
        <div key={b.id} className="text-center">
          {b.caption && <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">{b.caption}</p>}
          <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-4 opacity-80">
            {(b.logos || []).filter((l) => l.url).slice(0, 10).map((l, i) => (
              <img key={i} src={l.url} alt="" className="h-8 sm:h-10 w-auto object-contain" />
            ))}
          </div>
        </div>
      )

    case 'card': {
      const variant = b.cardVariant || 'soft'
      const base = 'rounded-2xl p-6 sm:p-8 overflow-hidden'
      const cls =
        variant === 'bordered'
          ? `${base} border border-[var(--border-primary)]`
          : variant === 'elevated'
            ? `${base} shadow-xl border border-[var(--border-primary)]`
            : `${base} bg-[var(--bg-secondary)]`
      const style = variant === 'soft' ? undefined : cardStyle
      return (
        <div key={b.id} className={cls} style={style}>
          {b.imageUrl && (
            <img
              src={b.imageUrl}
              alt=""
              className={`mb-5 w-full rounded-xl ${b.imageMode === 'banner' ? 'h-40 sm:h-52 object-cover' : 'h-auto'}`}
            />
          )}
          {b.heading && <h3 style={fontStyle(b.font)} className={`text-xl sm:text-2xl font-bold text-[var(--text-primary)] ${alignClass(b.align)}`}>{b.heading}</h3>}
          {b.text && <p style={fontStyle(b.font)} className={`mt-2 text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap ${alignClass(b.align)}`}>{b.text}</p>}
          {(() => {
            const imgs = (b.gallery || []).filter((g) => g.url).slice(0, 5)
            if (imgs.length === 0) return null
            return (
              <div className="mt-4 flex flex-wrap items-center gap-3">
                {imgs.map((g, i) => (
                  <img key={i} src={g.url} alt="" className="h-24 sm:h-28 w-auto max-w-full rounded-lg object-contain" />
                ))}
              </div>
            )
          })()}
          {(() => {
            const eds = (b.embeds || []).filter((e) => e.url).slice(0, 2)
            if (eds.length === 0) return null
            return (
              <div className={`mt-4 grid gap-3 ${eds.length === 2 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'}`}>
                {eds.map((e, i) => (
                  <EmbedBlock key={i} url={e.url} title={e.title} aspect={e.aspect} />
                ))}
              </div>
            )
          })()}
          {b.buttonLabel && (
            <div className={`mt-5 flex ${flexAlign(b.align)}`}>
              <Button label={b.buttonLabel} url={b.buttonUrl || ''} accent={accent} variant={b.variant} />
            </div>
          )}
        </div>
      )
    }

    case 'testimonials':
      return <TestimonialsCarousel key={b.id} items={b.testimonials || []} />

    case 'gallery': {
      const imgs = (b.gallery || []).filter((g) => g.url).slice(0, 5)
      if (imgs.length === 0) return null
      return (
        <div key={b.id} className="flex flex-wrap items-center justify-center gap-3 sm:gap-4">
          {imgs.map((g, i) => (
            <img key={i} src={g.url} alt="" className="h-32 sm:h-44 w-auto max-w-full rounded-xl object-contain" />
          ))}
        </div>
      )
    }

    case 'form':
      // Long forms keep their size and scroll inside the panel so they don't
      // push the rest of a landing page far down (and stay tidy beside a
      // column image).
      return (
        <div key={b.id} className="self-start flex flex-col rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-card)] shadow-xl h-[600px] overflow-y-auto" style={cardStyle}>
          {/* m-auto vertically centers a short section so it fills the panel
              evenly (no empty bottom); a long section sticks to the top and
              scrolls. The panel height stays constant across sections. */}
          <div className="m-auto w-full p-6 sm:p-8">
            <CaptureFormBody pageInfo={pageInfo} {...form} />
          </div>
        </div>
      )

    case 'row': {
      const cols = b.columns || []
      const n = Math.min(3, Math.max(1, cols.length))
      const bg = b.bgColor && b.bgColor.trim() ? b.bgColor : ''
      // Section background: recolor text tokens for contrast against the
      // chosen colour, exactly like the page card does for its surface.
      const wrapStyle = bg ? ({ background: bg, ...(buildCaptureThemeVars(bg) as React.CSSProperties) }) : undefined
      const wrapClass = bg ? 'rounded-2xl p-6 sm:p-10' : ''
      const vAlign = b.vAlign === 'center' ? 'md:items-center' : 'md:items-start'
      return (
        <div key={b.id} style={wrapStyle} className={wrapClass}>
          <div className={`grid ${gridColsClass(n)} ${vAlign} gap-6 sm:gap-8`}>
            {cols.map((col, ci) => (
              <div
                key={col.id}
                className={`space-y-4 min-w-0 ${
                  b.vDividers && ci > 0 ? 'md:border-l md:border-[var(--border-primary)] md:pl-8' : ''
                }`}
              >
                {(col.blocks || []).map((cb) => renderBlock(cb, ctx))}
              </div>
            ))}
          </div>
        </div>
      )
    }

    default:
      return null
  }
}

interface Props {
  pageInfo: CapturePageInfo
  form: CaptureFormBag
  /** Card surface style (carries the picked card color), used for the
   *  form panel and 'elevated'/'bordered' card blocks. */
  cardStyle: React.CSSProperties
  accent: string
}

export function CaptureBlocks({ pageInfo, form, cardStyle, accent }: Props) {
  const blocks = effectiveBlocks(pageInfo)
  const ctx: RenderCtx = { pageInfo, form, cardStyle, accent }
  return (
    <div className="space-y-6">
      {/* Loads the same Google fonts the agreements editor offers, so a font
          picked per block renders on the public page. */}
      <link rel="stylesheet" href={DOC_FONTS_URL} />
      {blocks.map((b) => renderBlock(b, ctx))}
    </div>
  )
}
