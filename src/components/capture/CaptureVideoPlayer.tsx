'use client'

// Direct-video player with our own minimal controls instead of iOS's native
// set (which spreads play / skip / AirPlay / captions / speed across a tall
// video and looks scattered). One tidy bar: play, time, scrubber, mute,
// fullscreen. Plays inline on mobile.

import { useEffect, useRef, useState } from 'react'
import { Play, Pause, Volume2, VolumeX, Maximize, Minimize } from 'lucide-react'

export function CaptureVideoPlayer({ src }: { src: string }) {
  const ref = useRef<HTMLVideoElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const [cur, setCur] = useState(0)
  const [dur, setDur] = useState(0)
  const [fs, setFs] = useState(false)
  const [failed, setFailed] = useState(false)

  // Track fullscreen so we can center + fill the video instead of leaving it
  // capped at 70vh in the top-left corner of a black screen.
  useEffect(() => {
    const onFs = () => setFs(document.fullscreenElement === wrapRef.current)
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  const fmt = (s: number) => {
    if (!isFinite(s) || s < 0) return '0:00'
    const m = Math.floor(s / 60)
    const ss = Math.floor(s % 60).toString().padStart(2, '0')
    return `${m}:${ss}`
  }
  const toggle = () => {
    const v = ref.current
    if (!v) return
    if (v.paused) void v.play()
    else v.pause()
  }
  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const v = ref.current
    if (!v || !dur) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    v.currentTime = Math.max(0, Math.min(1, x)) * dur
  }
  const toggleMute = () => {
    const v = ref.current
    if (!v) return
    v.muted = !v.muted
    setMuted(v.muted)
  }
  const fullscreen = () => {
    const doc = document as Document & {
      webkitFullscreenElement?: Element
      webkitExitFullscreen?: () => void
    }
    // Already fullscreen → minimize back out.
    if (document.fullscreenElement || doc.webkitFullscreenElement) {
      if (document.exitFullscreen) void document.exitFullscreen()
      else if (doc.webkitExitFullscreen) doc.webkitExitFullscreen()
      return
    }
    const el = wrapRef.current
    const vid = ref.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null
    if (el?.requestFullscreen) void el.requestFullscreen()
    else if (vid?.webkitEnterFullscreen) vid.webkitEnterFullscreen() // iOS Safari
  }

  return (
    <div
      ref={wrapRef}
      data-preview-interactive
      className={`relative mx-auto max-w-full overflow-hidden bg-black ${
        fs ? 'flex h-full w-full items-center justify-center rounded-none' : 'w-fit rounded-xl'
      }`}
    >
      <video
        ref={ref}
        src={src}
        playsInline
        preload="metadata"
        className={`block max-w-full object-contain ${fs ? 'h-full max-h-full' : 'max-h-[70vh]'}`}
        onClick={toggle}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={() => setCur(ref.current?.currentTime ?? 0)}
        onLoadedMetadata={() => setDur(ref.current?.duration ?? 0)}
        onError={() => setFailed(true)}
        onLoadStart={() => setFailed(false)}
      />
      {failed && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/80 p-4 text-center text-sm text-white">
          <p>This video couldn&apos;t load.</p>
          <a href={src} target="_blank" rel="noopener noreferrer" className="underline opacity-80">Open in new tab</a>
        </div>
      )}
      {!playing && (
        <button type="button" onClick={toggle} aria-label="Play" className="absolute inset-0 flex items-center justify-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/55">
            <Play className="h-7 w-7 translate-x-0.5 text-white" fill="currentColor" />
          </span>
        </button>
      )}
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/70 to-transparent px-3 pb-2 pt-6 text-white">
        <button type="button" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'} className="shrink-0">
          {playing ? <Pause className="h-4 w-4" fill="currentColor" /> : <Play className="h-4 w-4" fill="currentColor" />}
        </button>
        <span className="shrink-0 text-[11px] tabular-nums">{fmt(cur)}</span>
        <div className="relative h-1 flex-1 cursor-pointer rounded-full bg-white/30" onClick={seek}>
          <div className="absolute inset-y-0 left-0 rounded-full bg-white" style={{ width: dur ? `${(cur / dur) * 100}%` : '0%' }} />
        </div>
        <span className="shrink-0 text-[11px] tabular-nums">{fmt(dur)}</span>
        <button type="button" onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'} className="shrink-0">
          {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        </button>
        <button type="button" onClick={fullscreen} aria-label={fs ? 'Minimize' : 'Fullscreen'} className="shrink-0">
          {fs ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
        </button>
      </div>
    </div>
  )
}
