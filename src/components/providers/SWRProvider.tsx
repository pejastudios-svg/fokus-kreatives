'use client'

// App-wide SWR config. Mounted at the agency app root so every
// useSWR() call inside the agency pages picks up the default fetcher
// + sane revalidation defaults.
//
// Why these defaults:
//   - `revalidateOnFocus: false` matches the existing app's UX - the
//     dashboard doesn't refetch the world when you alt-tab back.
//   - `revalidateOnReconnect: true` makes the app self-heal after a
//     wifi blip.
//   - `dedupingInterval: 30s` - if two components ask for the same
//     key in quick succession, only one network request goes out.
//   - `keepPreviousData: true` - when a key's args change (e.g.
//     /api/x?range=7d -> /api/x?range=30d), the old data stays
//     visible while the new fetch runs. Prevents "flash to spinner".
//
// Pages opt in by importing useSWR. Nothing happens automatically -
// existing useEffect+fetch patterns keep working unchanged.

import { SWRConfig } from 'swr'
import { fetcher } from '@/lib/swr/fetcher'

export function SWRProvider({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        fetcher,
        revalidateOnFocus: false,
        revalidateOnReconnect: true,
        dedupingInterval: 30_000,
        keepPreviousData: true,
        // Errors propagate to the page so it can surface them; no
        // global toast/log here. Pages already have their own error
        // handling state.
        shouldRetryOnError: false,
      }}
    >
      {children}
    </SWRConfig>
  )
}
