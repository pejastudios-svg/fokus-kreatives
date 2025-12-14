'use client'

import { useState, useRef } from 'react'
import { Upload, X, Loader2, CheckCircle } from 'lucide-react'
import { Button } from './Button'

interface FileUploadProps {
  onUpload: (url: string) => void
  folder?: string
  accept?: string
  label?: string
}

export function FileUpload({ onUpload, folder = 'general', accept = '*', label = 'Upload file' }: FileUploadProps) {
  const [isUploading, setIsUploading] = useState(false)
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setIsUploading(true)
    setError(null)

    const formData = new FormData()
    formData.append('file', file)
    formData.append('folder', folder)

    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      })

      const data = await response.json()

      if (data.success) {
        setUploadedUrl(data.url)
        onUpload(data.url)
      } else {
        setError(data.error || 'Upload failed')
      }
    } catch (err) {
      setError('Upload failed')
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleUpload}
        className="hidden"
      />
      
      {uploadedUrl ? (
        <div className="flex items-center gap-3 p-4 bg-green-50 rounded-lg">
          <CheckCircle className="h-5 w-5 text-green-600" />
          <span className="text-green-700 text-sm flex-1 truncate">{uploadedUrl.split('/').pop()}</span>
          <button 
            onClick={() => { setUploadedUrl(null); onUpload('') }}
            className="p-1 hover:bg-green-100 rounded"
          >
            <X className="h-4 w-4 text-green-600" />
          </button>
        </div>
      ) : (
        <div 
          onClick={() => inputRef.current?.click()}
          className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-[#2B79F7] transition-colors cursor-pointer"
        >
          {isUploading ? (
            <Loader2 className="h-10 w-10 text-[#2B79F7] mx-auto mb-4 animate-spin" />
          ) : (
            <Upload className="h-10 w-10 text-gray-400 mx-auto mb-4" />
          )}
          <p className="text-gray-600 mb-2">{label}</p>
          <p className="text-sm text-gray-400">Click to browse</p>
        </div>
      )}
      
      {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
    </div>
  )
}