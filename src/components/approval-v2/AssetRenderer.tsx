'use client'

import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { VideoPlayer } from './VideoPlayer'
import { cldUrl, cldThumb, type CloudinaryAsset } from '@/lib/cloudinary'

// AssetRenderer v2.
//
// Renders one or more uploaded assets in an approval item. v1 supported
// a "grid" mode that cropped every cell to a square via object-cover -
// useful for nothing, fatal for portrait video and most landscape
// content. v2 always uses the carousel for multi-asset items so each
// clip renders at its true aspect.
//
//   1 asset   → render the asset directly
//   N assets  → swipe carousel (one slide at a time, arrows + dots)

interface AssetRendererProps {
  attachments: CloudinaryAsset[]
}

export function AssetRenderer({ attachments }: AssetRendererProps) {
  const [active, setActive] = useState(0)

  if (!attachments?.length) return null

  if (attachments.length === 1) {
    return <AssetView asset={attachments[0]} isActive />
  }

  const safeIndex = Math.max(0, Math.min(active, attachments.length - 1))

  return (
    <div className="relative overflow-hidden rounded-lg">
      <div
        className="flex transition-transform duration-300 ease-out"
        style={{ transform: `translateX(-${safeIndex * 100}%)` }}
      >
        {attachments.map((a, i) => (
          <div
            key={`${a.public_id}-${i}`}
            className="w-full flex-shrink-0"
            aria-hidden={i !== safeIndex}
          >
            <AssetView asset={a} isActive={i === safeIndex} />
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() =>
          setActive((i) => (i - 1 + attachments.length) % attachments.length)
        }
        className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors"
        aria-label="Previous"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => setActive((i) => (i + 1) % attachments.length)}
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors"
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

function AssetView({
  asset,
  isActive,
}: {
  asset: CloudinaryAsset
  isActive: boolean
}) {
  if (asset.resource_type === 'video') {
    return (
      <VideoPlayer
        src={cldUrl(asset, { w: 1200 })}
        poster={cldThumb(asset, { w: 1200 })}
        // `isActive` is consumed by v1 to gate preload; v2 always uses
        // `preload="metadata"`, which is cheap. We accept the prop for
        // future-proofing but don't act on it.
        key={asset.public_id}
      />
    )
  }

  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={cldUrl(asset, { w: 1200 })}
      alt={asset.name || 'Asset'}
      className="block mx-auto max-h-[70vh] max-w-full rounded-lg bg-black/5"
      // isActive intentionally unused for images.
      data-active={isActive ? '1' : '0'}
    />
  )
}
