'use client'

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type SyntheticEvent,
} from 'react'
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  Gauge,
} from 'lucide-react'

// VideoPlayer v2.
//
// Built from scratch with one rule: the browser is the only thing that
// actually knows how a video should be displayed (it decoded the frames),
// so the LAYOUT follows the VIDEO, not the other way around.
//
// What this fixes vs. v1:
//
//   1. Aspect ratio for re-encoded / HandBrake files. v1 tried to predict
//      aspect from asset.width/height or the poster image and locked the
//      frame to that prediction; when the prediction was wrong (HandBrake
//      rotation flag dropped during transcode), v1 stretched or squeezed
//      the video into the wrong-shape frame. v2 sets no width/height on
//      the <video>, gives it `max-h:70vh max-w:100%`, and lets the
//      browser render at its true intrinsic size. The inner frame is a
//      flex item that sizes to its content, so it always matches.
//
//   2. Scrubber drift after editing/replacing a video. v1's scrubber was
//      laid out against a wrapper that was sized from a cached aspect.
//      When the asset was swapped, the wrapper kept the old size briefly,
//      so the scrubber overshot the new video's right edge until a
//      refresh. v2's scrubber lives inside the same inner frame that
//      sizes to the video, so they resize together.
//
//   3. play() AbortError when toggling fast. v1's `void v.play()`
//      discarded the returned promise; a pause() before it resolved
//      rejected with AbortError and surfaced in the console. v2 wraps
//      every play() call in `safePlay()` which swallows AbortError but
//      still surfaces real failures (autoplay block, decode error).
//
//   4. Press-play-after-end no-op. When playback ends, currentTime is
//      parked at duration and play() is a no-op. v2 detects "at end"
//      and seeks to 0 before calling play().
//
//   5. Scrubber pinned at 100% / wrong total duration. HandBrake-encoded
//      mp4s often report duration as Infinity or NaN at loadedmetadata,
//      then fire `durationchange` with the real value once the moov
//      atom is fully parsed. v1 took the first value and never updated.
//      v2 ignores non-finite durations and listens for durationchange.
//
//   6. Scrubber overshoot. While the real duration is still loading,
//      progressPct could exceed 100% and paint the playhead off the
//      track. v2 caps progressPct at 100%.
//
// Server-side companion fix: `cldUrl()` in `lib/cloudinary.ts` now adds
// `c_limit` whenever a width/height is requested, which forces Cloudinary
// to re-encode the video and bake any rotation flag into the output
// bitstream - so the browser never has to honor a rotation flag in the
// first place.

const BRAND = '#2B79F7'

export interface VideoPlayerProps {
  src: string
  poster?: string
  className?: string
  /** Bridge the underlying <video> element to a parent ref/callback. */
  videoRef?: (el: HTMLVideoElement | null) => void
  /** Cover the full container (used by grid cells). */
  fill?: boolean
  /** Forwarded events for parents that track interaction. */
  onPlay?: () => void
  onPause?: () => void
  onTimeUpdate?: () => void
}

const HIDE_DELAY_MS = 1800

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = String(s).padStart(2, '0')
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`
  return `${m}:${ss}`
}

export function VideoPlayer({
  src,
  poster,
  className = '',
  videoRef,
  fill = false,
  onPlay,
  onPause,
  onTimeUpdate,
}: VideoPlayerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const videoElRef = useRef<HTMLVideoElement | null>(null)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wasPlayingBeforeScrubRef = useRef(false)

  const [playing, setPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [showSpeedMenu, setShowSpeedMenu] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [chromeVisible, setChromeVisible] = useState(true)
  const [scrubbing, setScrubbing] = useState(false)
  const [scrubPreview, setScrubPreview] = useState<number | null>(null)

  const setVideoRefs = useCallback(
    (el: HTMLVideoElement | null) => {
      videoElRef.current = el
      videoRef?.(el)
    },
    [videoRef],
  )

  // ---- play()/pause() with race-safe rejection handling ---------------

  const safePlay = useCallback((v: HTMLVideoElement) => {
    const p = v.play()
    if (p && typeof p.catch === 'function') {
      p.catch((err) => {
        // play() rejects with AbortError if a pause() lands before it
        // resolves. That's expected user interaction; everything else
        // (autoplay block, decode error) should still surface.
        if (err?.name !== 'AbortError') console.error('Video play failed:', err)
      })
    }
  }, [])

  const togglePlay = useCallback(() => {
    const v = videoElRef.current
    if (!v) return
    if (v.paused) {
      // Restart-after-end: when playback ends, currentTime is parked at
      // duration and play() is a no-op (video stays paused). Rewind so
      // pressing play actually plays again.
      if (
        Number.isFinite(v.duration) &&
        v.duration > 0 &&
        v.currentTime >= v.duration - 0.05
      ) {
        v.currentTime = 0
      }
      safePlay(v)
    } else {
      v.pause()
    }
  }, [safePlay])

  // ---- Auto-hide chrome -----------------------------------------------

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
  }, [])

  const scheduleHide = useCallback(() => {
    clearHideTimer()
    hideTimerRef.current = setTimeout(() => setChromeVisible(false), HIDE_DELAY_MS)
  }, [clearHideTimer])

  const showChrome = useCallback(() => {
    setChromeVisible(true)
    clearHideTimer()
  }, [clearHideTimer])

  useEffect(() => () => clearHideTimer(), [clearHideTimer])

  const onMouseMove = () => {
    showChrome()
    if (playing) scheduleHide()
  }
  const onMouseEnter = () => showChrome()
  const onMouseLeave = () => {
    if (playing) {
      clearHideTimer()
      hideTimerRef.current = setTimeout(() => setChromeVisible(false), 300)
    } else {
      setChromeVisible(false)
    }
  }

  // Surface-click toggles play. Bubbled clicks from chrome are stopped
  // by the chrome wrapper below, so they don't end up here.
  const handleSurfaceClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget || e.target instanceof HTMLVideoElement) {
      togglePlay()
    }
  }

  // ---- Seek + scrubber -------------------------------------------------

  const seekTo = (next: number) => {
    const v = videoElRef.current
    if (!v) return
    const clamped = Math.max(0, Math.min(duration || v.duration || 0, next))
    v.currentTime = clamped
    setCurrentTime(clamped)
  }
  const seekBy = (delta: number) => {
    const v = videoElRef.current
    if (!v) return
    seekTo(v.currentTime + delta)
  }

  const onScrubPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!duration) return
    const v = videoElRef.current
    if (!v) return
    wasPlayingBeforeScrubRef.current = !v.paused
    if (!v.paused) v.pause()
    setScrubbing(true)
    e.currentTarget.setPointerCapture(e.pointerId)
    handleScrubMove(e)
  }
  const onScrubPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!scrubbing) return
    handleScrubMove(e)
  }
  const onScrubPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!scrubbing) return
    setScrubbing(false)
    e.currentTarget.releasePointerCapture(e.pointerId)
    if (scrubPreview != null) seekTo(scrubPreview)
    setScrubPreview(null)
    if (wasPlayingBeforeScrubRef.current) {
      const v = videoElRef.current
      if (v) safePlay(v)
    }
  }
  const handleScrubMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    setScrubPreview(pct * duration)
  }

  // ---- Volume ----------------------------------------------------------

  const toggleMute = () => {
    const v = videoElRef.current
    if (!v) return
    v.muted = !v.muted
    setMuted(v.muted)
  }
  const onVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = Number(e.target.value)
    const v = videoElRef.current
    if (!v) return
    v.volume = next
    v.muted = next === 0
    setVolume(next)
    setMuted(v.muted)
  }

  // ---- Playback speed --------------------------------------------------

  const setSpeed = (rate: number) => {
    const v = videoElRef.current
    if (!v) return
    v.playbackRate = rate
    setPlaybackRate(rate)
    setShowSpeedMenu(false)
  }

  // ---- Fullscreen ------------------------------------------------------

  const toggleFullscreen = useCallback(() => {
    const c = containerRef.current
    if (!c) return
    if (document.fullscreenElement) {
      void document.exitFullscreen()
    } else {
      void c.requestFullscreen?.()
    }
  }, [])

  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  // ---- Keyboard shortcuts (when player is hovered) --------------------

  useEffect(() => {
    const node = containerRef.current
    if (!node) return
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      const active = node.matches(':hover') || node.contains(document.activeElement)
      if (!active) return
      switch (e.key) {
        case ' ':
        case 'k':
        case 'K':
          e.preventDefault()
          togglePlay()
          break
        case 'ArrowLeft':
          e.preventDefault()
          seekBy(-5)
          break
        case 'ArrowRight':
          e.preventDefault()
          seekBy(5)
          break
        case 'f':
        case 'F':
          e.preventDefault()
          toggleFullscreen()
          break
        case 'm':
        case 'M':
          e.preventDefault()
          toggleMute()
          break
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [togglePlay, toggleFullscreen, duration])

  // ---- Render ----------------------------------------------------------

  const displayedTime = scrubPreview ?? currentTime
  // Cap at 100 so a stale low duration can't paint the playhead off the track.
  const progressPct =
    duration > 0 ? Math.min(100, (displayedTime / duration) * 100) : 0

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      onMouseMove={onMouseMove}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={handleSurfaceClick}
      className={`relative group ${
        isFullscreen
          ? 'h-screen w-screen bg-black overflow-hidden flex items-center justify-center'
          : fill
          ? 'h-full w-full bg-black overflow-hidden'
          : 'w-full flex justify-center'
      } ${className}`}
    >
      {/* Inner frame: sizes to the video's natural rendered dimensions
          via flex-item-sizes-to-content. The chrome lives in here so
          its absolute positioning always matches the video bounds. */}
      <div
        className={
          isFullscreen
            ? 'relative h-full w-full'
            : fill
            ? 'relative h-full w-full'
            : 'relative bg-black rounded-lg overflow-hidden max-w-full'
        }
      >
        <video
          ref={setVideoRefs}
          src={src}
          poster={poster}
          playsInline
          preload="metadata"
          onPlay={() => {
            setPlaying(true)
            if (!chromeVisible) showChrome()
            scheduleHide()
            onPlay?.()
          }}
          onPause={() => {
            setPlaying(false)
            showChrome()
            onPause?.()
          }}
          onTimeUpdate={(e: SyntheticEvent<HTMLVideoElement>) => {
            if (!scrubbing) {
              setCurrentTime((e.target as HTMLVideoElement).currentTime)
            }
            onTimeUpdate?.()
          }}
          onLoadedMetadata={(e: SyntheticEvent<HTMLVideoElement>) => {
            const t = e.target as HTMLVideoElement
            // Only commit a real, finite duration. HandBrake-encoded
            // fragmented mp4s often report Infinity or NaN here and the
            // real value via durationchange.
            if (Number.isFinite(t.duration) && t.duration > 0) {
              setDuration(t.duration)
            }
            setVolume(t.volume)
            setMuted(t.muted)
          }}
          onDurationChange={(e: SyntheticEvent<HTMLVideoElement>) => {
            const t = e.target as HTMLVideoElement
            if (Number.isFinite(t.duration) && t.duration > 0) {
              setDuration(t.duration)
            }
          }}
          onVolumeChange={(e: SyntheticEvent<HTMLVideoElement>) => {
            const t = e.target as HTMLVideoElement
            setVolume(t.volume)
            setMuted(t.muted)
          }}
          className={
            isFullscreen
              ? 'h-full w-full object-contain'
              : fill
              ? 'h-full w-full object-cover'
              : // Default mode: NO explicit width/height, NO object-fit.
                // The browser renders the video at its true intrinsic
                // dimensions (post-rotation), capped by max-h:70vh and
                // max-w:100% while preserving aspect.
                'block max-h-[70vh] max-w-full'
          }
        />

        {/* Big center play button when paused */}
        {!playing && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              togglePlay()
            }}
            aria-label="Play"
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-16 w-16 rounded-full bg-black/50 hover:bg-black/70 backdrop-blur-sm flex items-center justify-center transition-all hover:scale-105"
          >
            <Play className="h-8 w-8 text-white translate-x-0.5" fill="white" />
          </button>
        )}

        {/* Chrome - fades together; stops clicks so the surface-click
            toggle doesn't fire when interacting with controls. */}
        <div
          className={`absolute inset-x-0 bottom-0 transition-opacity duration-200 ${
            chromeVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/80 to-transparent pointer-events-none" />

          <div className="relative px-3 pb-2 pt-3">
            {/* Scrubber */}
            <div
              role="slider"
              aria-label="Seek"
              aria-valuemin={0}
              aria-valuemax={duration || 0}
              aria-valuenow={displayedTime}
              onPointerDown={onScrubPointerDown}
              onPointerMove={onScrubPointerMove}
              onPointerUp={onScrubPointerUp}
              onPointerCancel={onScrubPointerUp}
              className="relative h-2 cursor-pointer group/scrub touch-none"
            >
              <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1 rounded-full bg-white/25 group-hover/scrub:h-1.5 transition-all" />
              <div
                className="absolute left-0 top-1/2 -translate-y-1/2 h-1 rounded-full group-hover/scrub:h-1.5 transition-all"
                style={{ width: `${progressPct}%`, backgroundColor: BRAND }}
              />
              <div
                className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-3 w-3 rounded-full shadow-md opacity-0 group-hover/scrub:opacity-100 transition-opacity"
                style={{ left: `${progressPct}%`, backgroundColor: BRAND }}
              />
            </div>

            {/* Buttons row */}
            <div className="mt-1.5 flex items-center gap-2 text-white">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  togglePlay()
                }}
                aria-label={playing ? 'Pause' : 'Play'}
                className="p-1.5 rounded-md hover:bg-white/15 transition-colors"
              >
                {playing ? (
                  <Pause className="h-4 w-4" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
              </button>

              {/* Volume - slider slides out on hover */}
              <div className="flex items-center group/vol">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleMute()
                  }}
                  aria-label={muted ? 'Unmute' : 'Mute'}
                  className="p-1.5 rounded-md hover:bg-white/15 transition-colors"
                >
                  {muted || volume === 0 ? (
                    <VolumeX className="h-4 w-4" />
                  ) : (
                    <Volume2 className="h-4 w-4" />
                  )}
                </button>
                <div className="overflow-hidden w-0 group-hover/vol:w-24 transition-[width] duration-200 ease-out">
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={muted ? 0 : volume}
                    onChange={onVolumeChange}
                    onClick={(e) => e.stopPropagation()}
                    aria-label="Volume"
                    className="w-20 ml-2 accent-[#2B79F7] align-middle"
                  />
                </div>
              </div>

              {/* Time display */}
              <div className="text-[11px] tabular-nums text-white/85 select-none">
                {formatTime(displayedTime)}
                <span className="text-white/50"> / {formatTime(duration)}</span>
              </div>

              <div className="flex-1" />

              {/* Speed */}
              <div className="relative">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setShowSpeedMenu((v) => !v)
                  }}
                  aria-label="Playback speed"
                  className="p-1.5 rounded-md hover:bg-white/15 transition-colors flex items-center gap-1"
                >
                  <Gauge className="h-4 w-4" />
                  <span className="text-[11px] tabular-nums">
                    {playbackRate === 1 ? '1x' : `${playbackRate}x`}
                  </span>
                </button>
                {showSpeedMenu && (
                  <div
                    className="absolute right-0 bottom-full mb-1 bg-black/90 border border-white/10 rounded-md py-1 min-w-[80px] shadow-xl"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {[0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setSpeed(r)}
                        className={`w-full text-left px-3 py-1 text-xs hover:bg-white/10 transition-colors ${
                          r === playbackRate ? 'text-[#2B79F7]' : 'text-white'
                        }`}
                      >
                        {r === 1 ? 'Normal' : `${r}x`}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Fullscreen */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  toggleFullscreen()
                }}
                aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                className="p-1.5 rounded-md hover:bg-white/15 transition-colors"
              >
                {isFullscreen ? (
                  <Minimize className="h-4 w-4" />
                ) : (
                  <Maximize className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
