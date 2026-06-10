import { createClient as createServiceClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'
import { decryptSecret } from '@/lib/crypto/secretBox'
import { renderOutwardEmail } from './templates'

/**
 * Gmail SMTP "send as" path (white-label option 2).
 *
 * Clients connect their Gmail with an app password (stored AES-256-GCM
 * encrypted in user_integrations, provider='gmail_smtp'). Outward emails for
 * a connected client are sent through smtp.gmail.com AS the client - real
 * envelope-from, their avatar, no "via" - instead of the agency Apps Script
 * account.
 *
 * Resilience contract: trySmtpSend NEVER throws. It returns true only when
 * the email was actually accepted by Gmail; any failure (no connector, bad
 * template, revoked password, network) returns false so the caller falls
 * back to the Apps Script branded send and the email still delivers. Auth
 * failures additionally mark the integration status='error' so the Settings
 * card surfaces "reconnect needed".
 */

const admin = () =>
  createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

export interface ClientSmtp {
  address: string
  appPassword: string
}

/** Load + decrypt a client's connected Gmail SMTP credentials, or null. */
export async function getClientSmtp(clientId: string): Promise<ClientSmtp | null> {
  if (!clientId) return null
  const { data } = await admin()
    .from('user_integrations')
    .select('access_token, metadata, status')
    .eq('client_id', clientId)
    .eq('provider', 'gmail_smtp')
    .maybeSingle()
  if (!data || data.status !== 'connected' || !data.access_token) return null
  const meta = (data.metadata as { gmail_address?: string } | null) || null
  const address = meta?.gmail_address || ''
  if (!address) return null
  try {
    return { address, appPassword: decryptSecret(data.access_token as string) }
  } catch (e) {
    console.error('[smtpSender] decrypt failed (key rotated?):', e)
    return null
  }
}

export function buildTransport(creds: ClientSmtp) {
  // Fresh single-use connection per send - no pooling in serverless.
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: creds.address, pass: creds.appPassword },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
  })
}

/** Live SMTP login check - used by the connect flow to verify the app
 *  password before storing it. Throws with Gmail's message on failure. */
export async function verifySmtpLogin(creds: ClientSmtp): Promise<void> {
  const transport = buildTransport(creds)
  try {
    await transport.verify()
  } finally {
    transport.close()
  }
}

function isAuthError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  const code = (err as { responseCode?: number })?.responseCode
  return code === 535 || /username and password not accepted|invalid credentials|5\.7\.8/i.test(msg)
}

async function markConnectorError(clientId: string, message: string): Promise<void> {
  try {
    await admin()
      .from('user_integrations')
      .update({ status: 'error', last_error: message.slice(0, 500) })
      .eq('client_id', clientId)
      .eq('provider', 'gmail_smtp')
  } catch (e) {
    console.error('[smtpSender] could not mark connector error:', e)
  }
}

/**
 * Try to deliver an outward email through the client's connected Gmail.
 * Expects the payload to already carry branding (fromName/replyTo) from
 * withEmailBranding. Returns true on success, false = caller must fall back.
 */
export async function trySmtpSend(
  type: string,
  payload: Record<string, unknown>,
): Promise<boolean> {
  try {
    const clientId = typeof payload.clientId === 'string' ? payload.clientId : ''
    if (!clientId) return false

    const creds = await getClientSmtp(clientId)
    if (!creds) return false

    const rendered = renderOutwardEmail(type, payload)
    if (!rendered) return false

    const toRaw = payload.to
    const to = Array.isArray(toRaw) ? toRaw.filter(Boolean).join(',') : String(toRaw || '')
    if (!to) return false

    const fromName = typeof payload.fromName === 'string' ? payload.fromName : ''
    const replyTo = typeof payload.replyTo === 'string' ? payload.replyTo : ''

    const transport = buildTransport(creds)
    try {
      await transport.sendMail({
        from: fromName ? { name: fromName, address: creds.address } : creds.address,
        to,
        ...(replyTo && replyTo !== creds.address ? { replyTo } : {}),
        subject: rendered.subject,
        html: rendered.html,
        attachments: rendered.attachments.map((a) => ({
          filename: a.filename,
          content: a.content,
          contentType: a.contentType,
        })),
      })
    } finally {
      transport.close()
    }
    return true
  } catch (err) {
    console.error('[smtpSender] send failed, falling back to Apps Script:', err)
    const clientId = typeof payload.clientId === 'string' ? payload.clientId : ''
    if (clientId && isAuthError(err)) {
      // Revoked / changed app password (changing the Google password also
      // revokes app passwords). Surface it so Settings shows "reconnect".
      await markConnectorError(
        clientId,
        err instanceof Error ? err.message : 'SMTP authentication failed',
      )
    }
    return false
  }
}
