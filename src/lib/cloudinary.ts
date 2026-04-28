/**
 * Cloudinary client helpers.
 *
 * Two responsibilities:
 *   1. Direct browser → Cloudinary upload via signed POST. We sign on our
 *      server (`/api/cloudinary/sign`) with the API secret, then the browser
 *      uploads the file straight to Cloudinary. Bytes never touch our server.
 *      Progress is reported via XHR.
 *   2. Lightweight client-side image resize before upload (Cloudinary will
 *      then further compress + format on its end). Phone photos are often
 *      4000+ px wide; resizing to 2048 max dimension cuts upload size 5-10x
 *      with no perceptible quality loss for review-grade content.
 *
 * For videos we DON'T resize client-side (would require ffmpeg.wasm which is
 * heavy and slow). Cloudinary handles video compression on ingest.
 */

import { uploadWithProgress } from './uploadWithProgress'

export interface CloudinaryAsset {
  public_id: string
  secure_url: string
  resource_type: 'image' | 'video'
  format: string
  width: number
  height: number
  duration?: number
  bytes: number
  name: string
}

interface SignResponse {
  success: boolean
  signature: string
  timestamp: number
  api_key: string
  cloud_name: string
  folder: string
  resource_type: 'image' | 'video' | 'auto'
}

const MAX_IMAGE_DIMENSION = 2048
// Above this we'll resize. Below it we send the original bytes.
const RESIZE_THRESHOLD_BYTES = 1024 * 1024 // 1 MB

const IMAGE_PREFIXES = ['image/']
const VIDEO_PREFIXES = ['video/']

export function fileKind(file: File): 'image' | 'video' | 'other' {
  if (IMAGE_PREFIXES.some((p) => file.type.startsWith(p))) return 'image'
  if (VIDEO_PREFIXES.some((p) => file.type.startsWith(p))) return 'video'
  return 'other'
}

/**
 * Resize an image File (max dimension capped) and return a JPEG/PNG Blob.
 * Returns the original File untouched if it's already small enough or if the
 * browser bails on canvas operations.
 */
export async function resizeImageIfLarge(file: File): Promise<Blob> {
  if (file.size < RESIZE_THRESHOLD_BYTES) return file
  if (typeof document === 'undefined') return file

  try {
    const dataUrl: string = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })

    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = reject
      el.src = dataUrl
    })

    const longest = Math.max(img.width, img.height)
    if (longest <= MAX_IMAGE_DIMENSION) return file

    const scale = MAX_IMAGE_DIMENSION / longest
    const targetW = Math.round(img.width * scale)
    const targetH = Math.round(img.height * scale)

    const canvas = document.createElement('canvas')
    canvas.width = targetW
    canvas.height = targetH
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(img, 0, 0, targetW, targetH)

    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.9),
    )
    return blob || file
  } catch (err) {
    console.warn('resizeImageIfLarge failed, sending original:', err)
    return file
  }
}

interface UploadOpts {
  folder?: string
  onProgress?: (pct: number) => void
  signal?: AbortSignal
}

/**
 * Upload one file to Cloudinary. Resizes images client-side first; videos
 * are sent as-is (Cloudinary handles transcoding).
 */
export async function uploadToCloudinary(
  file: File,
  opts: UploadOpts = {},
): Promise<CloudinaryAsset> {
  const kind = fileKind(file)
  if (kind === 'other') {
    throw new Error(`Unsupported file type: ${file.type}`)
  }

  // 1) Get a fresh signature from our server.
  const signRes = await fetch('/api/cloudinary/sign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      folder: opts.folder || 'approvals/misc',
      resourceType: kind === 'video' ? 'video' : 'image',
    }),
  })
  const sign = (await signRes.json()) as SignResponse
  if (!sign?.success) {
    throw new Error('Failed to sign upload')
  }

  // 2) Optionally resize images.
  const blob = kind === 'image' ? await resizeImageIfLarge(file) : file

  // 3) Build the multipart POST.
  const form = new FormData()
  form.append('file', blob, file.name)
  form.append('api_key', sign.api_key)
  form.append('timestamp', String(sign.timestamp))
  form.append('signature', sign.signature)
  form.append('folder', sign.folder)

  // Cloudinary's resource-type goes in the URL path, not the body. Use
  // 'auto' so videos and images both work through the same flow without
  // having to re-resolve type here.
  const url = `https://api.cloudinary.com/v1_1/${sign.cloud_name}/auto/upload`

  const res = await uploadWithProgress({
    url,
    body: form,
    onProgress: opts.onProgress,
    signal: opts.signal,
  })

  if (!res.ok) {
    throw new Error(`Cloudinary upload failed (${res.status}): ${res.text}`)
  }

  const data = res.json() as {
    public_id: string
    secure_url: string
    resource_type: 'image' | 'video'
    format: string
    width: number
    height: number
    duration?: number
    bytes: number
  }

  return {
    public_id: data.public_id,
    secure_url: data.secure_url,
    resource_type: data.resource_type,
    format: data.format,
    width: data.width,
    height: data.height,
    duration: data.duration,
    bytes: data.bytes,
    name: file.name,
  }
}

/**
 * URL-builder for Cloudinary delivery transformations. Drop into <img src>
 * or <video src> to fetch the right size and format for the device.
 *
 *   cldUrl(asset, { w: 1200 })       → wide image, auto format + quality
 *   cldUrl(asset, { w: 800, h: 800 }) → square thumbnail, auto-cropped
 *
 * For videos, `f_auto,q_auto` lets Cloudinary serve mp4/webm/HLS as best
 * supported by the browser at an adaptive bitrate.
 */
export function cldUrl(
  asset: CloudinaryAsset,
  opts: { w?: number; h?: number; crop?: 'fill' | 'limit' | 'fit' } = {},
): string {
  if (!asset?.public_id || !asset?.secure_url) return asset?.secure_url || ''
  const cloudName = asset.secure_url.split('/res.cloudinary.com/')[1]?.split('/')[0]
  if (!cloudName) return asset.secure_url

  const t: string[] = ['f_auto', 'q_auto']
  if (opts.w) t.push(`w_${opts.w}`)
  if (opts.h) t.push(`h_${opts.h}`)
  if (opts.crop) t.push(`c_${opts.crop}`)
  const tx = t.join(',')

  return `https://res.cloudinary.com/${cloudName}/${asset.resource_type}/upload/${tx}/${asset.public_id}.${asset.format}`
}

/**
 * Fire-and-forget cleanup for orphaned Cloudinary assets.
 *
 * Pass any number of `{ public_id, resource_type }` pairs and we'll ask
 * the server (`/api/cloudinary/destroy`) to delete them from Cloudinary.
 * Failures are logged but never thrown, since cleanup running in the
 * background should never block the user-facing flow.
 */
export async function destroyCloudinaryAssets(
  assets: { public_id: string; resource_type: 'image' | 'video' }[],
): Promise<void> {
  if (!assets?.length) return
  try {
    await fetch('/api/cloudinary/destroy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assets: assets.map((a) => ({
          publicId: a.public_id,
          resourceType: a.resource_type,
        })),
      }),
    })
  } catch (err) {
    console.error('destroyCloudinaryAssets failed (orphans left behind):', err)
  }
}

/**
 * Poster-frame thumbnail for an asset. For images this is just `cldUrl`; for
 * videos Cloudinary will extract a representative frame and serve it as a
 * JPEG when the URL extension is `.jpg`. Useful for upload UIs and grid
 * previews where we don't want to load the whole video just to see what it is.
 */
export function cldThumb(
  asset: CloudinaryAsset,
  opts: { w?: number; h?: number; crop?: 'fill' | 'limit' | 'fit' } = {},
): string {
  if (asset.resource_type !== 'video') return cldUrl(asset, opts)
  if (!asset?.public_id || !asset?.secure_url) return asset?.secure_url || ''
  const cloudName = asset.secure_url.split('/res.cloudinary.com/')[1]?.split('/')[0]
  if (!cloudName) return asset.secure_url

  const t: string[] = ['f_auto', 'q_auto', 'so_auto']
  if (opts.w) t.push(`w_${opts.w}`)
  if (opts.h) t.push(`h_${opts.h}`)
  if (opts.crop) t.push(`c_${opts.crop}`)

  return `https://res.cloudinary.com/${cloudName}/video/upload/${t.join(',')}/${asset.public_id}.jpg`
}
