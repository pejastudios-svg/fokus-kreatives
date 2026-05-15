'use client'

/* eslint-disable @next/next/no-img-element */

// Brand image uploader for the capture builder. Shows a thumbnail of
// the current image when present, with a hover overlay for replace +
// remove. Renders the upload UI when empty. Per-layout size hint
// renders underneath so the user knows the recommended dimensions
// BEFORE they upload.

import { useRef, useState } from 'react'
import { Upload, ImageIcon, X, Loader2 } from 'lucide-react'

interface Props {
  value: string
  onChange: (url: string) => void
  folder: string
  /** Display label (e.g. "Banner image", "Logo"). */
  label: string
  /** One-line size recommendation, e.g. "Recommended: 1600×600 (8:3 wide)". */
  sizeHint?: string
  /** Aspect ratio for the placeholder box (CSS aspect-ratio value).
   *  Default 16/9 for banner-like uploads. Use '1' for circular logo. */
  aspect?: string
  /** Optional: render as a circle (logos). */
  circle?: boolean
}

export function BrandImageUpload({
  value,
  onChange,
  folder,
  label,
  sizeHint,
  aspect = '16 / 9',
  circle = false,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleFile = async (file: File | null) => {
    if (!file) return
    setError(null)
    setIsUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('folder', folder)

      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      })
      const data = await res.json()
      if (data?.success && data?.url) {
        onChange(data.url)
      } else {
        setError(data?.error || 'Upload failed')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setIsUploading(false)
    }
  }

  const pickFile = () => fileInputRef.current?.click()

  const radiusClass = circle ? 'rounded-full' : 'rounded-lg'

  return (
    <div className="space-y-1.5">
      <p className="text-sm text-[var(--text-primary)] font-medium">{label}</p>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
      />

      {value ? (
        <div
          className={`group relative ${radiusClass} overflow-hidden border border-[var(--border-primary)] bg-[var(--bg-secondary)]`}
          style={{ aspectRatio: aspect }}
        >
          <img src={value} alt={label} className="absolute inset-0 w-full h-full object-cover" />
          {/* Hover overlay: replace + remove. In tight spaces (logo
              circle) we drop text and show icon-only buttons stacked
              vertically so they never clip out of the container. */}
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/55 transition-colors flex items-center justify-center gap-1.5 opacity-0 group-hover:opacity-100">
            {circle ? (
              <>
                <button
                  type="button"
                  onClick={pickFile}
                  disabled={isUploading}
                  title="Replace"
                  className="p-2 rounded-full bg-white text-black hover:bg-white/90 disabled:opacity-50"
                >
                  {isUploading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Upload className="h-3.5 w-3.5" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => onChange('')}
                  disabled={isUploading}
                  title="Remove"
                  className="p-2 rounded-full bg-red-500/90 text-white hover:bg-red-600 disabled:opacity-50"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={pickFile}
                  disabled={isUploading}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-white text-black hover:bg-white/90 disabled:opacity-50"
                >
                  {isUploading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Upload className="h-3.5 w-3.5" />
                  )}
                  Replace
                </button>
                <button
                  type="button"
                  onClick={() => onChange('')}
                  disabled={isUploading}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-red-500/90 text-white hover:bg-red-600 disabled:opacity-50"
                >
                  <X className="h-3.5 w-3.5" />
                  Remove
                </button>
              </>
            )}
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={pickFile}
          disabled={isUploading}
          className={`${radiusClass} w-full border-2 border-dashed border-[var(--border-primary)] hover:border-[#2B79F7] hover:bg-[#2B79F7]/5 transition-colors flex flex-col items-center justify-center gap-1.5 text-[var(--text-tertiary)] hover:text-[#2B79F7] disabled:opacity-50`}
          style={{ aspectRatio: aspect }}
        >
          {isUploading ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-xs">Uploading…</span>
            </>
          ) : (
            <>
              <ImageIcon className="h-6 w-6" />
              <span className="text-xs font-medium">Click to upload</span>
            </>
          )}
        </button>
      )}

      {sizeHint && (
        <p className="text-[11px] text-[var(--text-tertiary)] leading-snug">{sizeHint}</p>
      )}
      {error && <p className="text-[11px] text-red-500">{error}</p>}
    </div>
  )
}
