'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Header } from '@/components/layout/Header'
import { ContentCreationEngine } from '@/components/dashboard/ContentCreationEngine'
import { ScriptPackageEngine } from '@/components/dashboard/ScriptPackageEngine'
import { QuestionsFormEngine } from '@/components/dashboard/QuestionsFormEngine'
import { SeriesFormEngine } from '@/components/dashboard/SeriesFormEngine'
import { ClipboardList, Package, Sparkles, Layers } from 'lucide-react'
import { cn } from '@/lib/utils'

type Mode = 'package' | 'individual' | 'questions' | 'series'

export default function DashboardPage() {
  const [mode, setMode] = useState<Mode>('package')

  useEffect(() => {
    if (typeof window === 'undefined') return
    const saved = localStorage.getItem('dashboardMode')
    if (
      saved === 'package' ||
      saved === 'individual' ||
      saved === 'questions' ||
      saved === 'series'
    )
      setMode(saved)
  }, [])

  const setModeAndPersist = (m: Mode) => {
    setMode(m)
    if (typeof window !== 'undefined') localStorage.setItem('dashboardMode', m)
  }

  return (
    <div className="min-h-screen">
      <Header
        title="Content Creation Engine"
        subtitle="Generate scripts for your clients using the framework"
      />
      <div className="px-4 pb-12 pt-1 md:px-8 md:pt-3">
        <div className="mx-auto w-full max-w-screen-2xl space-y-6">
          <ModePanel mode={mode} onChange={setModeAndPersist} />

          <div key={mode} className="animate-in fade-in-up">
            {mode === 'package' && <ScriptPackageEngine />}
            {mode === 'individual' && <ContentCreationEngine />}
            {mode === 'questions' && <QuestionsFormEngine />}
            {mode === 'series' && <SeriesFormEngine />}
          </div>
        </div>
      </div>
    </div>
  )
}

const MODES: {
  id: Mode
  label: string
  short: string
  description: string
  icon: React.ComponentType<{ className?: string }>
}[] = [
  {
    id: 'questions',
    label: 'Questions Form',
    short: 'Questions',
    description: 'Generate a question form for clients to fill in braindumps.',
    icon: ClipboardList,
  },
  {
    id: 'series',
    label: 'Series Form',
    short: 'Series',
    description: 'Per-entry intake for a multi-day series. One prompt from real answers.',
    icon: Layers,
  },
  {
    id: 'package',
    label: 'Script Package',
    short: 'Package',
    description: 'One long-form script plus 5 carousels, 5 reels, and 5 stories.',
    icon: Package,
  },
  {
    id: 'individual',
    label: 'Individual Creation',
    short: 'Individual',
    description: 'Generate a single piece of content.',
    icon: Sparkles,
  },
]

function ModePanel({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  const active = MODES.find((m) => m.id === mode) ?? MODES[2]
  const ActiveIcon = active.icon

  const trackRef = useRef<HTMLDivElement>(null)
  const btnRefs = useRef<Partial<Record<Mode, HTMLButtonElement | null>>>({})
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null)

  // Measure the active segment so the sliding thumb tracks its real position.
  // Labels vary in width and the rail scrolls on mobile, so we measure rather
  // than assume equal widths. Recalc on mode change, resize, and rail scroll.
  useLayoutEffect(() => {
    const update = () => {
      const track = trackRef.current
      const btn = btnRefs.current[mode]
      if (!track || !btn) return
      const tr = track.getBoundingClientRect()
      const br = btn.getBoundingClientRect()
      setThumb({ left: br.left - tr.left + track.scrollLeft, width: br.width })
    }
    update()
    // Fonts can settle a frame late and shift widths; re-measure next frame.
    const raf = requestAnimationFrame(update)
    window.addEventListener('resize', update)
    const track = trackRef.current
    track?.addEventListener('scroll', update, { passive: true })
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', update)
      track?.removeEventListener('scroll', update)
    }
  }, [mode])

  return (
    <div className="glass-panel overflow-hidden p-4 sm:p-5">
      <div className="flex flex-col gap-4">
        {/* Segmented mode rail */}
        <div
          ref={trackRef}
          className="glass-rail relative flex items-center gap-1 overflow-x-auto rounded-full p-1 scrollbar-none"
          role="tablist"
          aria-label="Creation mode"
        >
          {thumb && (
            <span
              aria-hidden="true"
              className="glass-thumb pointer-events-none absolute top-1 bottom-1 rounded-full transition-[left,width] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
              style={{ left: thumb.left, width: thumb.width }}
            />
          )}
          {MODES.map((m) => {
            const selected = mode === m.id
            const Icon = m.icon
            return (
              <button
                key={m.id}
                ref={(el) => {
                  btnRefs.current[m.id] = el
                }}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => onChange(m.id)}
                className={cn(
                  'relative z-10 inline-flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors duration-200',
                  selected
                    ? 'text-white'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
                )}
              >
                <Icon className={cn('h-4 w-4 transition-transform', selected && 'drop-shadow')} />
                <span className="hidden sm:inline">{m.label}</span>
                <span className="sm:hidden">{m.short}</span>
              </button>
            )
          })}
        </div>

        {/* Active mode summary */}
        <div className="flex items-center gap-3.5 px-1">
          <div className="relative grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-b from-[#3B82F6] to-[#2B79F7] text-white shadow-[0_8px_22px_-8px_rgba(43,121,247,0.7),inset_0_1px_0_rgba(255,255,255,0.45)]">
            <ActiveIcon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="glass-eyebrow mb-0.5">Mode</div>
            <p className="truncate text-[15px] font-semibold leading-tight text-[var(--text-primary)]">
              {active.label}
            </p>
            <p className="mt-0.5 truncate text-xs text-[var(--text-tertiary)]">
              {active.description}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
