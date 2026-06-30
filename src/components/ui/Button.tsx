import { cn } from '@/lib/utils'
import { Loader2 } from 'lucide-react'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  isLoading?: boolean
  children: React.ReactNode
}

export function Button({
  variant = 'primary',
  size = 'md',
  isLoading = false,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  const baseStyles = 'relative inline-flex items-center justify-center font-medium rounded-lg transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2B79F7]/70 disabled:opacity-50 disabled:cursor-not-allowed'

  const variants = {
    // Vertical brand gradient with a lit top edge + soft brand glow, so the
    // primary action reads as a raised glass control on the dark canvas.
    primary:
      'btn-premium text-white bg-gradient-to-b from-[#3B82F6] to-[#2B79F7] border border-[#2B79F7]/50 shadow-[0_8px_20px_-6px_rgba(43,121,247,0.55),inset_0_1px_0_rgba(255,255,255,0.35)] hover:from-[#4A8BFF] hover:to-[#357CF5] hover:shadow-[0_12px_28px_-6px_rgba(43,121,247,0.7),inset_0_1px_0_rgba(255,255,255,0.4)]',
    // Secondary + outline are frosted glass chips: translucent surface, hairline
    // border, lit top edge - so card/page actions read as glass on the canvas.
    secondary:
      'bg-[var(--glass-bg)] border border-[var(--glass-border)] text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] hover:border-[#2B79F7]/50 shadow-[inset_0_1px_0_var(--glass-highlight)]',
    outline:
      'bg-[var(--glass-bg)] border border-[var(--glass-border)] text-[var(--text-primary)] hover:text-[#2B79F7] hover:bg-[var(--bg-card-hover)] hover:border-[#2B79F7]/50 shadow-[inset_0_1px_0_var(--glass-highlight)]',
    ghost: 'text-[#2B79F7] hover:bg-[#2B79F7]/10',
  }

  const sizes = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-sm',
    lg: 'px-6 py-3 text-base',
  }

  return (
    <button
      className={cn(baseStyles, variants[variant], sizes[size], className)}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
      {children}
    </button>
  )
}