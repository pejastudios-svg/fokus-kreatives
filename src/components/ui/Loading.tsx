'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'

interface LoadingProps {
  fullScreen?: boolean
  size?: 'xs' | 'sm' | 'md' | 'lg'
  text?: string
  inline?: boolean
}

export function Loading({ fullScreen = false, size = 'md', text, inline = false }: LoadingProps) {
  const [pulse, setPulse] = useState(true)

  useEffect(() => {
    const interval = setInterval(() => {
      setPulse(prev => !prev)
    }, 800)
    return () => clearInterval(interval)
  }, [])

  const sizes = {
    xs: { logo: 16, container: 'p-1' },
    sm: { logo: 24, container: 'p-2' },
    md: { logo: 40, container: 'p-4' },
    lg: { logo: 60, container: 'p-6' },
  }

  const content = (
    <div className={`flex ${inline ? 'inline-flex' : 'flex-col'} items-center justify-center gap-2 ${sizes[size].container}`}>
      <div 
        className="animate-spin-slow transition-opacity duration-500"
        style={{ opacity: pulse ? 1 : 0.5 }}
      >
        <Image
          src="https://silly-blue-r3z2xucguf.edgeone.app/FOKUS%20CREATIVES%20logo.png"
          alt="Loading..."
          width={sizes[size].logo}
          height={sizes[size].logo}
          className="object-contain"
          priority
        />
      </div>
      {text && (
        <p className="text-sm text-theme-secondary animate-pulse-soft">
          {text}
        </p>
      )}
    </div>
  )

  if (fullScreen) {
    return (
      <div className="fixed inset-0 bg-theme-primary flex items-center justify-center z-50">
        {content}
      </div>
    )
  }

  return content
}

// Inline loading indicator for optimistic updates
export function InlineLoading({ text }: { text?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-theme-tertiary text-xs">
      <Loading size="xs" inline />
      {text && <span>{text}</span>}
    </span>
  )
}

// Skeleton loader for content
export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`animate-pulse bg-gray-200/80 rounded ${className}`} />
  )
}