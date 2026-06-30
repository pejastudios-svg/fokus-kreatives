'use client'

// Public unsubscribe landing page (linked from every campaign email footer).
// Same design language as the public agreement/invoice pages: neutral
// canvas, one white card, no login required. One click, instant effect,
// with a resubscribe-friendly success message.

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

type Stage = 'loading' | 'confirm' | 'done' | 'already' | 'error'

export default function UnsubscribePage() {
  const params = useParams()
  const token = (params?.token as string) || ''
  const [stage, setStage] = useState<Stage>('loading')
  const [email, setEmail] = useState('')
  const [senderName, setSenderName] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!token) {
      setStage('error')
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/e/u/${token}`)
        const json = await res.json()
        if (cancelled) return
        if (!json.success) {
          setStage('error')
          return
        }
        setEmail(json.email || '')
        setSenderName(json.senderName || 'this sender')
        setStage(json.alreadyUnsubscribed ? 'already' : 'confirm')
      } catch {
        if (!cancelled) setStage('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token])

  const unsubscribe = async () => {
    setBusy(true)
    try {
      const res = await fetch(`/api/e/u/${token}`, { method: 'POST' })
      const json = await res.json()
      setStage(json.success ? 'done' : 'error')
    } catch {
      setStage('error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen form-canvas flex items-start justify-center px-4 py-16">
      <div className="w-full max-w-md bg-white border border-[#E7E5E0] rounded-xl p-8">
        <div className="text-[11px] font-semibold tracking-[0.08em] uppercase text-gray-400">
          {senderName || 'Email preferences'}
        </div>

        {stage === 'loading' && (
          <p className="mt-4 text-sm text-gray-500">Loading...</p>
        )}

        {stage === 'error' && (
          <>
            <div className="mt-4 text-lg font-semibold text-gray-900">
              This link is not valid
            </div>
            <p className="mt-2 text-sm text-gray-500 leading-relaxed">
              The unsubscribe link may have expired. You can reply to the
              email you received and ask to be removed instead.
            </p>
          </>
        )}

        {stage === 'confirm' && (
          <>
            <div className="mt-4 text-lg font-semibold text-gray-900">
              Unsubscribe from these emails?
            </div>
            <p className="mt-2 text-sm text-gray-500 leading-relaxed">
              {email ? (
                <>
                  <span className="font-medium text-gray-700">{email}</span> will no
                  longer receive emails from {senderName}.
                </>
              ) : (
                <>You will no longer receive emails from {senderName}.</>
              )}
            </p>
            <button
              onClick={unsubscribe}
              disabled={busy}
              className="mt-6 inline-block rounded-full bg-[#2B79F7] px-6 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy ? 'One moment...' : 'Unsubscribe'}
            </button>
          </>
        )}

        {(stage === 'done' || stage === 'already') && (
          <>
            <div className="mt-4 text-lg font-semibold text-gray-900">
              {stage === 'done' ? 'You are unsubscribed' : 'Already unsubscribed'}
            </div>
            <p className="mt-2 text-sm text-gray-500 leading-relaxed">
              {email ? (
                <span className="font-medium text-gray-700">{email}</span>
              ) : (
                'This address'
              )}{' '}
              will not receive any more emails from {senderName}. Unsubscribed by
              mistake? Reply to any earlier email and ask to be added back.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
