// Hex/HSL helpers for the capture-page theme system.
//
// Used to auto-derive a sensible card surface color from the
// user-picked page background. The rule: card should READ AGAINST the
// page bg - so we shift its lightness opposite to the bg's.

export function hexToHsl(hex: string): [number, number, number] | null {
  const m = hex.trim().match(/^#?([0-9a-f]{6})$/i)
  if (!m) return null
  const n = parseInt(m[1], 16)
  const r = ((n >> 16) & 0xff) / 255
  const g = ((n >> 8) & 0xff) / 255
  const b = (n & 0xff) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  let s = 0
  const l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
  }
  return [h, s, l]
}

export function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(c * 255).toString(16).padStart(2, '0')
  }
  return '#' + f(0) + f(8) + f(4)
}

/** Pick a card surface color that reads cleanly on top of `bg`. The
 *  rule of thumb: light backgrounds get a slightly lighter / more
 *  neutral card. Dark backgrounds get a noticeably lighter card so
 *  text inside the card stays readable. */
export function deriveCardColor(bg: string): string {
  const hsl = hexToHsl(bg)
  if (!hsl) return '#ffffff'
  const [h, s, l] = hsl
  let newL: number
  let newS = s
  if (l > 0.85) {
    // Very light bg → card is pure white-ish, low saturation.
    newL = 1
    newS = 0
  } else if (l > 0.5) {
    // Mid-light bg → card pushed up a few notches.
    newL = Math.min(0.99, l + 0.18)
    newS = Math.min(s, 0.2)
  } else if (l > 0.25) {
    // Mid-dark bg → card is much lighter so text contrast works.
    newL = 0.97
    newS = Math.min(s, 0.08)
  } else {
    // Very dark bg → card is near-white, almost neutral.
    newL = 0.98
    newS = Math.min(s, 0.05)
  }
  return hslToHex(h, newS, newL)
}

/** WCAG relative luminance (0..1). Saturated colors like pure red /
 *  blue have low luminance even though their HSL lightness is 0.5 -
 *  this formula weights channels by perceived brightness so it
 *  matches what the eye sees. */
export function relativeLuminance(hex: string): number {
  const m = hex.trim().match(/^#?([0-9a-f]{6})$/i)
  if (!m) return 0
  const n = parseInt(m[1], 16)
  const r = ((n >> 16) & 0xff) / 255
  const g = ((n >> 8) & 0xff) / 255
  const b = (n & 0xff) / 255
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** True when a color is dark enough that white text reads against it.
 *  Uses WCAG luminance (not HSL lightness) so saturated reds, blues,
 *  purples etc. correctly register as dark and pair with white text. */
export function isColorDark(hex: string): boolean {
  return relativeLuminance(hex) < 0.5
}

/** Shift a hex color's lightness by `delta` (0..1). Positive = lighter,
 *  negative = darker. Clamps to [0, 1]. */
export function shiftLightness(hex: string, delta: number): string {
  const hsl = hexToHsl(hex)
  if (!hsl) return hex
  const [h, s, l] = hsl
  return hslToHex(h, s, Math.max(0, Math.min(1, l + delta)))
}

/** Build the FULL set of CSS custom properties the capture page needs
 *  to render self-contained - independent of the admin's light/dark
 *  theme. Derives every input bg, text shade, and border from the
 *  card color so contrast is always correct.
 *
 *  Apply the returned object as `style` on the outermost layout
 *  element. Tailwind classes inside (`bg-[var(--bg-card)]`,
 *  `text-[var(--text-primary)]`, etc.) automatically pick up the
 *  overrides via CSS cascade. */
export function buildCaptureThemeVars(cardColor: string): Record<string, string> {
  const dark = isColorDark(cardColor)
  if (dark) {
    return {
      '--bg-card': cardColor,
      '--bg-card-hover': shiftLightness(cardColor, 0.07),
      // Input bg shifts MUCH lighter on saturated dark cards so the
      // field surface is clearly distinguishable from the card.
      '--bg-input': shiftLightness(cardColor, 0.14),
      '--bg-secondary': shiftLightness(cardColor, -0.04),
      '--bg-tertiary': shiftLightness(cardColor, 0.08),
      '--text-primary': '#ffffff',
      '--text-secondary': '#e2e8f0',
      '--text-tertiary': '#cbd5e1',
      // Borders use a translucent white so they read on ANY dark hue.
      '--border-primary': 'rgba(255, 255, 255, 0.22)',
      '--border-secondary': 'rgba(255, 255, 255, 0.32)',
    }
  }
  return {
    '--bg-card': cardColor,
    '--bg-card-hover': shiftLightness(cardColor, -0.04),
    // Light-card inputs shift slightly darker so the field stands out
    // from the card surface. Saturated light colors (e.g. cream) get
    // a bigger shift since same-hue inputs would be invisible.
    '--bg-input': shiftLightness(cardColor, -0.04),
    '--bg-secondary': shiftLightness(cardColor, -0.06),
    '--bg-tertiary': shiftLightness(cardColor, -0.08),
    '--text-primary': '#0f172a',
    '--text-secondary': '#334155',
    '--text-tertiary': '#64748b',
    '--border-primary': 'rgba(15, 23, 42, 0.15)',
    '--border-secondary': 'rgba(15, 23, 42, 0.28)',
  }
}
