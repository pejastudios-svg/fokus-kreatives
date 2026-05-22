/**
 * Upload a file via XHR so we get real upload-progress events.
 *
 * The `fetch` API still has no spec for upload progress (only download
 * progress via streaming responses), so for any UI that needs a percentage
 * we have to fall back to XMLHttpRequest. This helper wraps that in a small,
 * fetch-like API.
 */

export interface UploadProgressOpts {
  url: string
  body: FormData | Blob | string
  method?: string
  headers?: Record<string, string>
  onProgress?: (pct: number) => void
  signal?: AbortSignal
}

export interface UploadResult {
  ok: boolean
  status: number
  text: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: () => any
}

export function uploadWithProgress(opts: UploadProgressOpts): Promise<UploadResult> {
  return new Promise<UploadResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open(opts.method || 'POST', opts.url, true)

    if (opts.headers) {
      for (const [k, v] of Object.entries(opts.headers)) xhr.setRequestHeader(k, v)
    }

    xhr.upload.onprogress = (ev) => {
      if (!ev.lengthComputable || !opts.onProgress) return
      const pct = ev.total > 0 ? Math.round((ev.loaded / ev.total) * 100) : 0
      opts.onProgress(Math.min(99, pct)) // hold at 99 until server responds
    }

    xhr.onload = () => {
      const text = xhr.responseText
      const ok = xhr.status >= 200 && xhr.status < 300
      // Bump to 100 only when the server has acknowledged the upload.
      if (ok && opts.onProgress) opts.onProgress(100)
      resolve({
        ok,
        status: xhr.status,
        text,
        json: () => {
          try {
            return JSON.parse(text)
          } catch {
            return null
          }
        },
      })
    }

    xhr.onerror = () =>
      reject(
        new Error(
          'Network connection dropped during upload. Check your connection and try again.',
        ),
      )
    xhr.onabort = () => reject(new DOMException('Upload aborted', 'AbortError'))

    if (opts.signal) {
      if (opts.signal.aborted) {
        xhr.abort()
        reject(new DOMException('Upload aborted', 'AbortError'))
        return
      }
      opts.signal.addEventListener('abort', () => xhr.abort(), { once: true })
    }

    xhr.send(opts.body as Document | XMLHttpRequestBodyInit)
  })
}
