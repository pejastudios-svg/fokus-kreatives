import { deliverEmail, enqueueEmail } from '@/lib/emailOutbox'

/**
 * Send an agreement email now; if the immediate attempt fails, fall back
 * to the durable outbox so the cron worker retries with backoff instead
 * of the notification silently dying. Returns true when it went out on
 * the first attempt.
 */
export async function sendAgreementEmail(
  type: 'agreement_sent' | 'agreement_signed',
  payload: Record<string, unknown>,
  idempotencyKey: string,
): Promise<boolean> {
  try {
    await deliverEmail({ id: '', type, payload, attempts: 0 })
    return true
  } catch (err) {
    console.error(`[agreements] immediate ${type} send failed, queueing:`, err)
    await enqueueEmail({ type, payload, idempotencyKey })
    return false
  }
}

/** Public signing page URL for an agreement token. */
export function agreementUrl(token: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '')
  return `${base}/agreement/${token}`
}
