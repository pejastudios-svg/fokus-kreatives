'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { Button } from './Button'
import { Input } from './Input'
import { cn } from '@/lib/utils'

export type ConfirmTone = 'danger' | 'warning' | 'default'

export interface ConfirmModalProps {
  open: boolean
  title: string
  message: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  tone?: ConfirmTone
  requirePassword?: boolean
  passwordLabel?: string
  onConfirm: (password?: string) => Promise<void> | void
  onClose: () => void
}

export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  requirePassword = false,
  passwordLabel = 'Enter your password to confirm',
  onConfirm,
  onClose,
}: ConfirmModalProps) {
  const [password, setPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) {
      setPassword('')
      setError('')
      setIsSubmitting(false)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, isSubmitting, onClose])

  if (!open) return null

  const toneStyles =
    tone === 'danger'
      ? { icon: 'text-red-500', btn: 'bg-red-500 hover:bg-red-600 text-white' }
      : tone === 'warning'
        ? { icon: 'text-yellow-500', btn: 'bg-yellow-500 hover:bg-yellow-600 text-white' }
        : { icon: 'text-[#2B79F7]', btn: '' }

  const handleConfirm = async () => {
    if (requirePassword && !password.trim()) {
      setError('Password is required')
      return
    }
    setError('')
    setIsSubmitting(true)
    try {
      await onConfirm(requirePassword ? password : undefined)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
      setIsSubmitting(false)
      return
    }
    setIsSubmitting(false)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={() => !isSubmitting && onClose()}
    >
      <div
        className="relative w-full max-w-md rounded-xl bg-[var(--bg-card)] border border-[var(--border-primary)] shadow-premium-lg"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <button
          type="button"
          onClick={onClose}
          disabled={isSubmitting}
          className="absolute top-3 right-3 p-1 rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] disabled:opacity-50"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="p-6">
          <div className="flex items-start gap-4">
            <div className={cn('shrink-0 mt-0.5', toneStyles.icon)}>
              <AlertTriangle className="h-6 w-6" />
            </div>
            <h3 className="flex-1 pt-0.5 text-lg font-semibold text-[var(--text-primary)]">{title}</h3>
          </div>

          <div className="mt-3 text-sm text-[var(--text-secondary)]">{message}</div>

          {requirePassword && (
            <div className="mt-4">
              <Input
                type="password"
                label={passwordLabel}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !isSubmitting) {
                    e.preventDefault()
                    void handleConfirm()
                  }
                }}
                autoFocus
                placeholder="••••••••"
              />
            </div>
          )}

          {error && (
            <div className="mt-4 p-3 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>
          )}

          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>
              {cancelLabel}
            </Button>
            <Button
              onClick={handleConfirm}
              isLoading={isSubmitting}
              className={toneStyles.btn || undefined}
            >
              {confirmLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
