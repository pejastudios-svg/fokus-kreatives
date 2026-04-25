'use client'

import { useEffect, useState } from 'react'
import { Header } from '@/components/layout/Header'
import { ContentCreationEngine } from '@/components/dashboard/ContentCreationEngine'
import { ScriptPackageEngine } from '@/components/dashboard/ScriptPackageEngine'
import { QuestionsFormEngine } from '@/components/dashboard/QuestionsFormEngine'
import { ClipboardList, Package, Sparkles, ArrowRight } from 'lucide-react'

type Mode = 'package' | 'individual' | 'questions'

export default function DashboardPage() {
  const [mode, setMode] = useState<Mode>('package')

  useEffect(() => {
    if (typeof window === 'undefined') return
    const saved = localStorage.getItem('dashboardMode')
    if (saved === 'package' || saved === 'individual' || saved === 'questions') setMode(saved)
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
    id: 'package',
    label: 'Script Package',
    description: 'One long-form script + 10 carousels, 10 reels, 10 stories.',
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
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {MODES.map((m) => {
        const selected = mode === m.id
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => onChange(m.id)}
            className={`text-left p-4 rounded-xl border-2 transition-all ${
              selected
                ? 'border-[#2B79F7] bg-[#E8F1FF] shadow-premium'
                : 'border-theme-primary hover:border-[#5A9AFF] bg-theme-card'
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <m.icon className={`h-5 w-5 ${selected ? 'text-[#2B79F7]' : 'text-theme-secondary'}`} />
              <h3 className={`text-sm font-semibold ${selected ? 'text-[#2B79F7]' : 'text-theme-primary'}`}>
                {m.label}
              </h3>
              {selected && <ArrowRight className="ml-auto h-4 w-4 text-[#2B79F7]" />}
            </div>
            <p className="text-xs text-theme-secondary">{m.description}</p>
          </button>
        )
      })}
    </div>
  )
}

