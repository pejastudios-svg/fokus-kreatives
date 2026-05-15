'use client'

// Theme + color picker for the capture page builder. Three modes:
//   - Preset palettes: tap a swatch, background gets a tasteful color
//   - Solid custom: pick any single color
//   - Gradient custom: two colors + direction
//
// The card surface in each layout is `var(--bg-card)` (white in light,
// dark navy in dark). The picker controls the PAGE background only -
// the card stays themed by the app palette. This is how Tally works
// too: pages have a colored backdrop, the form card stays clean.

import { useState } from 'react'
import { Palette, Check } from 'lucide-react'
import { deriveCardColor } from './colorUtils'
import type { CaptureTheme } from './types'

interface PresetSwatch {
  key: string
  label: string
  /** Card surface color (the form area). Required - the picker now
   *  drives both the page bg AND the card. */
  cardColor: string
  /** Single solid background color. */
  solid?: string
  /** Or a gradient: `from` + `to` + direction. */
  gradient?: { from: string; to: string; direction: string }
}

// Hand-picked palettes. Each pair (bg, card) is curated so the form
// reads cleanly against the page. Light bg → near-white card. Dark
// bg → bright card so text contrast works.
const PRESETS: PresetSwatch[] = [
  { key: 'neutral', label: 'Neutral', solid: '#f9fafb', cardColor: '#ffffff' },
  { key: 'slate', label: 'Slate', solid: '#cbd5e1', cardColor: '#f8fafc' },
  { key: 'cream', label: 'Cream', solid: '#fde68a', cardColor: '#fffbeb' },
  { key: 'mint', label: 'Mint', solid: '#86efac', cardColor: '#f0fdf4' },
  { key: 'sky', label: 'Sky', solid: '#7dd3fc', cardColor: '#f0f9ff' },
  { key: 'lavender', label: 'Lavender', solid: '#c4b5fd', cardColor: '#faf5ff' },
  { key: 'rose', label: 'Rose', solid: '#fda4af', cardColor: '#fff1f2' },
  { key: 'ink', label: 'Ink', solid: '#0f172a', cardColor: '#1e293b' },
  {
    key: 'sunset',
    label: 'Sunset',
    gradient: { from: '#fb7185', to: '#fbbf24', direction: '135deg' },
    cardColor: '#fffbeb',
  },
  {
    key: 'ocean',
    label: 'Ocean',
    gradient: { from: '#2B79F7', to: '#1E54B7', direction: '135deg' },
    cardColor: '#f8fafc',
  },
  {
    key: 'forest',
    label: 'Forest',
    gradient: { from: '#10b981', to: '#064e3b', direction: '135deg' },
    cardColor: '#f0fdf4',
  },
  {
    key: 'aurora',
    label: 'Aurora',
    gradient: { from: '#a78bfa', to: '#60a5fa', direction: '135deg' },
    cardColor: '#faf5ff',
  },
]

interface Props {
  value: CaptureTheme
  onChange: (next: CaptureTheme) => void
}

export function ThemePicker({ value, onChange }: Props) {
  const bg = value.background
  const currentType = bg?.type ?? 'solid'
  const [mode, setMode] = useState<'preset' | 'custom'>('preset')

  // Map current value back to a preset key for the "active" highlight.
  const activePreset = (() => {
    if (currentType === 'solid' && bg?.color) {
      return PRESETS.find((p) => p.solid?.toLowerCase() === bg.color?.toLowerCase())?.key ?? null
    }
    if (currentType === 'gradient' && bg?.from && bg?.to) {
      return (
        PRESETS.find(
          (p) =>
            p.gradient?.from.toLowerCase() === bg.from?.toLowerCase()
            && p.gradient?.to.toLowerCase() === bg.to?.toLowerCase(),
        )?.key ?? null
      )
    }
    return null
  })()

  const applyPreset = (p: PresetSwatch) => {
    if (p.solid) {
      onChange({
        ...value,
        background: { type: 'solid', color: p.solid },
        cardColor: p.cardColor,
      })
    } else if (p.gradient) {
      onChange({
        ...value,
        background: {
          type: 'gradient',
          from: p.gradient.from,
          to: p.gradient.to,
          direction: p.gradient.direction,
        },
        cardColor: p.cardColor,
      })
    }
  }

  const updateSolid = (color: string) => {
    onChange({
      ...value,
      background: { type: 'solid', color },
      // Auto-derive a complementary card shade so the picked color
      // shows on the page AND the card stays readable.
      cardColor: deriveCardColor(color),
    })
  }
  const updateGradient = (patch: Partial<{ from: string; to: string; direction: string }>) => {
    const from = patch.from ?? bg?.from ?? '#2B79F7'
    const to = patch.to ?? bg?.to ?? '#1E54B7'
    onChange({
      ...value,
      background: {
        type: 'gradient',
        from,
        to,
        direction: patch.direction ?? bg?.direction ?? '135deg',
      },
      // For gradients, derive from the `from` color - it's typically
      // the visually dominant half on the upper-left.
      cardColor: deriveCardColor(from),
    })
  }

  const swatchBg = (p: PresetSwatch): string => {
    if (p.solid) return p.solid
    if (p.gradient) {
      return `linear-gradient(${p.gradient.direction}, ${p.gradient.from}, ${p.gradient.to})`
    }
    return '#f9fafb'
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Palette className="h-4 w-4 text-[#2B79F7]" />
        <span className="text-sm font-semibold text-[var(--text-primary)]">Colors</span>
      </div>

      <div className="flex items-center gap-1 rounded-md border border-[var(--border-primary)] p-0.5 w-fit">
        {(['preset', 'custom'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`px-3 py-1 text-xs rounded transition-colors ${
              mode === m
                ? 'bg-[#2B79F7] text-white'
                : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {m === 'preset' ? 'Presets' : 'Custom'}
          </button>
        ))}
      </div>

      {mode === 'preset' ? (
        <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
          {PRESETS.map((p) => {
            const active = activePreset === p.key
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => applyPreset(p)}
                title={p.label}
                className={`relative aspect-square rounded-lg border-2 transition-all ${
                  active
                    ? 'border-[#2B79F7] scale-105 shadow-sm'
                    : 'border-[var(--border-primary)] hover:border-[var(--text-tertiary)]'
                }`}
                style={{ background: swatchBg(p) }}
              >
                {active && (
                  <span className="absolute inset-0 flex items-center justify-center">
                    <Check className="h-4 w-4 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]" />
                  </span>
                )}
              </button>
            )
          })}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-1 rounded-md border border-[var(--border-primary)] p-0.5 w-fit">
            {(['solid', 'gradient'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() =>
                  t === 'solid'
                    ? updateSolid(bg?.color || '#f9fafb')
                    : updateGradient({})
                }
                className={`px-3 py-1 text-xs rounded transition-colors ${
                  currentType === t
                    ? 'bg-[#2B79F7] text-white'
                    : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {t === 'solid' ? 'Solid' : 'Gradient'}
              </button>
            ))}
          </div>

          {currentType === 'solid' ? (
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={bg?.color || '#f9fafb'}
                onChange={(e) => updateSolid(e.target.value)}
                className="h-10 w-14 rounded border border-[var(--border-primary)] cursor-pointer bg-transparent"
              />
              <input
                type="text"
                value={bg?.color || '#f9fafb'}
                onChange={(e) => updateSolid(e.target.value)}
                placeholder="#hex"
                className="flex-1 px-3 py-2 text-sm rounded border border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[#2B79F7] font-mono"
              />
            </div>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">From</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={bg?.from || '#2B79F7'}
                      onChange={(e) => updateGradient({ from: e.target.value })}
                      className="h-9 w-12 rounded border border-[var(--border-primary)] cursor-pointer bg-transparent"
                    />
                    <input
                      type="text"
                      value={bg?.from || '#2B79F7'}
                      onChange={(e) => updateGradient({ from: e.target.value })}
                      placeholder="#hex"
                      className="flex-1 min-w-0 px-2 py-1.5 text-xs rounded border border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[#2B79F7] font-mono"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">To</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={bg?.to || '#1E54B7'}
                      onChange={(e) => updateGradient({ to: e.target.value })}
                      className="h-9 w-12 rounded border border-[var(--border-primary)] cursor-pointer bg-transparent"
                    />
                    <input
                      type="text"
                      value={bg?.to || '#1E54B7'}
                      onChange={(e) => updateGradient({ to: e.target.value })}
                      placeholder="#hex"
                      className="flex-1 min-w-0 px-2 py-1.5 text-xs rounded border border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[#2B79F7] font-mono"
                    />
                  </div>
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">Direction</label>
                <div className="grid grid-cols-4 gap-1">
                  {[
                    { dir: '0deg', label: '↑' },
                    { dir: '45deg', label: '↗' },
                    { dir: '90deg', label: '→' },
                    { dir: '135deg', label: '↘' },
                    { dir: '180deg', label: '↓' },
                    { dir: '225deg', label: '↙' },
                    { dir: '270deg', label: '←' },
                    { dir: '315deg', label: '↖' },
                  ].map((d) => {
                    const active = (bg?.direction || '135deg') === d.dir
                    return (
                      <button
                        key={d.dir}
                        type="button"
                        onClick={() => updateGradient({ direction: d.dir })}
                        className={`py-1.5 text-base rounded border transition-colors ${
                          active
                            ? 'border-[#2B79F7] bg-[#2B79F7]/10 text-[#2B79F7]'
                            : 'border-[var(--border-primary)] text-[var(--text-secondary)] hover:border-[var(--text-tertiary)]'
                        }`}
                      >
                        {d.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Card surface - independent picker so the user can set
              bg and card colors separately rather than relying on the
              auto-derived shade. Auto-fill button restores the
              derived value if they want it back. */}
          <div className="space-y-1 pt-2 border-t border-[var(--border-primary)]">
            <div className="flex items-center justify-between">
              <label className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
                Card surface
              </label>
              <button
                type="button"
                onClick={() => {
                  const base =
                    currentType === 'gradient'
                      ? bg?.from || '#2B79F7'
                      : bg?.color || '#f9fafb'
                  onChange({ ...value, cardColor: deriveCardColor(base) })
                }}
                className="text-[10px] text-[#2B79F7] hover:underline"
              >
                Auto from background
              </button>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={value.cardColor || '#ffffff'}
                onChange={(e) => onChange({ ...value, cardColor: e.target.value })}
                className="h-9 w-12 rounded border border-[var(--border-primary)] cursor-pointer bg-transparent"
              />
              <input
                type="text"
                value={value.cardColor || '#ffffff'}
                onChange={(e) => onChange({ ...value, cardColor: e.target.value })}
                placeholder="#hex"
                className="flex-1 min-w-0 px-2 py-1.5 text-xs rounded border border-[var(--border-primary)] bg-[var(--bg-input)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[#2B79F7] font-mono"
              />
            </div>
            <p className="text-[10px] text-[var(--text-tertiary)] leading-snug">
              Text + input colors auto-adjust based on this color’s brightness.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
