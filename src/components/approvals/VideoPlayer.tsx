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

// Branded video player. Replaces the browser's native control bar so we
// can:
//   1. Match the app's dark + blue aesthetic (no per-browser styling
//      drift)
//   2. Auto-fade chrome when paused + mouse leaves the player
//   3. Hide chrome during annotation so it doesn't sit on top of a
//      DrawCanvas overlay
//   4. Show comment markers on the scrubber (each tick is a comment
//      timestamp; click jumps to that frame)
//   5. Support keyboard shortcuts the agency review workflow expects
//      (space, arrows, J/K/L, F, M, frame-step on , and .)

const BRAND = '#2B79F7'

export interface VideoMarker {
  id: string
  seconds: number
  color?: string
}

export interface VideoPlayerProps {
  src: string
  poster?: string
  className?: string
  videoRef?: (el: HTMLVideoElement | null) => void
  // Hide every piece of chrome (and the click-to-toggle hit area) when
  // a parent is putting an annotation overlay on top.
  hideControls?: boolean
  // Comment markers on the scrubber. Click jumps to that timestamp.
  markers?: VideoMarker[]
  onMarkerClick?: (markerId: string) => void
  // Forwarded media events the parent app uses to track interaction
  // (e.g. timestamp pinning when leaving a comment).
  onPlay?: () => void
  onSeeked?: () => void
  onTimeUpdate?: () => void
  onLoadedMetadata?: () => void
  // Whether this asset is the active slide (load metadata only when it
  // is, to keep the carousel light).
  isActive?: boolean
  // Cover the full container instead of respecting aspect ratio.
  fill?: boolean
  // Cloudinary's stored source dimensions. We use these as an
  // additional aspect-ratio signal so we can cross-check what the
  // browser reports vs what the poster reports vs what Cloudinary
  // claims the source is.
  sourceWidth?: number
  sourceHeight?: number
  // Cloudinary's stored duration (seconds, from upload metadata).
  // Used as the ground truth for the "total" time display so a file
  // that's served progressively can't fool the player into showing
  // a duration that grows with currentTime.
  sourceDuration?: number
}

const HIDE_DELAY_MS = 1800
const MOBILE_TAP_SHOW_MS = 2400

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = String(s).padStart(2, '0')
  if (h > 0) {
    const mm = String(m).padStart(2, '0')
    return `${h}:${mm}:${ss}`
  }
  return `${m}:${ss}`
}

export function VideoPlayer({
  src,
  poster,
  className = '',
  videoRef,
  hideControls = false,
  markers = [],
  onMarkerClick,
  onPlay,
  onSeeked,
  onTimeUpdate,
  onLoadedMetadata,
  isActive = true,
  fill = false,
  sourceWidth,
  sourceHeight,
  sourceDuration,
}: VideoPlayerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const videoElRef = useRef<HTMLVideoElement | null>(null)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wasPlayingBeforeScrubRef = useRef(false)

  const [playing, setPlaying] = useState(false)
  // Duration is seeded from Cloudinary's upload metadata (sourceDuration)
  // when available. This is the ground truth - the <video> element's
  // own .duration can grow with currentTime for progressively-served
  // files, which made the "total" half of the time display march
  // forward in lock-step with playback. If we have sourceDuration we
  // refuse to overwrite it from media events.
  const [duration, setDuration] = useState(
    sourceDuration && sourceDuration > 0 ? sourceDuration : 0,
  )
  const [currentTime, setCurrentTime] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [showSpeedMenu, setShowSpeedMenu] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [chromeVisible, setChromeVisible] = useState(true)
  const [scrubbing, setScrubbing] = useState(false)
  const [scrubPreview, setScrubPreview] = useState<number | null>(null)
  // Perceived aspect ratio, learned from the poster image.
  //
  // For most files we'd happily trust the <video> element's intrinsic
  // dimensions, but HandBrake-encoded clips often carry rotation metadata
  // in a form Cloudinary doesn't bake out during transcode AND the
  // browser doesn't honor when laying out the element - so videoWidth /
  // videoHeight come back as the raw (landscape) frame, the CSS box is
  // landscape, the browser still paints the rotated portrait content,
  // and object-fit:fill (the <video> default) stretches it.
  //
  // The poster JPEG is the one signal that's reliably correct: Cloudinary
  // bakes rotation into the extracted frame, so naturalWidth /
  // naturalHeight on the loaded poster are the user-perceived aspect.
  // We lock the player frame to that and use object-contain on the
  // <video> so even if browser-rendered video disagrees, the content
  // letterboxes inside the right-shape frame instead of being squashed.
  const [posterAspect, setPosterAspect] = useState<number | null>(null)
  const [videoAspect, setVideoAspect] = useState<number | null>(null)

  useEffect(() => {
    if (!poster) {
      setPosterAspect(null)
      return
    }
    let cancelled = false
    const img = new Image()
    img.onload = () => {
      if (cancelled) return
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        setPosterAspect(img.naturalWidth / img.naturalHeight)
      }
    }
    img.src = poster
    return () => {
      cancelled = true
    }
  }, [poster])

  // Best-of-three aspect detection.
  //
  // For HandBrake-encoded clips each individual signal (asset dims from
  // Cloudinary upload metadata, the poster JPEG's natural dims, and the
  // video element's videoWidth/videoHeight) can lie - rotation flags
  // get dropped during transcode, posters get extracted from the wrong
  // dimension, browsers honor rotation inconsistently. But what tends
  // to happen when a signal is wrong is that it collapses to "square"
  // (aspect ≈ 1.0). A signal that's strongly portrait or landscape is
  // much more likely to be correct than a square one.
  //
  // So we pick the signal furthest from 1.0 - measured in log-space so
  // 9:16 (0.56) and 16:9 (1.78) are treated symmetrically. If a signal
  // doesn't exist or returns 0, it doesn't compete.
  const sourceAspect =
    sourceWidth && sourceHeight && sourceWidth > 0 && sourceHeight > 0
      ? sourceWidth / sourceHeight
      : null

  const extremeness = (a: number | null) =>
    a && a > 0 ? Math.abs(Math.log(a)) : -1

  const aspectCandidates = [
    { name: 'video', value: videoAspect },
    { name: 'poster', value: posterAspect },
    { name: 'source', value: sourceAspect },
  ]
  const bestAspect =
    aspectCandidates.reduce((acc, c) =>
      extremeness(c.value) > extremeness(acc.value) ? c : acc,
    ).value

  // Diagnostic: log every time any aspect signal updates so we can see
  // which sources agreed/disagreed for a broken file. console.log
  // (not console.debug) because Chrome hides debug-level by default.
  useEffect(() => {
    if (typeof window === 'undefined') return
    console.log('[VideoPlayer] aspect signals', {
      src,
      poster,
      sourceAspect,
      posterAspect,
      videoAspect,
      bestAspect,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, posterAspect, videoAspect, sourceAspect])

  const setMergedRef = useCallback(
    (el: HTMLVideoElement | null) => {
      videoElRef.current = el
      videoRef?.(el)
    },
    [videoRef],
  )

  // ---- Auto-hide chrome -------------------------------------------------

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
  }, [])

  const scheduleHide = useCallback(() => {
    clearHideTimer()
    hideTimerRef.current = setTimeout(() => {
      setChromeVisible(false)
    }, HIDE_DELAY_MS)
  }, [clearHideTimer])

  const showChrome = useCallback(() => {
    setChromeVisible(true)
    clearHideTimer()
  }, [clearHideTimer])

  // While playing: hide after a delay of no-mouse-move.
  // While paused: keep visible if hovering, hide when mouse leaves.
  // Annotation mode (hideControls=true): always hide.
  useEffect(() => {
    return () => clearHideTimer()
  }, [clearHideTimer])

  // ---- Mouse / touch behavior ------------------------------------------

  const onMouseMove = () => {
    showChrome()
    if (playing) scheduleHide()
  }
  const onMouseLeave = () => {
    if (playing) {
      // Hide quickly when playing - user has stepped away
      clearHideTimer()
      hideTimerRef.current = setTimeout(() => setChromeVisible(false), 300)
    } else {
      // Paused + mouse leaves -> fade away
      setChromeVisible(false)
    }
  }
  const onMouseEnter = () => {
    showChrome()
  }

  // Mobile tap: toggle controls visibility for a short window. We only
  // do this on touch-only devices; desktop click goes to the play
  // toggle below.
  const handleTouchStart = (e: React.TouchEvent) => {
    e.stopPropagation()
    if (chromeVisible) {
      setChromeVisible(false)
      clearHideTimer()
    } else {
      showChrome()
      clearHideTimer()
      hideTimerRef.current = setTimeout(
        () => setChromeVisible(false),
        MOBILE_TAP_SHOW_MS,
      )
    }
  }

  // ---- Play / pause -----------------------------------------------------

  // play() returns a promise; if a pause() lands before it resolves the
  // browser rejects with AbortError ("interrupted by a call to pause()").
  // We swallow that specific error because it's expected user interaction,
  // not a real failure. Other rejections (autoplay block, decode error)
  // still surface so they're visible during development.
  const safePlay = (v: HTMLVideoElement) => {
    const p = v.play()
    if (p && typeof p.catch === 'function') {
      p.catch((err) => {
        if (err?.name !== 'AbortError') console.error('Video play failed:', err)
      })
    }
  }

  const togglePlay = useCallback(() => {
    const v = videoElRef.current
    if (!v) return
    if (v.paused) {
      // Restart-after-end. v.ended is the primary signal because for
      // some HandBrake clips v.duration is Infinity and a pure
      // (currentTime >= duration) check never triggers.
      const atEnd =
        v.ended ||
        (Number.isFinite(v.duration) &&
          v.duration > 0 &&
          v.currentTime >= v.duration - 0.05)
      if (atEnd) {
        // Don't call play() until the seek has actually completed.
        // If we set currentTime = 0 and immediately call play(),
        // some browsers (Chrome in particular) still see the element
        // as "ended" until the seek lands, and play() is a no-op -
        // the button flips to "playing" but the frame stays parked
        // at the end. Wait for the seeked event, then play.
        const onSeek = () => {
          v.removeEventListener('seeked', onSeek)
          safePlay(v)
        }
        v.addEventListener('seeked', onSeek)
        v.currentTime = 0
      } else {
        safePlay(v)
      }
    } else {
      v.pause()
    }
  }, [])

  // Click on the video surface (not on chrome) toggles play. Native
  // controls aren't there to intercept anymore.
  const handleSurfaceClick = (e: React.MouseEvent) => {
    // Only count clicks on the video itself, not bubbled clicks from
    // the chrome we render below.
    if (e.target === e.currentTarget || e.target instanceof HTMLVideoElement) {
      togglePlay()
    }
  }

  // ---- Seek + scrubber --------------------------------------------------

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

  // ---- Volume -----------------------------------------------------------

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

  // ---- Playback speed ---------------------------------------------------

  const setSpeed = (rate: number) => {
    const v = videoElRef.current
    if (!v) return
    v.playbackRate = rate
    setPlaybackRate(rate)
    setShowSpeedMenu(false)
  }

  // ---- Fullscreen -------------------------------------------------------

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

  // ---- Keyboard shortcuts (when player has focus / is hovered) ----------

  useEffect(() => {
    const node = containerRef.current
    if (!node) return
    const onKey = (e: KeyboardEvent) => {
      // Don't steal typing
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      // Only react when the player is hovered / focused
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
        case 'j':
        case 'J':
          e.preventDefault()
          seekBy(-10)
          break
        case 'l':
        case 'L':
          e.preventDefault()
          seekBy(10)
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
        case ',':
          // Frame back (~1/30s nudge)
          e.preventDefault()
          if (videoElRef.current) {
            videoElRef.current.pause()
            seekBy(-1 / 30)
          }
          break
        case '.':
          e.preventDefault()
          if (videoElRef.current) {
            videoElRef.current.pause()
            seekBy(1 / 30)
          }
          break
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [togglePlay, toggleFullscreen, duration])

  // ---- Render -----------------------------------------------------------

  // While annotating, force chrome hidden + don't react to mouse moves.
  const chromeShown = !hideControls && chromeVisible
  const displayedTime = scrubPreview ?? currentTime
  // Cap at 100 so a stale-small duration (e.g. HandBrake clip whose real
  // length hasn't arrived via durationchange yet) can't paint the
  // playhead off the right edge of the track.
  const progressPct =
    duration > 0 ? Math.min(100, (displayedTime / duration) * 100) : 0

  // Layout strategy:
  //
  //   - The outer wrapper (containerRef) handles input, fullscreen, and
  //     horizontal centering. It does NOT have its own aspect ratio.
  //   - The inner "frame" sizes itself to whatever the video naturally
  //     renders at (browser-decided), via inline-block + max constraints
  //     on the <video> element. The browser is the only thing that
  //     actually knows the true displayed aspect (it decoded the file
  //     and is rendering frames), so we let it drive.
  //   - All chrome (scrubber, buttons, play button) is positioned
  //     absolutely inside the frame, so it always matches the video's
  //     real bounds - including after the asset is edited/replaced
  //     and re-renders at a new size.
  //
  // This approach is robust to mangled metadata (e.g. HandBrake-
  // compressed clips whose stored width/height don't match what the
  // browser actually paints): we never trust a number, we just use
  // whatever the video element rendered.
  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      onMouseMove={hideControls ? undefined : onMouseMove}
      onMouseEnter={hideControls ? undefined : onMouseEnter}
      onMouseLeave={hideControls ? undefined : onMouseLeave}
      onTouchStart={hideControls ? undefined : handleTouchStart}
      onClick={hideControls ? undefined : handleSurfaceClick}
      className={`relative group ${
        isFullscreen
          ? 'h-screen w-screen bg-black overflow-hidden flex items-center justify-center'
          : fill
          ? 'h-full w-full bg-black overflow-hidden'
          : // items-center stops the inner frame from stretching down
            // to fill the parent's cross-axis - which is what was
            // leaving empty black space below 16:9 clips when the
            // surrounding section happened to be taller than the
            // player.
            'w-full flex justify-center items-center'
      } ${className}`}
    >
      <div
        className={
          isFullscreen
            ? 'relative h-full w-full'
            : fill
            ? 'relative h-full w-full'
            : 'relative bg-black rounded-lg overflow-hidden max-w-full'
        }
        style={
          !isFullscreen && !fill && bestAspect
            ? {
                // Lock the frame to the best-of-three aspect ratio
                // (see bestAspect computation). Width follows from
                // aspect, capped by parent (max-w:100%) and 70vh tall.
                aspectRatio: `${bestAspect}`,
                width: `calc(70vh * ${bestAspect})`,
                maxWidth: '100%',
                maxHeight: '70vh',
              }
            : undefined
        }
      >
      <video
        // key={src} forces a clean remount when the asset is swapped.
        // Without it, React keeps the same <video> element across src
        // changes and the element's internal state (.ended, .currentTime
        // parked at duration, sometimes a sticky paused-at-end state)
        // bleeds over from the previous clip - which is why "replace
        // a video, watch it once, click play again" was a no-op until
        // the page was reloaded.
        key={src}
        ref={setMergedRef}
        src={src}
        poster={poster}
        playsInline
        preload={isActive ? 'metadata' : 'none'}
        onPlay={() => {
          setPlaying(true)
          if (playing === false) scheduleHide()
          onPlay?.()
        }}
        onPause={() => {
          setPlaying(false)
          showChrome()
        }}
        onTimeUpdate={(e: SyntheticEvent<HTMLVideoElement>) => {
          if (!scrubbing)
            setCurrentTime((e.target as HTMLVideoElement).currentTime)
          onTimeUpdate?.()
        }}
        onLoadedMetadata={(e: SyntheticEvent<HTMLVideoElement>) => {
          const t = e.target as HTMLVideoElement
          // Only fall back to the <video> element's reported duration
          // if we don't already have one from Cloudinary's upload
          // metadata. For progressively-served files the element's
          // .duration grows alongside currentTime, which would make
          // the displayed "total" walk forward with playback.
          if (
            !(sourceDuration && sourceDuration > 0) &&
            Number.isFinite(t.duration) &&
            t.duration > 0
          ) {
            setDuration(t.duration)
          }
          if (t.videoWidth > 0 && t.videoHeight > 0) {
            setVideoAspect(t.videoWidth / t.videoHeight)
          }
          setVolume(t.volume)
          setMuted(t.muted)
          onLoadedMetadata?.()
        }}
        onDurationChange={(e: SyntheticEvent<HTMLVideoElement>) => {
          const t = e.target as HTMLVideoElement
          if (
            !(sourceDuration && sourceDuration > 0) &&
            Number.isFinite(t.duration) &&
            t.duration > 0
          ) {
            setDuration(t.duration)
          }
        }}
        onSeeked={() => onSeeked?.()}
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
            : bestAspect
            ? // Frame is locked to the perceived aspect (bestAspect).
              // We deliberately use object-fill (not -contain) so when
              // the video's intrinsic aspect DISAGREES with the frame
              // - which is what happens with HandBrake-encoded clips
              // whose 9:16 content has been squished into a 1:1 frame
              // buffer (file says 1080x1080, poster says 9:16) - the
              // browser stretches the squished buffer asymmetrically
              // back into the right-aspect box, un-squishing the
              // content. When all signals agree (every non-HandBrake
              // file), there's no aspect mismatch and fill behaves
              // identically to contain.
              'block h-full w-full object-fill'
            : // No aspect signal yet - fall back to natural sizing
              // capped by 70vh so the player still has the right shape
              // during the brief window before signals arrive.
              'block max-h-[70vh] max-w-full object-contain'
        }
      />

      {/* Center play button when paused (large, easy click) */}
      {!playing && !hideControls && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            togglePlay()
          }}
          aria-label="Play"
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-16 w-16 rounded-full bg-black/50 hover:bg-black/70 backdrop-blur-sm flex items-center justify-center transition-all hover:scale-105 pointer-events-auto"
        >
          <Play className="h-8 w-8 text-white translate-x-0.5" fill="white" />
        </button>
      )}

      {/* Chrome - fades together as a single overlay */}
      <div
        className={`absolute inset-x-0 bottom-0 transition-opacity duration-200 ${
          chromeShown ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        // The chrome wrapper swallows clicks so the surface-click toggle
        // doesn't fire when the user interacts with controls.
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Gradient backdrop so chrome stays legible on bright frames */}
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
            {/* Track */}
            <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1 rounded-full bg-white/25 group-hover/scrub:h-1.5 transition-all" />
            {/* Buffered (skipped - native buffered is non-trivial; future) */}
            {/* Played */}
            <div
              className="absolute left-0 top-1/2 -translate-y-1/2 h-1 rounded-full group-hover/scrub:h-1.5 transition-all"
              style={{ width: `${progressPct}%`, backgroundColor: BRAND }}
            />
            {/* Thumb */}
            <div
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-3 w-3 rounded-full shadow-md opacity-0 group-hover/scrub:opacity-100 transition-opacity"
              style={{ left: `${progressPct}%`, backgroundColor: BRAND }}
            />
            {/* Comment markers */}
            {markers.map((m) => {
              if (!duration || m.seconds < 0 || m.seconds > duration) return null
              const pct = (m.seconds / duration) * 100
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onMarkerClick?.(m.id)
                    seekTo(m.seconds)
                  }}
                  title={`Comment at ${formatTime(m.seconds)}`}
                  className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-2.5 w-2.5 rounded-full ring-2 ring-black/40 hover:scale-125 transition-transform"
                  style={{
                    left: `${pct}%`,
                    backgroundColor: m.color || '#F59E0B',
                  }}
                />
              )
            })}
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

            {/* Volume - slider slides out horizontally on hover, on the
                same row as the mute button. The clip wrapper has the
                width animation so the native range thumb can't bleed
                over the button when collapsed. */}
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

            {/* Playback speed */}
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
