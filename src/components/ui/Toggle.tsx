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
  const track = size === 'sm' ? 'w-9 h-5' : 'w-11 h-6'
  const knob = size === 'sm' ? 'h-4 w-4' : 'h-5 w-5'
  const translate = size === 'sm' ? 'translate-x-4' : 'translate-x-5'

  const toggle = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={cn(
        'relative inline-flex shrink-0 items-center rounded-full border-2 border-transparent',
        'transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-[#2B79F7] focus:ring-offset-2',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        track,
        checked ? 'bg-[#2B79F7]' : 'bg-gray-300',
      )}
    >
      <span
        className={cn(
          'pointer-events-none inline-block transform rounded-full bg-white shadow ring-0',
          'transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]',
          knob,
          checked ? translate : 'translate-x-0',
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
        {label && <span className="block text-sm font-medium text-gray-800">{label}</span>}
        {description && <span className="block text-xs text-gray-500 mt-0.5">{description}</span>}
      </span>
    </label>
  )
}
