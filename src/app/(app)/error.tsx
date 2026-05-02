'use client'

import { ErrorFallback } from '@/components/ui/ErrorFallback'

export default function AgencyError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return <ErrorFallback error={error} reset={reset} homeHref="/dashboard" scope="agency" />
}
