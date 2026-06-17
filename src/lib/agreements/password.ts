import { randomBytes, scryptSync, timingSafeEqual } from 'crypto'

/**
 * Salted scrypt hashing for agreement/template access passwords. No new
 * dependency (Node's crypto), no plaintext at rest. Format:
 *   scrypt$<saltHex>$<hashHex>
 *
 * These gate document ACCESS (who can open/sign), not user auth, so scrypt
 * with a per-password random salt is plenty and constant-time compared.
 */

const KEYLEN = 32

export function hashAccessPassword(password: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, KEYLEN)
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`
}

export function verifyAccessPassword(password: string, stored: string | null): boolean {
  if (!stored) return false
  const parts = stored.split('$')
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false
  try {
    const salt = Buffer.from(parts[1], 'hex')
    const expected = Buffer.from(parts[2], 'hex')
    const actual = scryptSync(password, salt, expected.length)
    return expected.length === actual.length && timingSafeEqual(expected, actual)
  } catch {
    return false
  }
}

/** True when a password string is acceptable to set (non-trivial). */
export function isUsablePassword(password: unknown): password is string {
  return typeof password === 'string' && password.trim().length >= 4
}
