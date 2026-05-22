/**
 * Chunked Cloudinary upload with per-chunk retry.
 *
 * Cloudinary's chunked upload protocol: each chunk is a normal multipart POST
 * to the same /upload endpoint, with two headers tying the chunks together:
 *
 *   X-Unique-Upload-Id: <uuid>     — shared across every chunk of one file
 *   Content-Range: bytes A-B/T     — A,B inclusive byte offsets, T = total
 *
 * Cloudinary stitches the chunks together and only returns the final asset
 * metadata (public_id, secure_url, etc) on the LAST chunk. Intermediate
 * chunks return 200 with a minimal "done: false" body.
 *
 * Why this matters: a single-shot POST of a 50MB video over a 5 Mbps uplink
 * is ~80 seconds of one continuous TCP connection. Any blip — ISP idle
 * timeout, Cloudinary edge proxy timeout, brief WiFi handoff — kills the
 * whole upload. With chunks, only the failing chunk needs to be retried.
 *
 * Retries are per-chunk with exponential backoff + jitter. 5xx responses
 * and "Network error" XHR failures retry. 4xx responses fail immediately
 * because they signal something permanent (bad signature, expired
 * timestamp, file too large for the plan, etc).
 */

import { uploadWithProgress } from './uploadWithProgress'

const DEFAULT_CHUNK_SIZE = 6 * 1024 * 1024 // 6 MB. Cloudinary requires >=5 MB except last chunk.
const DEFAULT_MAX_RETRIES_PER_CHUNK = 3

export interface ChunkedUploadOpts {
  /** Cloudinary upload endpoint, e.g. https://api.cloudinary.com/v1_1/<cloud>/auto/upload */
  uploadUrl: string
  /** File to upload. */
  file: File
  /** Signed form fields to include in every chunk's POST body. */
  signedFields: Record<string, string>
  /** Chunk size in bytes. Default 6 MB. */
  chunkSize?: number
  /** Max attempts per chunk before giving up. Default 3. */
  maxRetriesPerChunk?: number
  /** Overall upload progress 0-100. */
  onProgress?: (pct: number) => void
  /** Per-chunk lifecycle hook for UI / logging. */
  onChunk?: (info: { index: number; total: number; attempt: number }) => void
  /** AbortSignal to cancel the whole upload. */
  signal?: AbortSignal
}

interface FinalUploadResponse {
  public_id: string
  secure_url: string
  resource_type: 'image' | 'video'
  format: string
  width: number
  height: number
  duration?: number
  bytes: number
}

function isFinalResponse(data: unknown): data is FinalUploadResponse {
  return (
    !!data &&
    typeof data === 'object' &&
    'public_id' in data &&
    'secure_url' in data
  )
}

function isPermanentError(status: number): boolean {
  // 4xx errors won't get better by retrying. 408 (request timeout) and
  // 429 (too many requests) are exceptions — those CAN succeed on retry.
  return status >= 400 && status < 500 && status !== 408 && status !== 429
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    if (signal) {
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(t)
          reject(new DOMException('Upload aborted', 'AbortError'))
        },
        { once: true },
      )
    }
  })
}

export async function uploadCloudinaryChunked(
  opts: ChunkedUploadOpts,
): Promise<FinalUploadResponse> {
  const chunkSize = opts.chunkSize ?? DEFAULT_CHUNK_SIZE
  const maxRetries = opts.maxRetriesPerChunk ?? DEFAULT_MAX_RETRIES_PER_CHUNK
  const total = opts.file.size
  const uniqueId =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

  const chunkCount = Math.max(1, Math.ceil(total / chunkSize))
  let bytesCompletedBeforeCurrent = 0
  let finalResponse: FinalUploadResponse | null = null

  for (let index = 0; index < chunkCount; index++) {
    if (opts.signal?.aborted) {
      throw new DOMException('Upload aborted', 'AbortError')
    }

    const start = index * chunkSize
    const end = Math.min(start + chunkSize, total) - 1 // inclusive end byte
    const chunkLen = end - start + 1
    const chunkBlob = opts.file.slice(start, end + 1)

    let lastError: Error | null = null
    let succeeded = false

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      opts.onChunk?.({ index, total: chunkCount, attempt })

      try {
        // Rebuild the FormData on each attempt - XHR consumes the body.
        const form = new FormData()
        for (const [k, v] of Object.entries(opts.signedFields)) form.append(k, v)
        form.append('file', chunkBlob, opts.file.name)

        const res = await uploadWithProgress({
          url: opts.uploadUrl,
          body: form,
          headers: {
            'X-Unique-Upload-Id': uniqueId,
            'Content-Range': `bytes ${start}-${end}/${total}`,
          },
          onProgress: opts.onProgress
            ? (chunkPct) => {
                const inChunk = (chunkPct / 100) * chunkLen
                const overall = Math.round(
                  ((bytesCompletedBeforeCurrent + inChunk) / total) * 100,
                )
                opts.onProgress?.(Math.min(99, overall))
              }
            : undefined,
          signal: opts.signal,
        })

        if (!res.ok) {
          if (isPermanentError(res.status)) {
            throw new Error(`Upload rejected (${res.status}): ${res.text.slice(0, 200)}`)
          }
          throw new Error(`Upload server error (${res.status})`)
        }

        // Last chunk should return the full asset metadata. Earlier chunks
        // return a "done: false" shape we can ignore.
        const data = res.json()
        if (isFinalResponse(data)) {
          finalResponse = data
        }
        succeeded = true
        break
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))

        // Abort propagates immediately, never retries.
        if (lastError.name === 'AbortError') throw lastError

        // Permanent errors propagate immediately.
        if (/Upload rejected \(/.test(lastError.message)) throw lastError

        // Out of retries: bubble up.
        if (attempt === maxRetries) throw lastError

        // Exponential backoff with jitter: 500ms, 1s, 2s, 4s, ... capped 8s.
        const base = Math.min(8000, 500 * 2 ** (attempt - 1))
        const jitter = Math.random() * 500
        await sleep(base + jitter, opts.signal)
      }
    }

    if (!succeeded) {
      throw lastError || new Error(`Chunk ${index + 1} failed`)
    }

    bytesCompletedBeforeCurrent += chunkLen
  }

  if (!finalResponse) {
    throw new Error('Upload completed but Cloudinary did not return asset metadata.')
  }

  opts.onProgress?.(100)
  return finalResponse
}
