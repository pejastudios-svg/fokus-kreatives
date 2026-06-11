import { createClient as createServiceClient } from '@supabase/supabase-js'

/**
 * Fire-and-forget logging of successful email sends into email_send_log.
 * Powers the quota display in Settings. Failures are swallowed - a logging
 * hiccup must never break an email that already went out.
 */
export async function logEmailSend(args: {
  clientId?: string | null
  channel: 'smtp' | 'apps_script'
  type: string
  /** Recipient count for this send. Google's quota is consumed per
   *  recipient (to + cc each cost 1), so a 3-recipient email logs 3
   *  rows - keeps the Settings readout aligned with real consumption. */
  count?: number
}): Promise<void> {
  try {
    const count = Math.max(1, Math.floor(args.count ?? 1))
    const db = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
    await db.from('email_send_log').insert(
      Array.from({ length: count }, () => ({
        client_id: args.clientId ?? null,
        channel: args.channel,
        type: args.type,
      })),
    )
  } catch (e) {
    console.error('[sendLog] insert failed (non-fatal):', e)
  }
}
