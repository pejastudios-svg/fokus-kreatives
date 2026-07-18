'use client'

import { useState, useRef, useCallback } from 'react'
import { Upload, X, Loader2, CheckCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

interface FileUploadProps {
  onUpload: (url: string) => void
  folder?: string
  accept?: string
  label?: string
}

/** Match a file against an <input accept> string ("application/pdf",
 *  "image/*", ".pdf,.docx", ...). Lenient: unknown accept tokens pass. */
function fileMatchesAccept(file: File, accept: string): boolean {
  if (!accept || accept === '*' || accept === '*/*') return true
  const tokens = accept.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean)
  if (tokens.length === 0) return true
  const type = (file.type || '').toLowerCase()
  const name = file.name.toLowerCase()
  return tokens.some((t) => {
    if (t.startsWith('.')) return name.endsWith(t)
    if (t.endsWith('/*')) return type.startsWith(t.slice(0, -1))
    return type === t
  })
}

export function FileUpload({ onUpload, folder = 'general', accept = '*', label = 'Upload file' }: FileUploadProps) {
  const [isUploading, setIsUploading] = useState(false)
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  // Drag events fire enter/leave for every child node - a counter keeps the
  // highlight stable instead of flickering as the cursor crosses children.
  const dragDepth = useRef(0)

  const doUpload = useCallback(
    async (file: File) => {
      if (!fileMatchesAccept(file, accept)) {
        setError(`That file type isn't supported here (expected ${accept}).`)
        return
      }
      setIsUploading(true)
      setError(null)
      try {
        // 1. Get a signed upload URL. The file itself goes straight from
        //    the browser to storage - routing bytes through /api/upload hit
        //    the serverless ~4.5MB body cap, which is why brand-guideline
        //    PDFs failed with a bare "Upload failed" in production.
        const signRes = await fetch('/api/upload/sign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ folder, name: file.name }),
        })
        let sign: { success?: boolean; path?: string; token?: string; publicUrl?: string; error?: string }
        try {
          sign = await signRes.json()
        } catch {
          throw new Error(`Upload could not start (server error ${signRes.status}). Try again.`)
        }
        if (!sign.success || !sign.path || !sign.token || !sign.publicUrl) {
          throw new Error(sign.error || 'Upload could not start. Try again.')
        }

        // 2. Direct upload to storage with the signed token.
        const supabase = createClient()
        const { error: upErr } = await supabase.storage
          .from('uploads')
          .uploadToSignedUrl(sign.path, sign.token, file, {
            contentType: file.type || undefined,
          })
        if (upErr) {
          throw new Error(upErr.message || 'Upload failed. Try again.')
        }

        setUploadedUrl(sign.publicUrl)
        onUpload(sign.publicUrl)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Upload failed. Try again.')
      } finally {
        setIsUploading(false)
      }
    },
    [accept, folder, onUpload],
  )

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    // Reset so picking the same file again re-triggers onChange.
    e.target.value = ''
    if (file) void doUpload(file)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    dragDepth.current = 0
    setIsDragging(false)
    if (isUploading) return
    const file = e.dataTransfer.files?.[0]
    if (file) void doUpload(file)
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleInputChange}
        className="hidden"
      />

      {uploadedUrl ? (
        <div className="flex items-center gap-3 p-4 bg-green-50 rounded-lg">
          <CheckCircle className="h-5 w-5 text-green-600" />
          <span className="text-green-700 text-sm flex-1 truncate">{uploadedUrl.split('/').pop()}</span>
          <button
            onClick={() => { setUploadedUrl(null); onUpload('') }}
            className="p-1 hover:bg-green-500/10 rounded"
          >
            <X className="h-4 w-4 text-green-600" />
          </button>
        </div>
      ) : (
        <div
          onClick={() => !isUploading && inputRef.current?.click()}
          onDragEnter={(e) => {
            e.preventDefault()
            dragDepth.current += 1
            setIsDragging(true)
          }}
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={(e) => {
            e.preventDefault()
            dragDepth.current -= 1
            if (dragDepth.current <= 0) {
              dragDepth.current = 0
              setIsDragging(false)
            }
          }}
          onDrop={handleDrop}
          className={[
            'border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer',
            isDragging
              ? 'border-[#2B79F7] bg-[#2B79F7]/5'
              : 'border-[var(--border-primary)] hover:border-[#2B79F7]',
          ].join(' ')}
        >
          {isUploading ? (
            <Loader2 className="h-10 w-10 text-[#2B79F7] mx-auto mb-4 animate-spin" />
          ) : (
            <Upload className={`h-10 w-10 mx-auto mb-4 ${isDragging ? 'text-[#2B79F7]' : 'text-[var(--text-tertiary)]'}`} />
          )}
          <p className="text-[var(--text-secondary)] mb-2">
            {isUploading ? 'Uploading...' : isDragging ? 'Drop to upload' : label}
          </p>
          <p className="text-sm text-[var(--text-tertiary)]">
            {isUploading ? 'Large files can take a minute' : 'Click to browse or drag and drop'}
          </p>
        </div>
      )}

      {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
    </div>
  )
}
