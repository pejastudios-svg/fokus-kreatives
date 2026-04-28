'use client'

import { useEffect, useRef, useState } from 'react'
import { Camera, Eye, RefreshCw, Trash2, UserCircle, X, Loader2 } from 'lucide-react'

type FallbackKind = 'user' | 'initial'

interface Props {
  /** Current image URL. Empty string / null means "no picture set". */
  value: string | null | undefined
  /** Called with the new URL after upload, or '' when removed. */
  onChange: (next: string) => void
  /** Supabase storage folder to upload into. */
  folder: string
  /** Accept filter for the file input. */
  accept?: string
  /** What to show when there's no image. 'initial' uses `initialChar`, 'user' uses a generic icon. */
  fallback?: FallbackKind
  /** Single character (already uppercased preferred) shown when fallback === 'initial'. */
  initialChar?: string
  /** Tailwind size classes for the circle. Defaults to a large 144px. */
  sizeClass?: string
  /** Optional aria-label for the avatar button. */
  ariaLabel?: string
  /** Disable interaction (read-only display). */
  disabled?: boolean
}

export function ProfilePictureUpload({
  value,
  onChange,
  folder,
  accept = 'image/*',
  fallback = 'user',
  initialChar,
  sizeClass = 'h-36 w-36',
  ariaLabel = 'Profile picture',
  disabled = false,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuMounted, setMenuMounted] = useState(false)
  const [viewerOpen, setViewerOpen] = useState(false)
  const [viewerMounted, setViewerMounted] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const hasImage = Boolean(value && value.trim())

  // Drive open/close transitions for the action menu and viewer.
  useEffect(() => {
    if (menuOpen) {
      setMenuMounted(true)
      return
    }
    if (!menuMounted) return
    const t = setTimeout(() => setMenuMounted(false), 200)
    return () => clearTimeout(t)
  }, [menuOpen, menuMounted])

  useEffect(() => {
    if (viewerOpen) {
      setViewerMounted(true)
      return
    }
    if (!viewerMounted) return
    const t = setTimeout(() => setViewerMounted(false), 200)
    return () => clearTimeout(t)
  }, [viewerOpen, viewerMounted])

  useEffect(() => {
    if (!menuOpen && !viewerOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (viewerOpen) setViewerOpen(false)
      else if (menuOpen) setMenuOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [menuOpen, viewerOpen])

  const triggerFilePicker = () => {
    setError(null)
    inputRef.current?.click()
  }

  const onAvatarClick = () => {
    if (disabled || isUploading) return
    if (hasImage) {
      setMenuOpen(true)
    } else {
      triggerFilePicker()
    }
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-uploading the same file later
    if (!file) return

    setIsUploading(true)
    setError(null)
    setMenuOpen(false)

    const formData = new FormData()
    formData.append('file', file)
    formData.append('folder', folder)

    try {
      const res = await fetch('/api/upload', { method: 'POST', body: formData })
      const data = await res.json()
      if (data.success) {
        onChange(data.url)
      } else {
        setError(data.error || 'Upload failed')
      }
    } catch (err) {
      console.error('avatar upload error:', err)
      setError('Upload failed')
    } finally {
      setIsUploading(false)
    }
  }

  const handleRemove = () => {
    onChange('')
    setMenuOpen(false)
  }

  const handleView = () => {
    setMenuOpen(false)
    setViewerOpen(true)
  }

  const handleReplace = () => {
    setMenuOpen(false)
    triggerFilePicker()
  }

  return (
    <div className="inline-flex flex-col items-center">
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleFileChange}
        className="hidden"
      />

      <div className={`relative ${sizeClass}`}>
        <button
          type="button"
          onClick={onAvatarClick}
          disabled={disabled}
          aria-label={ariaLabel}
          className={`relative h-full w-full rounded-full overflow-hidden ring-4 ring-[#E8F1FF] transition-shadow ${
            disabled ? 'cursor-default' : 'cursor-pointer hover:ring-[#5A9AFF]'
          }`}
        >
          {hasImage ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={value!}
              alt={ariaLabel}
              className="h-full w-full object-cover"
            />
          ) : fallback === 'initial' && initialChar ? (
            <div className="h-full w-full bg-brand-gradient flex items-center justify-center text-white font-bold text-4xl">
              {initialChar.charAt(0).toUpperCase()}
            </div>
          ) : (
            <div className="h-full w-full bg-gray-100 flex items-center justify-center text-gray-400">
              <UserCircle className="h-2/3 w-2/3" strokeWidth={1.5} />
            </div>
          )}

          {isUploading && (
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
              <Loader2 className="h-8 w-8 text-white animate-spin" />
            </div>
          )}
        </button>

        {!disabled && (
          <button
            type="button"
            onClick={onAvatarClick}
            disabled={isUploading}
            aria-label={hasImage ? 'Change profile picture' : 'Upload profile picture'}
            title={hasImage ? 'Change profile picture' : 'Upload profile picture'}
            className="absolute bottom-1 right-1 inline-flex items-center justify-center h-10 w-10 rounded-full bg-[#2B79F7] text-white shadow-md ring-2 ring-white hover:bg-[#1E54B7] transition-colors disabled:opacity-50"
          >
            <Camera className="h-4 w-4" />
          </button>
        )}
      </div>

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      {/* Action modal: View / Remove / Replace */}
      {menuMounted && (
        <div
          className={`fixed inset-0 z-50 flex items-center justify-center p-4 transition-opacity duration-200 ${
            menuOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setMenuOpen(false)}
            aria-hidden="true"
          />
          <div
            className={`relative w-full max-w-sm bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden transition-all duration-200 ease-out ${
              menuOpen ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 translate-y-2'
            }`}
            role="dialog"
            aria-modal="true"
            aria-label="Profile picture options"
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
              <p className="text-sm font-semibold text-gray-900">Profile picture</p>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className="p-1.5 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="py-1">
              <ActionItem icon={Eye} label="View photo" onClick={handleView} />
              <ActionItem icon={RefreshCw} label="Replace photo" onClick={handleReplace} />
              <ActionItem
                icon={Trash2}
                label="Remove photo"
                onClick={handleRemove}
                tone="danger"
              />
            </div>
          </div>
        </div>
      )}

      {/* Viewer modal */}
      {viewerMounted && hasImage && (
        <div
          className={`fixed inset-0 z-[60] flex items-center justify-center p-4 transition-opacity duration-200 ${
            viewerOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
          onClick={() => setViewerOpen(false)}
        >
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" aria-hidden="true" />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setViewerOpen(false)
            }}
            className="absolute top-4 right-4 z-10 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white"
            aria-label="Close viewer"
          >
            <X className="h-5 w-5" />
          </button>
          <div
            className={`relative max-w-3xl max-h-[85vh] transition-all duration-200 ease-out ${
              viewerOpen ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={value!}
              alt={ariaLabel}
              className="rounded-2xl shadow-2xl max-h-[85vh] max-w-full object-contain"
            />
          </div>
        </div>
      )}
    </div>
  )
}

function ActionItem({
  icon: Icon,
  label,
  onClick,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  onClick: () => void
  tone?: 'danger'
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-5 py-3 text-sm transition-colors ${
        tone === 'danger'
          ? 'text-red-600 hover:bg-red-50'
          : 'text-gray-700 hover:bg-gray-50'
      }`}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  )
}
