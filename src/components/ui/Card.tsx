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
        // Frosted glass surface (see .glass-card in globals.css): translucent
        // raised fill + top sheen + luminous hairline border + layered shadow.
        'glass-card',
        hover && 'glass-card-hover cursor-pointer',
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