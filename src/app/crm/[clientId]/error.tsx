'use client'

import { useParams } from 'next/navigation'
import { ErrorFallback } from '@/components/ui/ErrorFallback'

export default function CrmError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const params = useParams()
  const clientId = (params?.clientId || params?.clientid) as string | undefined
  const homeHref = clientId ? `/crm/${clientId}/dashboard` : '/clients'
  return <ErrorFallback error={error} reset={reset} homeHref={homeHref} scope="crm" />
}
