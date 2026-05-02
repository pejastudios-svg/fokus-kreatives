'use client'

import { useEffect } from 'react'
import { AlertTriangle, RefreshCw, Home } from 'lucide-react'
import Link from 'next/link'

interface ErrorFallbackProps {
  error: Error & { digest?: string }
  reset: () => void
  homeHref?: string
  scope?: string
}

export function ErrorFallback({ error, reset, homeHref = '/dashboard', scope }: ErrorFallbackProps) {
  useEffect(() => {
    // Surface the real error in dev tools without leaking it to the UI.
    // The digest is what server-side ErrorBoundary attaches in prod builds.
    console.error(`[${scope || 'app'}]`, error, error.digest ? `(digest: ${error.digest})` : '')
  }, [error, scope])

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="w-full max-w-sm text-center space-y-5">
        <div className="mx-auto h-14 w-14 rounded-full bg-red-500/15 text-red-500 flex items-center justify-center">
          <AlertTriangle className="h-7 w-7" />
        </div>
        <div className="space-y-1.5">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            Something went wrong
          </h2>
          <p className="text-sm text-[var(--text-tertiary)]">
            We hit an unexpected snag loading this page. You can retry, head home, or try again in a moment.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 justify-center">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-[#2B79F7] text-white text-sm font-medium hover:bg-[#1E54B7] transition-colors"
          >
            <RefreshCw className="h-4 w-4" />
            Try again
          </button>
          <Link
            href={homeHref}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg border border-[var(--border-primary)] text-[var(--text-secondary)] text-sm font-medium hover:bg-[var(--bg-card-hover)] transition-colors"
          >
            <Home className="h-4 w-4" />
            Go home
          </Link>
        </div>
      </div>
    </div>
  )
}
