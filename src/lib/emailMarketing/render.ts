import type { EmailBlock, EmailCta, EmailMarketingSettings } from './types'

/**
 * Render a campaign email to final HTML in the house email design language
 * (neutral canvas, one white card, uppercase brand line, hairline rules,
 * modest pill buttons - mirrors src/lib/email/templates.ts).
 *
 * Email-client constraints shape the embed handling: iframes and <video>
 * are stripped by Gmail/Outlook, so video URLs render as a thumbnail card
 * with a play badge that links out (the click is tracked, so "did they
 * watch" becomes a stat). Images render inline; unknown URLs become buttons.
 *
 * With a recipient token, every link is wrapped through /api/e/c/{token}
 * for click tracking and the footer carries the one-click unsubscribe.
 * Without one (preview mode) links stay raw.
 */

const FONT = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"

export interface RenderRecipient {
  token: string
  name: string
}

export interface MarketingEmailInput {
  subject: string
  preheader: string
  hookTitle: string
  blocks: EmailBlock[]
  ps: string
  ctas: EmailCta[]
  settings: EmailMarketingSettings
  fromName: string
  appUrl: string
  /** null = preview (no tracking, dummy unsubscribe). */
  recipient: RenderRecipient | null
}

function escapeHtml(str: unknown): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function escapeAttr(str: unknown): string {
  return escapeHtml(str).replace(/"/g, '&quot;')
}

/** {{first_name}} / {{name}} with a friendly fallback. For plain-text
 *  contexts (the whole string is escaped by the caller afterwards). */
export function personalize(text: string, leadName: string): string {
  const name = (leadName || '').trim()
  const first = name.split(/\s+/)[0] || 'there'
  return text
    .replace(/\{\{\s*first_name\s*\}\}/gi, first)
    .replace(/\{\{\s*name\s*\}\}/gi, name || 'there')
}

/** Same as personalize, but ESCAPES the injected value - for HTML contexts
 *  (rich text / callout / PS) where the surrounding markup is kept, so a
 *  lead name like "<b>x</b>" can't smuggle markup into the email. */
export function personalizeHtml(text: string, leadName: string): string {
  const name = escapeHtml((leadName || '').trim())
  const first = escapeHtml((leadName || '').trim().split(/\s+/)[0]) || 'there'
  return text
    .replace(/\{\{\s*first_name\s*\}\}/gi, first)
    .replace(/\{\{\s*name\s*\}\}/gi, name || 'there')
}

// ===== Embed detection (email-safe port of the capture page detectEmbed) =====

interface EmailEmbed {
  kind: 'image' | 'video_card' | 'link'
  src: string
  /** Thumbnail for video cards, when derivable (YouTube). */
  thumb?: string
}

/** Google Drive file id from any of its share-link shapes, or ''. */
function driveFileId(url: string): string {
  if (!url.includes('drive.google.com')) return ''
  const m1 = url.match(/\/file\/d\/([^/?#]+)/)
  if (m1?.[1]) return m1[1]
  const m2 = url.match(/[?&]id=([^&#]+)/)
  if (m2?.[1]) return m2[1]
  return ''
}

/**
 * Best direct-image URL for an <img src>. Drive share links are pages, not
 * images - Gmail renders nothing for them - so they get rewritten to Drive's
 * thumbnail endpoint (the file must be shared "anyone with the link").
 */
export function directImageUrl(raw?: string): string {
  const url = (raw || '').trim()
  const driveId = driveFileId(url)
  if (driveId) return `https://drive.google.com/thumbnail?id=${driveId}&sz=w1200`
  return url
}

export function detectEmailEmbed(raw?: string): EmailEmbed {
  const url = (raw || '').trim()
  if (!url) return { kind: 'link', src: '' }

  if (/\.(png|jpe?g|gif|webp|avif)(\?|#|$)/i.test(url)) return { kind: 'image', src: url }
  if (/\.(mp4|webm|ogg|mov|m4v)(\?|#|$)/i.test(url)) return { kind: 'video_card', src: url }

  // Google Drive: video or image, either way the thumbnail endpoint gives a
  // real preview frame and the click opens the file.
  const driveId = driveFileId(url)
  if (driveId) {
    return {
      kind: 'video_card',
      src: `https://drive.google.com/file/d/${driveId}/view`,
      thumb: `https://drive.google.com/thumbnail?id=${driveId}&sz=w1200`,
    }
  }

  let ytId = ''
  let m = url.match(/youtube\.com\/watch\?.*v=([^&]+)/)
  if (m?.[1]) ytId = m[1]
  m = url.match(/youtu\.be\/([^?]+)/)
  if (m?.[1]) ytId = m[1]
  m = url.match(/youtube\.com\/(?:shorts|embed)\/([^?/]+)/)
  if (m?.[1]) ytId = m[1]
  if (ytId) {
    return {
      kind: 'video_card',
      src: `https://www.youtube.com/watch?v=${ytId}`,
      thumb: `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`,
    }
  }

  // Loom publishes a thumbnail (with a play button baked in) per session.
  const loom = url.match(/loom\.com\/(?:share|embed)\/([a-f0-9]+)/i)
  if (loom?.[1]) {
    return {
      kind: 'video_card',
      src: `https://www.loom.com/share/${loom[1]}`,
      thumb: `https://cdn.loom.com/sessions/thumbnails/${loom[1]}-with-play.gif`,
    }
  }

  const vimeo = url.match(/vimeo\.com\/(?:video\/)?(\d+)/)
  if (vimeo?.[1]) {
    return {
      kind: 'video_card',
      src: `https://vimeo.com/${vimeo[1]}`,
      thumb: `https://vumbnail.com/${vimeo[1]}.jpg`,
    }
  }

  return { kind: 'link', src: url }
}

// ===== Rich text (composer toolbar output) =====

/** Composer text blocks started as plain text; the rich editor stores HTML.
 *  Tag presence decides which render path a block takes. */
export function looksLikeHtml(content: string): boolean {
  return /<[a-z][^>]*>/i.test(content || '')
}

const ALLOWED_RICH_TAGS = new Set(['b', 'strong', 'i', 'em', 'u', 'a', 'br', 'p', 'div', 'span'])

/**
 * Reduce editor HTML to email-safe markup: keep basic formatting tags with
 * all attributes stripped, validate + click-track link hrefs, drop
 * everything else. Runs AFTER personalization so injected values can't
 * smuggle markup through.
 */
export function sanitizeRichHtml(html: string, wrapLink: (url: string) => string): string {
  let out = (html || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|iframe|object|embed)[\s\S]*?<\/\1>/gi, '')

  out = out.replace(/<\/?([a-zA-Z0-9]+)((?:[^>"']|"[^"]*"|'[^']*')*)\/?>/g, (match, rawTag, attrs) => {
    const tag = rawTag.toLowerCase()
    if (!ALLOWED_RICH_TAGS.has(tag)) return ''
    if (match.startsWith('</')) return `</${tag}>`
    if (tag === 'br') return '<br/>'
    if (tag === 'a') {
      const hrefMatch = String(attrs).match(/href\s*=\s*(?:"([^"]*)"|'([^']*)')/i)
      const raw = hrefMatch ? hrefMatch[1] || hrefMatch[2] || '' : ''
      let safe = ''
      try {
        const u = new URL(raw)
        if (u.protocol === 'http:' || u.protocol === 'https:') safe = u.toString()
      } catch {
        /* not a URL - drop the link, keep its text */
      }
      if (!safe) return ''
      return (
        `<a href="${escapeAttr(wrapLink(safe))}" target="_blank" ` +
        'style="color:#2B79F7;font-weight:600;text-decoration:underline;">'
      )
    }
    return `<${tag}>`
  })
  return out
}

// ===== HTML pieces =====

// Long unbroken strings (urls, pasted text) must wrap instead of blowing
// out the 560px card.
const BREAK = 'word-break:break-word;overflow-wrap:anywhere;'

function para(text: string): string {
  return `<p style="margin:0 0 14px;font-size:14px;color:#374151;line-height:1.7;${BREAK}">${text}</p>`
}

function pillButton(href: string, text: string): string {
  return (
    '<div style="margin:20px 0 8px;">' +
    `<a href="${escapeAttr(href)}" target="_blank" ` +
    'style="display:inline-block;background:#2B79F7;color:#ffffff;text-decoration:none;' +
    `padding:10px 22px;border-radius:9999px;font-size:14px;font-weight:600;">${escapeHtml(text)}</a>` +
    '</div>'
  )
}

// Email clients strip iframes and <video>, so "embedding" a video means the
// platform-standard treatment: a full-width preview frame with a play badge
// that opens the video in one click. The click runs through tracking, so
// plays show up in the stats.
function videoCard(href: string, thumb: string | undefined, title: string): string {
  const inner = thumb
    ? `<img src="${escapeAttr(thumb)}" alt="${escapeAttr(title || 'Video')}" width="492" ` +
      'style="display:block;width:100%;max-width:492px;" />'
    : `<div style="padding:46px 18px;text-align:center;font-size:14px;color:#374151;background:#111827;">` +
      `<span style="display:inline-block;width:48px;height:48px;line-height:48px;border-radius:48px;` +
      `background:#2B79F7;color:#FFFFFF;font-size:18px;">&#9658;</span></div>`
  return (
    '<div style="margin:18px 0;">' +
    `<a href="${escapeAttr(href)}" target="_blank" style="text-decoration:none;display:block;` +
    'border:1px solid #E7E5E0;border-radius:10px;overflow:hidden;background:#F9FAFB;">' +
    inner +
    '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">' +
    '<tr>' +
    '<td width="34" style="padding:10px 0 10px 14px;">' +
    '<span style="display:inline-block;width:24px;height:24px;line-height:24px;border-radius:24px;' +
    'background:#2B79F7;color:#FFFFFF;font-size:10px;text-align:center;">&#9658;</span>' +
    '</td>' +
    `<td style="padding:10px 14px 10px 8px;font-size:13px;font-weight:600;color:#111827;">${escapeHtml(title || 'Watch the video')}</td>` +
    '</tr>' +
    '</table>' +
    '</a>' +
    '</div>'
  )
}

const SOCIAL_INITIALS: Record<string, string> = {
  instagram: 'IG',
  tiktok: 'TT',
  youtube: 'YT',
  facebook: 'FB',
  linkedin: 'IN',
  x: 'X',
  twitter: 'X',
  website: 'WWW',
}

function socialsRow(
  socials: EmailMarketingSettings['socials'],
  wrap: (url: string, label: string) => string,
): string {
  if (socials.length === 0) return ''
  const cells = socials
    .map((s) => {
      const initial = SOCIAL_INITIALS[s.platform.toLowerCase()] || s.platform.slice(0, 2).toUpperCase()
      return (
        `<a href="${escapeAttr(wrap(s.url, `social:${s.platform}`))}" target="_blank" ` +
        'style="display:inline-block;margin:0 4px;width:28px;height:28px;line-height:28px;' +
        'text-align:center;border:1px solid #E5E7EB;border-radius:28px;font-size:10px;' +
        `font-weight:700;color:#6B7280;text-decoration:none;">${escapeHtml(initial)}</a>`
      )
    })
    .join('')
  return `<div style="margin-top:20px;text-align:center;">${cells}</div>`
}

// ===== Main render =====

export function renderMarketingEmail(input: MarketingEmailInput): {
  subject: string
  html: string
  unsubscribeUrl: string | null
} {
  const leadName = input.recipient?.name || ''
  const token = input.recipient?.token || ''

  // Click wrapper. Preview mode keeps raw URLs.
  const wrap = (url: string, label: string): string => {
    if (!token || !url) return url
    return `${input.appUrl}/api/e/c/${token}?u=${encodeURIComponent(url)}&l=${encodeURIComponent(label)}`
  }

  const subject = personalize(input.subject, leadName)
  const preheader = personalize(input.preheader, leadName)
  const hookTitle = personalize(input.hookTitle, leadName)

  const wrapTextLink = (url: string) => wrap(url, 'text-link')

  const blocksHtml = input.blocks
    .map((block) => {
      if (block.type === 'text') {
        if (looksLikeHtml(block.content)) {
          return (
            `<div style="margin:0 0 14px;font-size:14px;color:#374151;line-height:1.7;${BREAK}">` +
            sanitizeRichHtml(personalizeHtml(block.content, leadName), wrapTextLink) +
            '</div>'
          )
        }
        const text = escapeHtml(personalize(block.content, leadName))
        return text
          .split(/\n{2,}/)
          .map((p) => para(p.replace(/\n/g, '<br/>')))
          .join('')
      }
      if (block.type === 'callout') {
        const inner = looksLikeHtml(block.content)
          ? sanitizeRichHtml(personalizeHtml(block.content, leadName), wrapTextLink)
          : escapeHtml(personalize(block.content, leadName)).replace(/\n/g, '<br/>')
        if (!inner.trim()) return ''
        return (
          '<div style="margin:18px 0;background:#F8F7F5;border:1px solid #E7E5E0;' +
          `border-radius:10px;padding:16px 18px;font-size:14px;color:#374151;line-height:1.7;${BREAK}">` +
          inner +
          '</div>'
        )
      }
      if (block.type === 'image') {
        return (
          '<div style="margin:18px 0;">' +
          `<img src="${escapeAttr(directImageUrl(block.url))}" alt="${escapeAttr(block.alt || '')}" width="492" ` +
          'style="display:block;width:100%;max-width:492px;border-radius:10px;" />' +
          '</div>'
        )
      }
      if (block.type === 'embed') {
        const embed = detectEmailEmbed(block.url)
        if (!embed.src) return ''
        if (embed.kind === 'image') {
          return (
            '<div style="margin:18px 0;">' +
            `<img src="${escapeAttr(embed.src)}" alt="${escapeAttr(block.title || '')}" width="492" ` +
            'style="display:block;width:100%;max-width:492px;border-radius:10px;" />' +
            '</div>'
          )
        }
        if (embed.kind === 'video_card') {
          return videoCard(wrap(embed.src, 'embed'), embed.thumb, block.title || 'Watch the video')
        }
        return pillButton(wrap(embed.src, 'embed'), block.title || 'Open link')
      }
      if (block.type === 'button') {
        return pillButton(wrap(block.url, 'button'), block.label || 'Open')
      }
      return ''
    })
    .join('')

  // CTA block: each configured CTA is its sentence + a tracked link, in the
  // self-segmenting "if you're X, click here" style.
  const ctasHtml = input.ctas
    .filter((c) => c.text || c.url)
    .map((c, i) => {
      const text = escapeHtml(personalize(c.text, leadName))
      const link = c.url
        ? ` <a href="${escapeAttr(wrap(c.url, `cta:${i + 1}`))}" target="_blank" ` +
          'style="color:#2B79F7;font-weight:600;text-decoration:none;">Click here</a>'
        : ''
      return para(text + link)
    })
    .join('')

  // The editor wraps lines in divs; flatten them so the PS text flows on
  // the same line as the "PS:" label.
  const psInner = looksLikeHtml(input.ps)
    ? sanitizeRichHtml(personalizeHtml(input.ps, leadName), wrapTextLink)
        .replace(/<\/?(div|p)>/gi, (m) => (m.startsWith('</') ? '<br/>' : ''))
        .replace(/(<br\/?>\s*)+$/gi, '')
    : escapeHtml(personalize(input.ps, leadName))
  const psHtml = psInner.replace(/<[^>]*>/g, '').trim()
    ? `<div style="margin:18px 0 0;font-size:14px;color:#374151;line-height:1.7;${BREAK}">` +
      `<b>PS:</b> ${psInner}</div>`
    : ''

  const unsubscribeUrl = token ? `${input.appUrl}/unsubscribe/${token}` : null
  const address = input.settings.footer_address
    ? `<div style="margin-top:6px;">${escapeHtml(input.settings.footer_address)}</div>`
    : ''
  const footer =
    '<div style="margin-top:24px;padding-top:16px;border-top:1px solid #F3F4F6;' +
    'font-size:12px;color:#9CA3AF;line-height:1.6;text-align:center;">' +
    `You are receiving this because you connected with ${escapeHtml(input.fromName)}. ` +
    `<a href="${escapeAttr(unsubscribeUrl || '#')}" target="_blank" style="color:#9CA3AF;">Unsubscribe</a>` +
    address +
    '</div>'

  const hidden = preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(preheader)}</div>`
    : ''

  const html =
    `<div style="margin:0;padding:32px 16px;background:#F6F5F4;">` +
    hidden +
    `<div style="max-width:560px;margin:0 auto;font-family:${FONT};">` +
    '<div style="background:#FFFFFF;border:1px solid #E7E5E0;border-radius:12px;padding:30px 34px;">' +
    `<div style="font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#9CA3AF;">${escapeHtml(input.fromName)}</div>` +
    (hookTitle
      ? `<div style="margin:14px 0 16px;font-size:18px;font-weight:600;color:#111827;${BREAK}">${escapeHtml(hookTitle)}</div>`
      : '<div style="margin:0 0 16px;"></div>') +
    blocksHtml +
    (ctasHtml ? `<div style="margin-top:20px;padding-top:16px;border-top:1px solid #F3F4F6;">${ctasHtml}</div>` : '') +
    psHtml +
    socialsRow(input.settings.socials, wrap) +
    footer +
    '</div>' +
    '</div>' +
    '</div>'

  return { subject, html, unsubscribeUrl }
}
