// Service-role Supabase client for admin endpoints. The admin dashboard
// is gated by checkAdminAccess() upstream, so once a route reaches the
// query layer we already know the caller is allowed to see cross-client
// data. RLS would otherwise block the cross-client aggregation.

import { createClient as createServiceClient } from '@supabase/supabase-js'

export function adminDb() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}
