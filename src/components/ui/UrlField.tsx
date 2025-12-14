'use client'

import { useState } from 'react'
import { ExternalLink, Link as LinkIcon, Type } from 'lucide-react'

type UrlDisplayType = 'button' | 'link' | 'hyperlink'

interface UrlFieldProps {
  value: string
  displayType: UrlDisplayType
  hyperlinkText?: string
  onChange: (value: string, displayType: UrlDisplayType, hyperlinkText?: string) => void
  readonly?: boolean
}

export function UrlField({ value, displayType, hyperlinkText, onChange, readonly = false }: UrlFieldProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [tempUrl, setTempUrl] = useState(value)
  const [tempType, setTempType] = useState(displayType)
  const [tempText, setTempText] = useState(hyperlinkText || '')

  if (readonly || !isEditing) {
    if (!value) {
      return (
        <span 
          className="text-theme-tertiary cursor-text"
          onClick={() => !readonly && setIsEditing(true)}
        >
          —
        </span>
      )
    }

    return (
      <span onClick={() => !readonly && setIsEditing(true)} className="cursor-pointer">
        {displayType === 'button' && (
          <a 
            href={value} 
            target="_blank" 
            rel="noopener noreferrer"
            className="url-button"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open Link
          </a>
        )}
        {displayType === 'link' && (
          <a 
            href={value} 
            target="_blank" 
            rel="noopener noreferrer"
            className="url-link"
            onClick={(e) => e.stopPropagation()}
          >
            {value}
          </a>
        )}
        {displayType === 'hyperlink' && (
          <a 
            href={value} 
            target="_blank" 
            rel="noopener noreferrer"
            className="url-hyperlink"
            onClick={(e) => e.stopPropagation()}
          >
            {hyperlinkText || 'Click here'}
          </a>
        )}
      </span>
    )
  }

  return (
    <div className="space-y-3 p-3 bg-theme-tertiary rounded-xl" onClick={(e) => e.stopPropagation()}>
      {/* URL Input */}
      <input
        type="url"
        value={tempUrl}
        onChange={(e) => setTempUrl(e.target.value)}
        placeholder="https://..."
        className="w-full input-premium text-sm"
        autoFocus
      />

      {/* Display Type Selection */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setTempType('button')}
          className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
            tempType === 'button' 
              ? 'bg-[#2B79F7] text-white' 
              : 'bg-theme-secondary text-theme-secondary hover:bg-theme-tertiary'
          }`}
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Button
        </button>
        <button
          type="button"
          onClick={() => setTempType('link')}
          className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
            tempType === 'link' 
              ? 'bg-[#2B79F7] text-white' 
              : 'bg-theme-secondary text-theme-secondary hover:bg-theme-tertiary'
          }`}
        >
          <LinkIcon className="h-3.5 w-3.5" />
          Link
        </button>
        <button
          type="button"
          onClick={() => setTempType('hyperlink')}
          className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
            tempType === 'hyperlink' 
              ? 'bg-[#2B79F7] text-white' 
              : 'bg-theme-secondary text-theme-secondary hover:bg-theme-tertiary'
          }`}
        >
          <Type className="h-3.5 w-3.5" />
          Text
        </button>
      </div>

      {/* Hyperlink text input */}
      {tempType === 'hyperlink' && (
        <input
          type="text"
          value={tempText}
          onChange={(e) => setTempText(e.target.value)}
          placeholder="Display text..."
          className="w-full input-premium text-sm"
        />
      )}

      {/* Actions */}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setIsEditing(false)}
          className="px-3 py-1.5 text-xs text-theme-secondary hover:text-theme-primary"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => {
            onChange(tempUrl, tempType, tempText)
            setIsEditing(false)
          }}
          className="px-3 py-1.5 text-xs bg-[#2B79F7] text-white rounded-lg hover:bg-[#2B79F7]/90"
        >
          Save
        </button>
      </div>
    </div>
  )
}