// Fills {{Field}} merge tokens in a capture-page thank-you email with the
// submitter's answers. A token matches a form field's label (case-insensitive)
// or the built-ins Name / Email / Phone. Unknown tokens resolve to empty so a
// raw {{token}} never reaches the recipient.

interface FillContext {
  /** fieldId -> submitted answer (the raw submission values map). */
  values: Record<string, unknown>
  /** fieldId -> field label, used to resolve {{Label}} tokens. */
  fieldLabels: Record<string, string>
  name?: string | null
  email?: string | null
  phone?: string | null
}

export function fillThankYouTemplate(template: string, ctx: FillContext): string {
  if (!template) return ''

  const lookup = new Map<string, string>()
  const put = (key: string, val: unknown) => {
    const k = key.trim().toLowerCase()
    if (!k) return
    lookup.set(k, val === null || val === undefined ? '' : String(val))
  }

  put('name', ctx.name)
  put('email', ctx.email)
  put('phone', ctx.phone)
  for (const [id, label] of Object.entries(ctx.fieldLabels)) {
    put(label, ctx.values[id])
  }

  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, token: string) => {
    const hit = lookup.get(String(token).trim().toLowerCase())
    return hit !== undefined ? hit : ''
  })
}

/** Escape a plain-text string for safe interpolation into an HTML email body
 *  (newlines are preserved by the caller via white-space: pre-wrap). */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
