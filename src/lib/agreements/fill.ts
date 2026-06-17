/**
 * Placeholder filling for agreement bodies.
 *
 * The editor stores placeholders as chips:
 *   <span data-ph="email" ...>Email</span>
 * and we also accept hand-typed {{key}} tokens so power users can write
 * them directly. Values come from the lead's data json plus a few
 * built-ins (client name, today's date).
 *
 * fillAgreementHtml replaces every placeholder with the escaped value.
 * Unresolved keys are collected so the send flow can warn before a
 * half-filled contract goes out.
 */

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** Render a lead property value for document text. Arrays (multiselect)
 *  become a comma-separated list. */
export function placeholderValue(raw: unknown): string {
  if (raw == null) return ''
  if (Array.isArray(raw)) {
    return raw.map((v) => String(v)).filter(Boolean).join(', ')
  }
  if (typeof raw === 'boolean') return raw ? 'Yes' : 'No'
  return String(raw)
}

export interface FillResult {
  html: string
  /** Placeholder keys that had no value. */
  missing: string[]
}

// Chip spans as produced by the editor. The inner label is display-only;
// data-ph carries the key. Group 1 is the full attribute blob so any
// formatting the user applied to the chip can carry over to the value.
const CHIP_RE = /<span([^>]*\bdata-ph="([^"]+)"[^>]*)>.*?<\/span>/gi
const TOKEN_RE = /\{\{\s*([\w.-]+)\s*\}\}/g

// Formatting applied to a chip in the editor (bold, size, color...) must
// survive into the filled document. Only typographic properties pass;
// the chip's pill look comes from CSS classes and stays behind.
const CHIP_STYLE_KEEP = new Set([
  'font-weight',
  'font-style',
  'text-decoration',
  'text-decoration-line',
  'color',
  'background-color',
  'font-size',
  'font-family',
])

function chipStyles(attrs: string): string {
  const m = attrs.match(/\bstyle="([^"]*)"/i)
  if (!m) return ''
  return m[1]
    .split(';')
    .map((d) => d.trim())
    .filter((d) => {
      const prop = d.split(':')[0]?.trim().toLowerCase()
      return prop ? CHIP_STYLE_KEEP.has(prop) : false
    })
    .join('; ')
}

export function fillAgreementHtml(
  bodyHtml: string,
  values: Record<string, unknown>,
): FillResult {
  const missing = new Set<string>()

  const resolve = (key: string): string => {
    const v = placeholderValue(values[key])
    if (!v) missing.add(key)
    return escapeHtml(v)
  }

  const html = bodyHtml
    .replace(CHIP_RE, (_m, attrs: string, key: string) => {
      const v = resolve(key)
      const style = chipStyles(attrs)
      return v && style ? `<span style="${style}">${v}</span>` : v
    })
    .replace(TOKEN_RE, (_m, key: string) => resolve(key))

  return { html, missing: Array.from(missing) }
}

/** Keys referenced by a body (chips + typed tokens), for previews. */
export function listPlaceholderKeys(bodyHtml: string): string[] {
  const keys = new Set<string>()
  for (const m of bodyHtml.matchAll(CHIP_RE)) keys.add(m[2])
  for (const m of bodyHtml.matchAll(TOKEN_RE)) keys.add(m[1])
  return Array.from(keys)
}
