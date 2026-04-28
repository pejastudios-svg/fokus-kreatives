'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { CloudinaryAsset } from '@/lib/cloudinary'
import { cldThumb, cldUrl } from '@/lib/cloudinary'

interface AssetRendererProps {
  attachments: CloudinaryAsset[]
  isCarousel: boolean
  /** Optional click-to-zoom on images. Receives the asset's source URL + name. */
  onImageClick?: (url: string, name: string) => void
}

const SWIPE_THRESHOLD_PX = 50

/**
 * Renders one or more uploaded Cloudinary assets in an approval item.
 *
 *   1 asset                → just the asset
 *   N assets, isCarousel   → sliding carousel (track of all slides, CSS
 *                            transform animates between them; touch + buttons
 *                            both work). Videos display Cloudinary's
 *                            poster-frame instantly while the video itself
 *                            only preloads metadata for the active slide.
 *   N assets, !isCarousel  → grid of thumbnails (each clickable to open).
 *
 * Cloudinary's `f_auto,q_auto` transforms keep delivery size small while
 * preserving visible quality.
 */
export function AssetRenderer({ attachments, isCarousel, onImageClick }: AssetRendererProps) {
  const [active, setActive] = useState(0)
  const [dragOffset, setDragOffset] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const swipeStartXRef = useRef<number | null>(null)
  const swipeDeltaRef = useRef(0)
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([])

  // When the active slide changes, pause every other video so audio doesn't
  // bleed across slides. (Carousel-only - in grid mode each video is its own
  // independent player.)
  useEffect(() => {
    if (!isCarousel) return
    videoRefs.current.forEach((v, i) => {
      if (!v) return
      if (i !== active && !v.paused) {
        v.pause()
      }
    })
  }, [active, isCarousel])

  if (!attachments?.length) return null

  if (attachments.length === 1) {
    return <AssetView asset={attachments[0]} onImageClick={onImageClick} isActive />
  }

  if (isCarousel) {
    const safeIndex = Math.max(0, Math.min(active, attachments.length - 1))

    const handleTouchStart = (e: React.TouchEvent) => {
      swipeStartXRef.current = e.touches[0].clientX
      swipeDeltaRef.current = 0
      setIsDragging(true)
    }
    const handleTouchMove = (e: React.TouchEvent) => {
      if (swipeStartXRef.current === null) return
      const delta = e.touches[0].clientX - swipeStartXRef.current
      swipeDeltaRef.current = delta
      setDragOffset(delta)
    }
    const handleTouchEnd = () => {
      const delta = swipeDeltaRef.current
      if (delta > SWIPE_THRESHOLD_PX) {
        setActive((i) => (i - 1 + attachments.length) % attachments.length)
      } else if (delta < -SWIPE_THRESHOLD_PX) {
        setActive((i) => (i + 1) % attachments.length)
      }
      swipeStartXRef.current = null
      swipeDeltaRef.current = 0
      setDragOffset(0)
      setIsDragging(false)
    }

    // While dragging, follow the finger; once released, snap with a CSS
    // transition. The transform combines the slide offset (in %) and the
    // drag delta (in px) into a single translate.
    const transform = `translate3d(calc(${-safeIndex * 100}% + ${dragOffset}px), 0, 0)`

    return (
      <div
        className="relative overflow-hidden rounded-lg select-none"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div
          className={`flex ${isDragging ? '' : 'transition-transform duration-300 ease-out'}`}
          style={{ transform }}
        >
          {attachments.map((a, i) => (
            <div
              key={`${a.public_id}-${i}`}
              className="w-full flex-shrink-0"
              aria-hidden={i !== safeIndex}
            >
              <AssetView
                asset={a}
                onImageClick={onImageClick}
                isActive={i === safeIndex}
                videoRef={(el) => {
                  videoRefs.current[i] = el
                }}
              />
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setActive((i) => (i - 1 + attachments.length) % attachments.length)}
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

  // Multi, not carousel → grid.
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
      {attachments.map((a, i) => (
        <div
          key={`${a.public_id}-${i}`}
          className="aspect-square rounded-lg overflow-hidden border border-gray-200 bg-gray-50"
        >
          <AssetView asset={a} onImageClick={onImageClick} fill isActive />
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
  /** Active slide gets metadata-preload + autoplay-on-click. Others stay
   *  on their poster frame with no network activity. */
  isActive?: boolean
  videoRef?: (el: HTMLVideoElement | null) => void
}

function AssetView({ asset, onImageClick, fill, isActive, videoRef }: AssetViewProps) {
  if (asset.resource_type === 'video') {
    const poster = cldThumb(asset, fill ? { w: 600, h: 600, crop: 'fill' } : { w: 1200 })
    return (
      <video
        ref={videoRef}
        src={cldUrl(asset, { w: 1200 })}
        poster={poster}
        controls
        playsInline
        preload={isActive ? 'metadata' : 'none'}
        className={
          fill
            ? 'h-full w-full object-cover bg-black'
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
