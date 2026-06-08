'use client'

// Textarea with built-in voice notes. Tap the mic and speak:
//   - the browser's native Web Speech API transcribes live into the field
//     (interim words appear as you talk, finalized as you pause), and
//   - MediaRecorder captures the audio; on stop it uploads to storage and
//     surfaces a player so the recorded note can be played back later.
//
// Free, no API key, no rate limit. Graceful fallback: if neither API is
// available (e.g. older browsers / Firefox for SpeechRecognition) the mic
// hides and it behaves as a normal textarea.

import { useEffect, useRef, useState } from 'react'
import { Mic, Square, Trash2, Loader2 } from 'lucide-react'

// --- Minimal typings for the Web Speech API (absent from the TS DOM lib) ---
interface SRAlternative {
  transcript: string
}
interface SRResult {
  readonly isFinal: boolean
  readonly length: number
  [index: number]: SRAlternative
}
interface SRResultList {
  readonly length: number
  [index: number]: SRResult
}
interface SRResultEvent {
  readonly resultIndex: number
  readonly results: SRResultList
}
interface SpeechRecognitionInstance {
  lang: string
  continuous: boolean
  interimResults: boolean
  start(): void
  stop(): void
  onresult: ((e: SRResultEvent) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
}
type SpeechRecognitionCtor = new () => SpeechRecognitionInstance

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition || w.webkitSpeechRecognition || null
}

function pickAudioMime(): string {
  if (typeof MediaRecorder === 'undefined') return ''
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c
  }
  return ''
}

interface Props {
  value: string
  onChange: (value: string) => void
  /** Saved voice-note URL for this answer (null/empty = none yet). */
  audioUrl?: string | null
  /** Called with the uploaded URL after recording, or null when removed. */
  onAudioChange?: (url: string | null) => void
  /** Storage subfolder, e.g. 'voice-notes/questions'. */
  uploadFolder?: string
  placeholder?: string
  rows?: number
  className?: string
  onBlur?: () => void
}

export function VoiceTextarea({
  value,
  onChange,
  audioUrl,
  onAudioChange,
  uploadFolder = 'voice-notes',
  placeholder,
  rows = 4,
  className = '',
  onBlur,
}: Props) {
  const [micSupported, setMicSupported] = useState(false)
  const [recording, setRecording] = useState(false)
  const [uploading, setUploading] = useState(false)

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)
  const mediaRecRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const baseRef = useRef('')
  const finalRef = useRef('')
  // Keep latest onChange so the recognition callback (bound once) stays fresh.
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    const sr = getSpeechRecognitionCtor() !== null
    const rec =
      typeof window !== 'undefined' &&
      typeof window.MediaRecorder !== 'undefined' &&
      !!navigator.mediaDevices?.getUserMedia
    // Show the mic if EITHER capability exists (transcription or recording).
    setMicSupported(sr || rec)
  }, [])

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop()
      mediaRecRef.current?.stop()
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  const startTranscription = () => {
    const Ctor = getSpeechRecognitionCtor()
    if (!Ctor) return
    const rec = new Ctor()
    rec.lang = (typeof navigator !== 'undefined' && navigator.language) || 'en-US'
    rec.continuous = true
    rec.interimResults = true
    baseRef.current = value ? value.trimEnd() : ''
    finalRef.current = ''
    rec.onresult = (e) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]
        const text = res[0]?.transcript ?? ''
        if (res.isFinal) finalRef.current += text
        else interim += text
      }
      const spoken = (finalRef.current + interim).trim()
      onChangeRef.current([baseRef.current, spoken].filter(Boolean).join(' '))
    }
    rec.onerror = () => {}
    rec.onend = () => {
      recognitionRef.current = null
    }
    recognitionRef.current = rec
    try {
      rec.start()
    } catch {
      /* already running */
    }
  }

  const uploadBlob = async (blob: Blob) => {
    if (!blob.size) return
    setUploading(true)
    try {
      const ext = blob.type.includes('mp4')
        ? 'mp4'
        : blob.type.includes('ogg')
        ? 'ogg'
        : 'webm'
      const file = new File([blob], `voice-${Date.now()}.${ext}`, {
        type: blob.type || 'audio/webm',
      })
      const fd = new FormData()
      fd.append('file', file)
      fd.append('folder', uploadFolder)
      const res = await fetch('/api/upload', { method: 'POST', body: fd })
      const data = await res.json()
      if (data?.success && data?.url) onAudioChange?.(data.url)
      else console.error('voice upload failed:', data?.error)
    } catch (err) {
      console.error('voice upload error:', err)
    } finally {
      setUploading(false)
    }
  }

  const start = async () => {
    // Audio capture (best-effort - transcription still works without it).
    if (
      typeof window !== 'undefined' &&
      typeof window.MediaRecorder !== 'undefined' &&
      navigator.mediaDevices?.getUserMedia
    ) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        streamRef.current = stream
        const mime = pickAudioMime()
        const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
        chunksRef.current = []
        mr.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data)
        }
        mr.onstop = async () => {
          const blob = new Blob(chunksRef.current, { type: mr.mimeType || 'audio/webm' })
          streamRef.current?.getTracks().forEach((t) => t.stop())
          streamRef.current = null
          await uploadBlob(blob)
        }
        mediaRecRef.current = mr
        mr.start()
      } catch (err) {
        console.error('mic access error:', err)
      }
    }
    startTranscription()
    setRecording(true)
  }

  const stop = () => {
    recognitionRef.current?.stop()
    if (mediaRecRef.current && mediaRecRef.current.state !== 'inactive') {
      mediaRecRef.current.stop()
    }
    mediaRecRef.current = null
    setRecording(false)
  }

  return (
    <div>
      <div className="relative">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          placeholder={placeholder}
          rows={rows}
          className={className}
        />
        {micSupported && (
          <button
            type="button"
            onClick={() => (recording ? stop() : start())}
            disabled={uploading}
            title={recording ? 'Stop recording' : 'Record a voice note'}
            aria-label={recording ? 'Stop recording' : 'Record a voice note'}
            className={`absolute bottom-2.5 right-2.5 inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors disabled:opacity-60 ${
              recording
                ? 'bg-red-500 text-white animate-pulse'
                : 'bg-[var(--bg-card)] border border-[var(--border-primary)] text-[var(--text-tertiary)] hover:text-[#2B79F7] hover:border-[#2B79F7]'
            }`}
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : recording ? (
              <Square className="h-3.5 w-3.5" />
            ) : (
              <Mic className="h-4 w-4" />
            )}
          </button>
        )}
        {recording && (
          <span className="absolute bottom-3.5 right-12 text-[11px] font-medium text-red-500">
            Listening…
          </span>
        )}
        {uploading && !recording && (
          <span className="absolute bottom-3.5 right-12 text-[11px] font-medium text-[var(--text-tertiary)]">
            Saving voice note…
          </span>
        )}
      </div>

      {audioUrl && !recording && !uploading && (
        <div className="mt-2 flex items-center gap-2">
          <audio controls src={audioUrl} className="h-9 flex-1 min-w-0" />
          {onAudioChange && (
            <button
              type="button"
              onClick={() => onAudioChange(null)}
              title="Remove voice note"
              className="shrink-0 p-1.5 rounded-md text-[var(--text-tertiary)] hover:text-red-500 hover:bg-red-500/10 transition-colors"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      )}
    </div>
  )
}
