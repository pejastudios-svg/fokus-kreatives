import { GoogleGenAI } from '@google/genai'

/**
 * Gemini context-caching wrapper.
 *
 * Spec: docs/content_planner_buildout.md section 9.5.
 *
 * Gemini's `caches.create()` lets us upload a large prompt prefix once and
 * reuse it across requests at ~25% the input-token rate. The framework +
 * format module + brand profile context block is the cacheable prefix; the
 * raw material + slot-specific instructions are the uncached tail.
 *
 * v1 stores cache metadata in an in-process Map. The cache only needs to
 * outlive a single planner-generation session (a few minutes), so process-
 * locality is fine. If we add multi-instance compute later, swap this for a
 * small `ai_context_caches` table.
 *
 * On any failure (network, billing, model-not-supported), getOrCreateContextCache
 * returns null. The caller MUST fall back to non-cached generation rather than
 * hard-fail.
 */

interface CacheEntry {
  cacheName: string
  expiresAt: number
}

const inMemoryCaches = new Map<string, CacheEntry>()

export interface CachedContextOptions {
  /** Text the AI should treat as system instruction. This is what gets cached. */
  systemInstruction: string
  /** Cache TTL in seconds. Default 3600 (1 hour). Gemini also enforces its own min/max. */
  ttlSeconds?: number
  /** Optional human-readable name surfaced in the Gemini console. */
  displayName?: string
  /** Model to associate the cache with. Default flash. */
  model?: string
}

function getClient(): GoogleGenAI | null {
  if (!process.env.GEMINI_API_KEY) return null
  return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
}

// Returns the cache name that can be passed to provider.ts via
// `cachedContextName`. Returns null on any failure - the caller falls back to
// the non-cached path.
export async function getOrCreateContextCache(
  cacheKey: string,
  opts: CachedContextOptions,
): Promise<string | null> {
  // Fast path - in-process hit, still within TTL.
  const existing = inMemoryCaches.get(cacheKey)
  if (existing && existing.expiresAt > Date.now()) {
    return existing.cacheName
  }
  if (existing) inMemoryCaches.delete(cacheKey)

  const ai = getClient()
  if (!ai) return null

  const ttl = opts.ttlSeconds ?? 3600
  const model = opts.model ?? process.env.GEMINI_MODEL_STANDARD ?? 'gemini-2.5-flash'

  try {
    // The @google/genai SDK exposes `caches.create()` returning the resource
    // name (e.g. "cachedContents/abc123"). We treat any thrown error as a
    // signal to fall back - the caller will run un-cached.
    const created = await ai.caches.create({
      model,
      config: {
        systemInstruction: opts.systemInstruction,
        ttl: `${ttl}s`,
        ...(opts.displayName ? { displayName: opts.displayName } : {}),
      },
    })
    const cacheName = (created as { name?: string }).name
    if (!cacheName) return null

    inMemoryCaches.set(cacheKey, {
      cacheName,
      // Refresh ~30s before the server-side TTL to avoid serving a just-expired entry.
      expiresAt: Date.now() + Math.max(0, (ttl - 30) * 1000),
    })
    return cacheName
  } catch (err) {
     
    console.warn('[ai/contextCache] create failed, falling back:', err instanceof Error ? err.message : err)
    return null
  }
}

export async function deleteContextCache(cacheName: string): Promise<void> {
  const ai = getClient()
  if (!ai) return
  try {
    await ai.caches.delete({ name: cacheName })
  } catch (err) {
     
    console.warn('[ai/contextCache] delete failed:', err instanceof Error ? err.message : err)
  }
  for (const [key, entry] of inMemoryCaches.entries()) {
    if (entry.cacheName === cacheName) inMemoryCaches.delete(key)
  }
}

// Drop every cached entry whose key starts with `brand:${clientId}:`.
// Called when a brand profile is updated so the next generation rebuilds
// the cache against the new profile content.
export async function invalidateBrandCaches(clientId: string): Promise<void> {
  const prefix = `brand:${clientId}:`
  const toDrop: string[] = []
  for (const [key, entry] of inMemoryCaches.entries()) {
    if (key.startsWith(prefix)) {
      toDrop.push(entry.cacheName)
      inMemoryCaches.delete(key)
    }
  }
  await Promise.all(toDrop.map((name) => deleteContextCache(name)))
}
