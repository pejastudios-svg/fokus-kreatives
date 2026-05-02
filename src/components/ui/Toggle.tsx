'use client'

import { cn } from '@/lib/utils'

interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: string
  description?: string
  disabled?: boolean
  size?: 'sm' | 'md'
  className?: string
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled = false,
  size = 'md',
  className,
}: ToggleProps) {
  // Tightened: previous "md" was visually heavy. New default sits between
  // the old sm and md. The `sm` option is now even more compact for inline
  // table rows etc.
  const track = size === 'sm' ? 'w-8 h-4' : 'w-10 h-5'
  const knob = size === 'sm' ? 'h-3 w-3' : 'h-4 w-4'
  const translate = size === 'sm' ? 'translate-x-4' : 'translate-x-5'

  // Bounce: cubic-bezier overshoots past the end-state by ~10%, then settles.
  // The knob also briefly scales up during the flip for an extra spring feel.
  const toggle = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={cn(
        'relative inline-flex shrink-0 items-center rounded-full border-2 border-transparent',
        'transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-[#2B79F7] focus:ring-offset-2 focus:ring-offset-[var(--bg-primary)]',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        track,
        // Off state uses a mid-tone gray so the white knob is visible in
        // both light and dark themes (--bg-tertiary is too pale in light
        // mode). On = brand blue; same in both themes by design.
        checked ? 'bg-[#2B79F7]' : 'bg-[var(--border-secondary)]',
      )}
    >
      <span
        className={cn(
          'pointer-events-none inline-block transform rounded-full bg-[var(--bg-card)] shadow-md ring-0',
          'transition-all duration-[420ms] ease-[cubic-bezier(0.5,1.65,0.55,1)]',
          knob,
          checked ? `${translate} scale-110` : 'translate-x-0 scale-100',
        )}
      />
    </button>
  )

  if (!label && !description) {
    return <span className={className}>{toggle}</span>
  }

  return (
    <label
      className={cn(
        'flex items-center gap-3 cursor-pointer select-none',
        disabled && 'cursor-not-allowed opacity-60',
        className,
      )}
    >
      {toggle}
      <span className="flex-1 min-w-0">
        {label && <span className="block text-sm font-medium text-[var(--text-primary)]">{label}</span>}
        {description && <span className="block text-xs text-[var(--text-tertiary)] mt-0.5">{description}</span>}
      </span>
    </label>
  )
}
