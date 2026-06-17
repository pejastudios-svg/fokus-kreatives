import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'
import { encryptSecret, decryptSecret } from '@/lib/crypto/secretBox'

/**
 * Envelope encryption for password-locked agreement/template bodies.
 *
 *  - A random 32-byte data key (DEK) encrypts the body with AES-256-GCM.
 *  - The DEK is wrapped TWO ways:
 *      dekPw     - under scrypt(password) so password-holders can read it.
 *      dekServer - under the server master key (EMAIL_CRED_KEY, via
 *                  secretBox) so the agency owner can recover if the
 *                  password is lost, and so the app can re-encrypt on edit
 *                  without the password.
 *
 * Lose the password AND the server key = unrecoverable (by design). With the
 * server key the owner can always recover, so this protects against a raw DB
 * leak, not against the server operator. GCM authentication makes a wrong
 * password fail cleanly instead of yielding garbage.
 */

export interface EncryptedBody {
  v: 1
  bodyEnc: string // iv:tag:ct (base64) - body under DEK
  dekPw: string // iv:tag:ct - DEK under scrypt(password, saltPw)
  saltPw: string // base64 salt for the password KDF
  dekServer: string // DEK (base64) sealed under the server master key
}

function gcmEncrypt(plaintext: Buffer, k: Buffer): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', k, iv)
  const ct = Buffer.concat([c.update(plaintext), c.final()])
  return `${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${ct.toString('base64')}`
}

function gcmDecrypt(blob: string, k: Buffer): Buffer {
  const [ivB, tagB, ctB] = blob.split(':')
  if (!ivB || !tagB || !ctB) throw new Error('bad cipher blob')
  const d = createDecipheriv('aes-256-gcm', k, Buffer.from(ivB, 'base64'))
  d.setAuthTag(Buffer.from(tagB, 'base64'))
  return Buffer.concat([d.update(Buffer.from(ctB, 'base64')), d.final()])
}

function pwKey(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, 32)
}

/** Is the server master key available (needed for owner recovery + re-encrypt)? */
export function serverKeyConfigured(): boolean {
  return /^[0-9a-fA-F]{64}$/.test(process.env.EMAIL_CRED_KEY || '')
}

export function encryptBody(bodyHtml: string, password: string): EncryptedBody {
  const dek = randomBytes(32)
  const saltPw = randomBytes(16)
  return {
    v: 1,
    bodyEnc: gcmEncrypt(Buffer.from(bodyHtml, 'utf8'), dek),
    dekPw: gcmEncrypt(dek, pwKey(password, saltPw)),
    saltPw: saltPw.toString('base64'),
    dekServer: encryptSecret(dek.toString('base64')),
  }
}

/** Returns the plaintext body, or null when the password is wrong. */
export function decryptBodyWithPassword(enc: EncryptedBody, password: string): string | null {
  try {
    const dek = gcmDecrypt(enc.dekPw, pwKey(password, Buffer.from(enc.saltPw, 'base64')))
    return gcmDecrypt(enc.bodyEnc, dek).toString('utf8')
  } catch {
    return null
  }
}

/** Owner-recovery / server-side read via the server-wrapped DEK. */
export function decryptBodyWithServer(enc: EncryptedBody): string {
  const dek = Buffer.from(decryptSecret(enc.dekServer), 'base64')
  return gcmDecrypt(enc.bodyEnc, dek).toString('utf8')
}

/**
 * Re-encrypt a new body under the SAME DEK (recovered via the server wrap),
 * so a locked agreement can still be edited and saved without re-entering
 * the password. The password wrap is unchanged.
 */
export function reEncryptBody(enc: EncryptedBody, newBodyHtml: string): EncryptedBody {
  const dek = Buffer.from(decryptSecret(enc.dekServer), 'base64')
  return { ...enc, bodyEnc: gcmEncrypt(Buffer.from(newBodyHtml, 'utf8'), dek) }
}

/** Narrow a jsonb value to an EncryptedBody. */
export function asEncryptedBody(raw: unknown): EncryptedBody | null {
  if (!raw || typeof raw !== 'object') return null
  const e = raw as Partial<EncryptedBody>
  if (e.v === 1 && e.bodyEnc && e.dekPw && e.saltPw && e.dekServer) return e as EncryptedBody
  return null
}
