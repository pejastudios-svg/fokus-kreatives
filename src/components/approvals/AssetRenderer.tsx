'use client'

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { CloudinaryAsset } from '@/lib/cloudinary'
import { cldThumb, cldUrl } from '@/lib/cloudinary'
import type { CommentRegion } from '@/lib/types/annotations'
import { RegionOverlay } from './RegionOverlay'
import { DrawCanvas } from './DrawCanvas'

interface AssetRendererProps {
  attachments: CloudinaryAsset[]
  isCarousel: boolean
  /** Optional click-to-zoom on images. Receives the asset's source URL + name. */
  onImageClick?: (url: string, name: string) => void
}

/**
 * Imperative handle exposed to parents that need to drive the renderer in
 * response to a comment annotation - e.g. clicking a 0:23 timestamp pill on
 * a comment should switch to the right slide and scrub that video to 23s.
 */
export interface AssetRendererHandle {
  /** Seconds on the most-recently interacted-with video, or null if none. */
  getCurrentTime: () => number | null
  /** Index of the currently-active slide (0 in single-asset mode). */
  getActiveIndex: () => number
  /** Switch to slide `index` (no-op if not a carousel or out of range). */
  goToSlide: (index: number) => void
  /** Scrub the active slide's video to `seconds` (no-op if not a video). */
  seekTo: (seconds: number) => void
  /** Smooth-scroll the asset into the viewport (used on phone-sized screens). */
  scrollIntoView: () => void
  /**
   * Convenience for the comment-click flow: jump to slide N, scrub to T,
   * scroll the player into view, and optionally show a saved region.
   */
  focusAnnotation: (opts: {
    attachmentIndex?: number | null
    timestampSeconds?: number | null
    region?: CommentRegion | null
  }) => void
  /**
   * Open the draw overlay on the active slide. Resolves with the region the
   * user drew (and the video's timestamp at confirm time, if applicable),
   * or null if they cancelled.
   */
  enterDrawMode: (shape?: 'circle' | 'freeform') => Promise<{
    region: CommentRegion
    timestampSeconds: number | null
  } | null>
  /** Display a saved region on the active slide until cleared. */
  flashRegion: (region: CommentRegion) => void
  /** Hide any currently-displayed saved region. */
  clearFlash: () => void
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
export const AssetRenderer = forwardRef<AssetRendererHandle, AssetRendererProps>(
  function AssetRenderer({ attachments, isCarousel, onImageClick }, ref) {
    const [active, setActive] = useState(0)
    const [dragOffset, setDragOffset] = useState(0)
    const [isDragging, setIsDragging] = useState(false)
    const swipeStartXRef = useRef<number | null>(null)
    const swipeDeltaRef = useRef(0)
    const containerRef = useRef<HTMLDivElement | null>(null)
    const videoRefs = useRef<(HTMLVideoElement | null)[]>([])
    // Per-slide rendered asset elements (img | video), tracked in state so that
    // overlays can read them during render (callback refs alone wouldn't
    // trigger a re-render after mount).
    const [assetEls, setAssetEls] = useState<Record<number, HTMLElement | null>>({})

    // Stable per-index callback refs. If they were declared inline they'd have
    // a fresh identity each render, which would make React detach + reattach
    // every callback ref every render - calling each one with (null) then (el)
    // and re-firing setState in the asset element setters, looping forever.
    // useMemo keyed on the slide count returns the same arrays as long as the
    // attachment count is stable, so the callbacks themselves are stable too.
    const slotCount = attachments.length
    const setAssetElByIndex = useMemo(
      () =>
        Array.from({ length: slotCount }, (_, i) => (el: HTMLElement | null) => {
          setAssetEls((prev) => (prev[i] === el ? prev : { ...prev, [i]: el }))
        }),
      [slotCount],
    )
    // eslint-disable-next-line react-hooks/preserve-manual-memoization
    const setVideoRefByIndex = useMemo(
      () =>
        Array.from({ length: slotCount }, (_, i) => (el: HTMLVideoElement | null) => {
          videoRefs.current[i] = el
        }),
      [slotCount],
    )
    // Tracks the most recent video the user has interacted with (played /
    // scrubbed / loaded metadata for). Lets `getCurrentTime()` return the
    // right one even in grid mode where there's no single "active" slide.
    const lastInteractedVideoIndexRef = useRef<number | null>(null)

    // Annotation overlays. flashedRegion runs a pulse on the active slide for
    // ~2.5s when a comment timestamp/region pill is clicked. drawingMode opens
    // the interactive draw canvas; the parent awaits a region. targetSlide is
    // captured at draw-start time so the canvas renders against the right
    // asset even in grid mode where there's no single "active" slide.
    const [flashedRegion, setFlashedRegion] = useState<CommentRegion | null>(null)
    const [drawingMode, setDrawingMode] = useState<{
      shape: 'circle' | 'freeform'
      resolve: (
        r: { region: CommentRegion; timestampSeconds: number | null } | null,
      ) => void
      targetSlide: number
    } | null>(null)

    // Clears any persistent highlight when the user starts playing the video
    // - the highlight has done its job once the video is rolling.
    const onAnyVideoPlay = useCallback(() => {
      setFlashedRegion((prev) => (prev ? null : prev))
    }, [])

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

    useImperativeHandle(
      ref,
      (): AssetRendererHandle => {
        const getActiveIdx = () => {
          if (attachments.length <= 1) return 0
          if (isCarousel) return Math.max(0, Math.min(active, attachments.length - 1))
          return lastInteractedVideoIndexRef.current ?? 0
        }
        const getCurrentTime = () => {
          // Prefer the most-recently-interacted video. Fall back to the
          // active slide if no interaction has happened yet.
          const idx = lastInteractedVideoIndexRef.current ?? getActiveIdx()
          const v = videoRefs.current[idx]
          if (!v) return null
          if (attachments[idx]?.resource_type !== 'video') return null
          return v.currentTime
        }
        const goToSlide = (index: number) => {
          if (!isCarousel) return
          if (index < 0 || index >= attachments.length) return
          setActive(index)
        }
        const seekTo = (seconds: number) => {
          const idx = getActiveIdx()
          const v = videoRefs.current[idx]
          if (!v) return
          if (attachments[idx]?.resource_type !== 'video') return
          try {
            v.currentTime = Math.max(0, seconds)
            // Don't auto-play; some browsers block it without a gesture
            // and the user may just want to see the moment paused.
          } catch (err) {
            console.error('AssetRenderer.seekTo failed:', err)
          }
        }
        const focusAnnotation = ({
          attachmentIndex,
          timestampSeconds,
          region,
        }: {
          attachmentIndex?: number | null
          timestampSeconds?: number | null
          region?: CommentRegion | null
        }) => {
          if (typeof attachmentIndex === 'number' && attachmentIndex >= 0) {
            goToSlide(attachmentIndex)
          }
          containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
          if (typeof timestampSeconds === 'number' && timestampSeconds >= 0) {
            // Run after the slide change has had a chance to commit, so the
            // video element we want to scrub actually exists in the DOM.
            setTimeout(() => seekTo(timestampSeconds), 60)
          }
          if (region) {
            setTimeout(() => setFlashedRegion(region), 80)
          }
        }
        const enterDrawMode: AssetRendererHandle['enterDrawMode'] = (shape = 'circle') =>
          new Promise<{ region: CommentRegion; timestampSeconds: number | null } | null>(
            (resolve) => {
              setDrawingMode({ shape, resolve, targetSlide: getActiveIdx() })
            },
          )
        const flashRegion: AssetRendererHandle['flashRegion'] = (region) => {
          setFlashedRegion(region)
        }
        const clearFlash: AssetRendererHandle['clearFlash'] = () => {
          setFlashedRegion(null)
        }
        const scrollIntoView: AssetRendererHandle['scrollIntoView'] = () => {
          containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
        return {
          getCurrentTime,
          getActiveIndex: getActiveIdx,
          goToSlide,
          seekTo,
          scrollIntoView,
          focusAnnotation,
          enterDrawMode,
          flashRegion,
          clearFlash,
        }
      },
      [active, attachments, isCarousel],
    )

    const drawCanvasNode = drawingMode ? (
      <DrawCanvas
        assetRef={assetEls[drawingMode.targetSlide] || null}
        initialShape={drawingMode.shape}
        onComplete={(region) => {
          // Auto-grab the playback time at the moment of confirmation if the
          // target asset is a video - the highlight IS that moment, so the
          // timestamp travels with it.
          const slideIdx = drawingMode.targetSlide
          const v = videoRefs.current[slideIdx]
          const isVideo = attachments[slideIdx]?.resource_type === 'video'
          const timestampSeconds = isVideo && v ? v.currentTime : null
          drawingMode.resolve({ region, timestampSeconds })
          setDrawingMode(null)
        }}
        onCancel={() => {
          drawingMode.resolve(null)
          setDrawingMode(null)
        }}
      />
    ) : null

    const flashOverlayFor = (slideIdx: number) => {
      if (!flashedRegion) return null
      // Only show the highlight on the slide that's currently active.
      const activeIdx = isCarousel
        ? Math.max(0, Math.min(active, attachments.length - 1))
        : 0
      if (slideIdx !== activeIdx) return null
      return (
        <RegionOverlay
          region={flashedRegion}
          assetRef={assetEls[slideIdx] || null}
          flashing
          onClose={() => setFlashedRegion(null)}
        />
      )
    }

    if (!attachments?.length) return null

    if (attachments.length === 1) {
      return (
        <div ref={containerRef} className="relative">
          <AssetView
            asset={attachments[0]}
            onImageClick={onImageClick}
            isActive
            videoRef={setVideoRefByIndex[0]}
            assetElRef={setAssetElByIndex[0]}
            onVideoInteract={() => {
              lastInteractedVideoIndexRef.current = 0
            }}
            onVideoPlay={onAnyVideoPlay}
          />
          {flashOverlayFor(0)}
          {drawCanvasNode}
        </div>
      )
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
          ref={containerRef}
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
                className="w-full flex-shrink-0 relative"
                aria-hidden={i !== safeIndex}
              >
                <AssetView
                  asset={a}
                  onImageClick={onImageClick}
                  isActive={i === safeIndex}
                  videoRef={setVideoRefByIndex[i]}
                  assetElRef={setAssetElByIndex[i]}
                  onVideoInteract={() => {
                    lastInteractedVideoIndexRef.current = i
                  }}
                  onVideoPlay={onAnyVideoPlay}
                />
                {flashOverlayFor(i)}
                {drawingMode && drawingMode.targetSlide === i && drawCanvasNode}
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
      <div ref={containerRef} className="grid grid-cols-2 md:grid-cols-3 gap-2">
        {attachments.map((a, i) => (
          <div
            key={`${a.public_id}-${i}`}
            className="aspect-square rounded-lg overflow-hidden border border-gray-200 bg-gray-50 relative"
          >
            <AssetView
              asset={a}
              onImageClick={onImageClick}
              fill
              isActive
              videoRef={setVideoRefByIndex[i]}
              assetElRef={setAssetElByIndex[i]}
              onVideoInteract={() => {
                lastInteractedVideoIndexRef.current = i
              }}
              onVideoPlay={onAnyVideoPlay}
            />
            {flashOverlayFor(i)}
            {drawingMode && drawingMode.targetSlide === i && drawCanvasNode}
          </div>
        ))}
      </div>
    )
  },
)

interface AssetViewProps {
  asset: CloudinaryAsset
  onImageClick?: (url: string, name: string) => void
  /** When true, fills its parent (used in grid cells). */
  fill?: boolean
  /** Active slide gets metadata-preload + autoplay-on-click. Others stay
   *  on their poster frame with no network activity. */
  isActive?: boolean
  videoRef?: (el: HTMLVideoElement | null) => void
  /** Generic ref to whichever element is rendering the asset (img | video).
   *  Region overlays use this to size themselves to the visible asset box. */
  assetElRef?: (el: HTMLElement | null) => void
  /** Fires whenever the video plays / scrubs / emits timeupdate. The parent
   *  uses this to remember which video the user has been interacting with
   *  so getCurrentTime() returns the right one. */
  onVideoInteract?: () => void
  /** Fires only on `play` events. Used to clear a saved-region highlight
   *  once the user starts watching - the highlight has done its job. */
  onVideoPlay?: () => void
}

function AssetView({
  asset,
  onImageClick,
  fill,
  isActive,
  videoRef,
  assetElRef,
  onVideoInteract,
  onVideoPlay,
}: AssetViewProps) {
  // Stable merged callback ref - if it weren't memoised, React would treat it
  // as a new ref each render and fire it (null) -> (el), retriggering the
  // setState inside assetElRef, which loops.
  const setVideoRefs = useCallback(
    (el: HTMLVideoElement | null) => {
      videoRef?.(el)
      assetElRef?.(el)
    },
    [videoRef, assetElRef],
  )

  if (asset.resource_type === 'video') {
    const poster = cldThumb(asset, fill ? { w: 600, h: 600, crop: 'fill' } : { w: 1200 })
    return (
      <video
        ref={setVideoRefs}
        src={cldUrl(asset, { w: 1200 })}
        poster={poster}
        controls
        playsInline
        preload={isActive ? 'metadata' : 'none'}
        onPlay={() => {
          onVideoInteract?.()
          onVideoPlay?.()
        }}
        onSeeked={onVideoInteract}
        onTimeUpdate={onVideoInteract}
        onLoadedMetadata={onVideoInteract}
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
      ref={assetElRef}
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
