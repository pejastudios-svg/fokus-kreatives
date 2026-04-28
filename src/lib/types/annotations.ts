/**
 * Annotation types for approval comments.
 *
 * Coordinates are PERCENT-BASED (0-1) relative to the rendered asset box, so a
 * region drawn on a 4K monitor still lines up correctly on a phone. App code
 * is responsible for clamping / validating; the DB stores whatever JSON the
 * client sends.
 */

export interface CirclePoint {
  x: number
  y: number
}

/** Single circle. `radius` is a fraction of the longest rendered dimension. */
export interface CircleRegion {
  shape: 'circle'
  x: number
  y: number
  radius: number
}

/** Freeform path: a series of points joined as a stroke. */
export interface FreeformRegion {
  shape: 'freeform'
  points: CirclePoint[]
}

export type CommentRegion = CircleRegion | FreeformRegion

/**
 * Tight runtime validator. Returns a sanitised region or null. We don't throw
 * because comments without (or with broken) annotations are still valid.
 */
export function sanitizeRegion(input: unknown): CommentRegion | null {
  if (!input || typeof input !== 'object') return null
  const r = input as Record<string, unknown>

  if (r.shape === 'circle') {
    const x = clamp01(Number(r.x))
    const y = clamp01(Number(r.y))
    const radius = clamp01(Number(r.radius))
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(radius)) return null
    if (radius <= 0) return null
    return { shape: 'circle', x, y, radius }
  }

  if (r.shape === 'freeform') {
    if (!Array.isArray(r.points)) return null
    const points = r.points
      .map((p) => {
        if (!p || typeof p !== 'object') return null
        const px = clamp01(Number((p as { x: unknown }).x))
        const py = clamp01(Number((p as { y: unknown }).y))
        if (!Number.isFinite(px) || !Number.isFinite(py)) return null
        return { x: px, y: py }
      })
      .filter((p): p is CirclePoint => p !== null)
    // A scribble of one point isn't useful; require at least 2 to actually
    // render as a stroke.
    if (points.length < 2) return null
    return { shape: 'freeform', points }
  }

  return null
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return n
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

/** Format seconds as `m:ss` or `h:mm:ss`. */
export function formatTimestamp(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}
