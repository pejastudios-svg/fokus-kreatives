import { cn } from '@/lib/utils'
import type React from 'react'

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  hover?: boolean
}

export function Card({ children, className, hover = false, ...props }: CardProps) {
  return (
    <div
      {...props}
      className={cn(
        // The shadow stack: a soft drop shadow (lifts the card off the page)
        // plus an inset top highlight (gives a subtle "raised surface" look
        // in dark mode where a flat fill on a dark bg can read as flat).
        // Both work in light mode too - the inset is barely visible there.
        'bg-[var(--bg-card)] rounded-xl border border-[var(--border-primary)]',
        'shadow-[0_1px_2px_rgb(0_0_0/0.06),inset_0_1px_0_rgb(255_255_255/0.04)]',
        hover && 'hover:bg-[var(--bg-card-hover)] hover:shadow-[0_4px_12px_rgb(0_0_0/0.12),inset_0_1px_0_rgb(255_255_255/0.06)] transition-all duration-200 cursor-pointer',
        className
      )}
    >
      {children}
    </div>
  )
}

export function CardHeader({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('px-5 py-3 border-b border-[var(--border-primary)]', className)}>{children}</div>
}

export function CardContent({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('px-5 py-4', className)}>{children}</div>
}