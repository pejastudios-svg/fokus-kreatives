'use client'

import { useEffect, useState } from 'react'
import { Save, Check } from 'lucide-react'

type Phase = 'idle' | 'saving' | 'saved'

/**
 * Tiny inline save status. Shows the Save icon while `isSaving` is true,
 * cross-fades to a Check icon for ~1.2s after a save completes, then
 * fades away. Pure visual feedback - no layout cost when idle.
 */
export function SaveIndicator({ isSaving }: { isSaving: boolean }) {
  const [phase, setPhase] = useState<Phase>('idle')

  useEffect(() => {
    if (isSaving) {
      setPhase('saving')
      return
    }
    if (phase === 'saving') {
      setPhase('saved')
      const t = setTimeout(() => setPhase('idle'), 1200)
      return () => clearTimeout(t)
    }
  }, [isSaving, phase])

  return (
    <span
      className={`inline-flex items-center justify-center h-6 w-6 rounded-full transition-all duration-200 ${
        phase === 'idle'
          ? 'opacity-0 scale-75 pointer-events-none'
          : phase === 'saving'
            ? 'opacity-100 scale-100 bg-blue-50 text-[#2B79F7]'
            : 'opacity-100 scale-100 bg-emerald-50 text-emerald-600'
      }`}
      aria-live="polite"
      aria-label={phase === 'saving' ? 'Saving' : phase === 'saved' ? 'Saved' : 'Idle'}
    >
      {phase === 'saved' ? (
        <Check className="h-3.5 w-3.5" />
      ) : (
        <Save className={`h-3.5 w-3.5 ${phase === 'saving' ? 'animate-pulse' : ''}`} />
      )}
    </span>
  )
}
