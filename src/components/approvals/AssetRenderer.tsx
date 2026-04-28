'use client'

import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { CloudinaryAsset } from '@/lib/cloudinary'
import { cldUrl } from '@/lib/cloudinary'

interface AssetRendererProps {
  attachments: CloudinaryAsset[]
  isCarousel: boolean
  /** Optional click-to-zoom on images. Receives the asset's source URL + name. */
  onImageClick?: (url: string, name: string) => void
}

/**
 * Renders one or more uploaded Cloudinary assets in an approval item.
 *
 * Single image / single video → just the asset.
 * Multiple, isCarousel=true   → swipeable slider with prev/next + dots.
 * Multiple, isCarousel=false  → grid of thumbnails (each clickable to open).
 *
 * Cloudinary's `f_auto,q_auto` transforms keep delivery size small while
 * preserving visible quality. Videos use the same transforms via `cldUrl`.
 */
export function AssetRenderer({ attachments, isCarousel, onImageClick }: AssetRendererProps) {
  const [active, setActive] = useState(0)

  if (!attachments?.length) return null

  if (attachments.length === 1) {
    return <AssetView asset={attachments[0]} onImageClick={onImageClick} />
  }

  if (isCarousel) {
    const safeIndex = Math.max(0, Math.min(active, attachments.length - 1))
    const a = attachments[safeIndex]
    return (
      <div className="relative">
        <AssetView asset={a} onImageClick={onImageClick} />
        <button
          type="button"
          onClick={() => setActive((i) => (i - 1 + attachments.length) % attachments.length)}
          className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80"
          aria-label="Previous"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setActive((i) => (i + 1) % attachments.length)}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80"
          aria-label="Next"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5">
          {attachments.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setActive(i)}
              aria-label={`Go to slide ${i + 1}`}
              className={`h-1.5 rounded-full transition-all ${
                i === safeIndex ? 'w-4 bg-white' : 'w-1.5 bg-white/60'
              }`}
            />
          ))}
        </div>
        <div className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-black/60 text-white text-[10px]">
          {safeIndex + 1} / {attachments.length}
        </div>
      </div>
    )
  }

  // Multi, not carousel → grid.
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
      {attachments.map((a, i) => (
        <div key={`${a.public_id}-${i}`} className="aspect-square rounded-lg overflow-hidden border border-gray-200 bg-gray-50">
          <AssetView asset={a} onImageClick={onImageClick} fill />
        </div>
      ))}
    </div>
  )
}

interface AssetViewProps {
  asset: CloudinaryAsset
  onImageClick?: (url: string, name: string) => void
  /** When true, fills its parent (used in grid cells). */
  fill?: boolean
}

function AssetView({ asset, onImageClick, fill }: AssetViewProps) {
  if (asset.resource_type === 'video') {
    return (
      <video
        src={cldUrl(asset, { w: 1200 })}
        controls
        playsInline
        preload="metadata"
        className={
          fill
            ? 'h-full w-full object-cover'
            : 'w-full max-h-[70vh] rounded-lg bg-black'
        }
      />
    )
  }

  const src = cldUrl(asset, { w: fill ? 600 : 1200 })
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={src}
      alt={asset.name || 'Asset'}
      className={
        fill
          ? 'h-full w-full object-cover cursor-zoom-in'
          : 'w-full max-h-[70vh] object-contain rounded-lg bg-black/5 cursor-zoom-in'
      }
      onClick={() => onImageClick?.(asset.secure_url, asset.name || 'Image')}
    />
  )
}
