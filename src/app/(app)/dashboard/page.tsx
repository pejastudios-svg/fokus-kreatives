'use client'

import { useEffect, useState } from 'react'
import { Header } from '@/components/layout/Header'
import { ContentCreationEngine } from '@/components/dashboard/ContentCreationEngine'
import { ScriptPackageEngine } from '@/components/dashboard/ScriptPackageEngine'
import { QuestionsFormEngine } from '@/components/dashboard/QuestionsFormEngine'
import { SeriesFormEngine } from '@/components/dashboard/SeriesFormEngine'
import { ClipboardList, Package, Sparkles, Layers } from 'lucide-react'

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
    <>
      <Header
        title="Content Creation Engine"
        subtitle="Generate scripts for your clients using the framework"
      />
      <div className="p-4 md:p-8">
        <ModeSwitcher mode={mode} onChange={setModeAndPersist} />

        <div className="mt-6">
          {mode === 'package' && <ScriptPackageEngine />}
          {mode === 'individual' && <ContentCreationEngine />}
          {mode === 'questions' && <QuestionsFormEngine />}
          {mode === 'series' && <SeriesFormEngine />}
        </div>
      </div>
    </>
  )
}

const MODES: { id: Mode; label: string; description: string; icon: React.ComponentType<{ className?: string }> }[] = [
  {
    id: 'questions',
    label: 'Questions Form',
    description: 'Generate a question form for clients to fill in braindumps.',
    icon: ClipboardList,
  },
  {
    id: 'series',
    label: 'Series Form',
    description: 'Per-entry intake for a multi-day series. One prompt from real answers.',
    icon: Layers,
  },
  {
    id: 'package',
    label: 'Script Package',
    description: 'One long-form script + 5 carousels, 5 reels, 5 stories.',
    icon: Package,
  },
  {
    id: 'individual',
    label: 'Individual Creation',
    description: 'Generate a single piece of content.',
    icon: Sparkles,
  },
]

function ModeSwitcher({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  const active = MODES.find((m) => m.id === mode)
  return (
    <div className="space-y-2">
      <div className="flex justify-center sm:justify-start">
        <div className="inline-flex items-center gap-1 p-1 rounded-full border border-theme-primary bg-theme-card max-w-full overflow-x-auto scrollbar-none">
          {MODES.map((m) => {
            const selected = mode === m.id
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => onChange(m.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all shrink-0 ${
                  selected
                    ? 'bg-[#2B79F7] text-white shadow-sm'
                    : 'text-theme-secondary hover:text-theme-primary hover:bg-theme-card-hover'
                }`}
              >
                <m.icon className="h-3.5 w-3.5" />
                <span>{m.label}</span>
              </button>
            )
          })}
        </div>
      </div>
      {active && (
        <p className="text-[11px] text-theme-tertiary px-1 text-center sm:text-left">{active.description}</p>
      )}
    </div>
  )
}

