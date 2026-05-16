import { createBrowserClient } from '@supabase/ssr'

// Memoize the browser client to a single instance per browser session.
// Before this, every `createClient()` call returned a fresh instance,
// which meant `const supabase = createClient()` at the top of a React
// component got a new identity on each render. That cascaded through
// useCallback/useEffect deps and made data-fetch effects re-run
// repeatedly, flickering skeleton loaders on the CRM pages.
//
// Supabase ships one auth session per browser anyway, so reusing the
// same client is the recommended pattern (matches the docs' SSR
// example for App Router).
//
// The closure pattern below preserves the exact inferred return type
// the original implementation had - call sites depend on it for
// query-result type inference. Annotating with a generic alias of
// createBrowserClient's return type picks a different overload than
// the bare call did, which silently breaks downstream `.map((m) =>
// m.x)` inference. Using `typeof build` keeps the inferred shape.
function build() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}

let cached: ReturnType<typeof build> | null = null

export function createClient() {
  if (!cached) cached = build()
  return cached
}