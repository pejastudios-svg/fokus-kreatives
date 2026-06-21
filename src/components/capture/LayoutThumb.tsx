'use client'

// Small visual thumbnail per layout template, shown in the picker grid
// in the capture-page builder modal. Each one is a tiny abstract
// composition: pill = content/form, square = image. Communicates the
// shape of the layout without showing actual content.

import type { LayoutTemplate } from './types'

interface Props {
  kind: LayoutTemplate
  active: boolean
}

export function LayoutThumb({ kind, active }: Props) {
  const accent = active ? 'bg-[#2B79F7]' : 'bg-[var(--text-tertiary)]'
  const muted = active ? 'bg-[#2B79F7]/30' : 'bg-[var(--border-primary)]'
  const ring = active ? 'border-[#2B79F7]' : 'border-[var(--border-primary)]'

  const box = `rounded-md border ${ring} bg-[var(--bg-secondary)] aspect-[4/3] w-full p-1.5 relative overflow-hidden`

  switch (kind) {
    case 'compact':
      return (
        <div className={box}>
          <div className="absolute inset-x-2 top-1.5 h-2 rounded bg-[var(--border-primary)]" />
          <div className="absolute inset-x-4 top-5 bottom-2 rounded bg-[var(--bg-card)] border border-[var(--border-primary)] flex flex-col gap-0.5 p-1">
            <div className={`h-1 rounded ${accent} w-2/3`} />
            <div className={`h-0.5 rounded ${muted} w-3/4`} />
            <div className={`mt-auto h-1 rounded ${accent} w-full`} />
          </div>
        </div>
      )
    case 'split-right':
      return (
        <div className={box}>
          <div className="absolute inset-y-0 left-0 w-1/2 p-1 flex flex-col gap-0.5">
            <div className={`h-1 rounded ${accent} w-3/4 mt-2`} />
            <div className={`h-0.5 rounded ${muted} w-2/3`} />
            <div className={`mt-1 h-1 rounded ${muted}`} />
            <div className={`mt-auto mb-1 h-1.5 rounded ${accent}`} />
          </div>
          <div className={`absolute inset-y-0 right-0 w-1/2 ${muted}`} />
        </div>
      )
    case 'split-left':
      return (
        <div className={box}>
          <div className={`absolute inset-y-0 left-0 w-1/2 ${muted}`} />
          <div className="absolute inset-y-0 right-0 w-1/2 p-1 flex flex-col gap-0.5">
            <div className={`h-1 rounded ${accent} w-3/4 mt-2`} />
            <div className={`h-0.5 rounded ${muted} w-2/3`} />
            <div className={`mt-1 h-1 rounded ${muted}`} />
            <div className={`mt-auto mb-1 h-1.5 rounded ${accent}`} />
          </div>
        </div>
      )
    case 'hero-overlay':
      return (
        <div className={box}>
          <div className={`absolute inset-0 ${muted}`} />
          <div className="absolute inset-3 rounded bg-[var(--bg-card)] border border-[var(--border-primary)] p-1 flex flex-col gap-0.5">
            <div className={`h-1 rounded ${accent} w-2/3`} />
            <div className={`h-0.5 rounded ${muted} w-3/4`} />
            <div className={`mt-auto h-1 rounded ${accent} w-full`} />
          </div>
        </div>
      )
    case 'banner-top':
      return (
        <div className={box}>
          <div className={`absolute inset-x-1 top-1 h-1/3 rounded ${muted}`} />
          <div className="absolute inset-x-3 bottom-1.5 top-[45%] rounded bg-[var(--bg-card)] border border-[var(--border-primary)] flex flex-col gap-0.5 p-1">
            <div className={`h-0.5 rounded ${accent} w-2/3 mx-auto`} />
            <div className={`mt-auto h-1 rounded ${accent}`} />
          </div>
        </div>
      )
    case 'minimal':
      return (
        <div className={box}>
          <div className="absolute inset-x-3 top-3 bottom-2 flex flex-col gap-0.5 items-center">
            <div className={`h-1.5 rounded ${accent} w-2/3`} />
            <div className={`h-0.5 rounded ${muted} w-1/2 mt-0.5`} />
            <div className={`mt-2 h-1 rounded ${muted} w-full`} />
            <div className={`mt-0.5 h-1 rounded ${muted} w-full`} />
            <div className={`mt-auto h-1.5 rounded ${accent} w-full`} />
          </div>
        </div>
      )
    case 'landing':
      return (
        <div className={box}>
          <div className="absolute inset-x-2 top-1.5 bottom-1.5 flex flex-col gap-0.5">
            <div className={`h-1.5 rounded ${accent} w-2/3 mx-auto`} />
            <div className={`h-0.5 rounded ${muted} w-1/2 mx-auto`} />
            <div className={`mt-0.5 h-1.5 rounded ${accent} w-1/3 mx-auto`} />
            <div className={`mt-1 h-2 rounded ${muted} w-full`} />
            <div className={`mt-auto h-2.5 rounded bg-[var(--bg-card)] border border-[var(--border-primary)] w-full`} />
          </div>
        </div>
      )
  }
}
