import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

/**
 * Authenticated encryption for stored credentials (AES-256-GCM).
 *
 * Used for the per-client Gmail app passwords behind the "Client email"
 * connector. The key lives ONLY in the server env (EMAIL_CRED_KEY - 64 hex
 * chars = 32 bytes); ciphertexts are stored in the DB and decrypted solely
 * at send time. GCM authenticates the ciphertext, so any tampering with the
 * stored value fails decryption instead of yielding garbage.
 *
 * Blob format: `v1:<iv b64>:<authTag b64>:<ciphertext b64>`.
 *
 * Key rotation note: rotating EMAIL_CRED_KEY makes existing blobs
 * undecryptable - clients would simply reconnect their email. Never reuse
 * this key for anything else.
 */

function key(): Buffer {
  const hex = process.env.EMAIL_CRED_KEY || ''
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('EMAIL_CRED_KEY must be 64 hex characters (openssl rand -hex 32)')
  }
  return Buffer.from(hex, 'hex')
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`
}

export function decryptSecret(blob: string): string {
  const [version, ivB64, tagB64, ctB64] = blob.split(':')
  if (version !== 'v1' || !ivB64 || !tagB64 || !ctB64) {
    throw new Error('Unrecognized secret blob format')
  }
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}

/** True when a stored value is one of our encrypted blobs. */
export function isSealed(value: string): boolean {
  return value.startsWith('v1:')
}

/**
 * Tolerant read for integration tokens: decrypts sealed blobs, passes
 * legacy plaintext rows through unchanged. Lets encrypted and
 * not-yet-backfilled rows coexist during the migration window.
 */
export function openSecret(value: string): string {
  return isSealed(value) ? decryptSecret(value) : value
}

/**
 * Best-effort seal for hot paths (OAuth token refresh persists). If the
 * key is missing/misconfigured we store plaintext (status quo) and log,
 * rather than failing the user-facing operation that triggered the
 * refresh. New-connection routes use encryptSecret directly and DO fail
 * loud, so credentials never silently regress there.
 */
export function sealSecretOrPlain(value: string): string {
  try {
    return encryptSecret(value)
  } catch (e) {
    console.error('[secretBox] seal failed, storing plaintext:', e)
    return value
  }
}
