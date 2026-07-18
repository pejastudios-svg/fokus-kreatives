'use client'

// Public signing page (/agreement/<token>). Styled like a real document
// service: a slim header bar with the sender and status, then the paper
// itself on a neutral canvas. Signature blocks for every signer live at
// the bottom of the paper; the visitor's own block (matched by their
// personal token) is the interactive one.

import { useCallback, useEffect, useState } from 'react'
import { readJsonSafe } from '@/lib/http/readJsonSafe'
import { useParams } from 'next/navigation'
import { Check, Loader2, Clock, Lock } from 'lucide-react'
import { AGREEMENT_DOC_CSS, DOC_FONTS_URL } from '@/components/agreements/docStyles'

interface SignerInfo {
  id: string
  name: string | null
  email: string
  signedAt: string | null
  signerName: string | null
}

interface AgreementInfo {
  title: string
  bodyHtml: string
  status: 'sent' | 'signed'
  signedAt: string | null
  from: string
  signers: SignerInfo[]
  currentSignerId: string | null
  invoiceUrl: string | null
  invoicePaid: boolean
}

const SIGNATURE_FONT =
  '"Snell Roundhand", "Savoye LET", "Brush Script MT", "Segoe Script", cursive'

/**
 * Rasterize the typed name in the signature font to a PNG data URL, so the
 * signed-copy PDF can embed the exact handwriting-style mark the signer saw
 * (the server-side PDF renderer lacks these fonts). Returns null if canvas
 * is unavailable.
 */
function renderSignaturePng(name: string): string | null {
  try {
    const fontPx = 44
    const pad = 10
    const font = `italic ${fontPx}px ${SIGNATURE_FONT}`
    const measure = document.createElement('canvas').getContext('2d')
    if (!measure) return null
    measure.font = font
    const textW = Math.min(560, Math.ceil(measure.measureText(name).width))
    const w = textW + pad * 2
    const h = fontPx + pad * 2
    const scale = 2
    const canvas = document.createElement('canvas')
    canvas.width = w * scale
    canvas.height = h * scale
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.scale(scale, scale)
    ctx.fillStyle = '#111827'
    ctx.font = font
    ctx.textBaseline = 'middle'
    ctx.fillText(name, pad, h / 2)
    return canvas.toDataURL('image/png')
  } catch {
    return null
  }
}

function fmtSigned(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function AgreementSignPage() {
  const params = useParams()
  const token = (params?.token as string) || ''

  const [info, setInfo] = useState<AgreementInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [consent, setConsent] = useState(false)
  const [signing, setSigning] = useState(false)
  const [justSigned, setJustSigned] = useState(false)
  // Soft-deleted ("no longer available") + password-lock states.
  const [gone, setGone] = useState(false)
  const [locked, setLocked] = useState<{ title: string; from: string } | null>(null)
  const [password, setPassword] = useState('')
  const [pwError, setPwError] = useState('')
  const [unlocking, setUnlocking] = useState(false)

  // Load the agreement, optionally with a password. Locked agreements come
  // back with only title + from until the correct password is supplied; the
  // working password is kept in state so signing can re-send it.
  const load = useCallback(
    async (pw?: string) => {
      const url =
        `/api/agreements/info?token=${encodeURIComponent(token)}` +
        (pw ? `&password=${encodeURIComponent(pw)}` : '')
      const res = await fetch(url)
      if (res.status === 410) {
        setGone(true)
        return
      }
      const json = await readJsonSafe(res)
      if (!json.success) {
        setError(json.error || 'Agreement not found')
        return
      }
      const ag = json.agreement as AgreementInfo & {
        locked?: boolean
        passwordError?: boolean
      }
      if (ag.locked) {
        setLocked({ title: ag.title, from: ag.from })
        if (ag.passwordError) setPwError('Incorrect password. Try again.')
        return
      }
      setLocked(null)
      setInfo(ag as AgreementInfo)
    },
    [token],
  )

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        if (!cancelled) await load()
      } catch {
        if (!cancelled) setError('Could not load this agreement.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token, load])

  const submitPassword = useCallback(async () => {
    if (!password.trim()) return
    setUnlocking(true)
    setPwError('')
    try {
      await load(password)
    } finally {
      setUnlocking(false)
    }
  }, [password, load])

  const handleSign = useCallback(async () => {
    if (name.trim().length < 2 || !consent) return
    setSigning(true)
    try {
      const res = await fetch('/api/agreements/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          name: name.trim(),
          password: password || undefined,
          signatureImage: renderSignaturePng(name.trim()) || undefined,
        }),
      })
      const json = await readJsonSafe(res)
      if (!json.success) {
        setError(json.error || 'Could not sign the agreement.')
        return
      }
      setJustSigned(true)
      const signedAt = (json.signedAt as string) || new Date().toISOString()
      setInfo((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          status: json.allSigned ? 'signed' : prev.status,
          invoiceUrl: (json.invoiceUrl as string | null) || prev.invoiceUrl,
          signers: prev.signers.map((s) =>
            s.id === prev.currentSignerId
              ? { ...s, signedAt, signerName: name.trim() }
              : s,
          ),
        }
      })
    } finally {
      setSigning(false)
    }
  }, [token, name, consent, password])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center form-canvas">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    )
  }

  // Soft-deleted: link is dead (the signature, if any, still legally stands).
  if (gone) {
    return (
      <div className="min-h-screen flex items-center justify-center form-canvas p-6">
        <div className="bg-white rounded-xl border border-[#e5e3df] px-8 py-10 text-center max-w-sm shadow-sm">
          <p className="text-slate-800 font-semibold">No longer available</p>
          <p className="text-slate-500 text-sm mt-1">
            This agreement is no longer available. If you signed it, your copy was emailed to you.
          </p>
        </div>
      </div>
    )
  }

  // Password-locked: prompt before showing anything.
  if (locked && !info) {
    return (
      <div className="min-h-screen flex items-center justify-center form-canvas p-6">
        <div className="bg-white rounded-xl border border-[#e5e3df] px-8 py-9 max-w-sm w-full shadow-sm">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#2B79F7]/10 mx-auto">
            <Lock className="h-5 w-5 text-[#2B79F7]" />
          </div>
          <p className="mt-4 text-center text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            {locked.from}
          </p>
          <p className="mt-1 text-center text-base font-semibold text-slate-900">{locked.title}</p>
          <p className="mt-2 text-center text-sm text-slate-500">
            This agreement is password protected. Enter the password you were given to open it.
          </p>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !unlocking) void submitPassword()
            }}
            placeholder="Password"
            autoFocus
            className="mt-4 w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm outline-none focus:border-[#2B79F7] bg-white"
          />
          {pwError && <p className="mt-2 text-xs text-red-600">{pwError}</p>}
          <button
            type="button"
            onClick={() => void submitPassword()}
            disabled={unlocking || !password.trim()}
            className="mt-4 w-full inline-flex items-center justify-center gap-2 rounded-full px-6 py-2.5 text-sm text-white font-semibold transition-opacity disabled:opacity-50"
            style={{ backgroundColor: '#2B79F7' }}
          >
            {unlocking ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Unlock'}
          </button>
        </div>
      </div>
    )
  }

  if (error && !info) {
    return (
      <div className="min-h-screen flex items-center justify-center form-canvas p-6">
        <div className="bg-white rounded-xl border border-[#e5e3df] px-8 py-10 text-center max-w-sm shadow-sm">
          <p className="text-slate-800 font-semibold">Agreement unavailable</p>
          <p className="text-slate-500 text-sm mt-1">
            {error || 'This agreement could not be found.'}
          </p>
        </div>
      </div>
    )
  }
  if (!info) return null

  const me = info.signers.find((s) => s.id === info.currentSignerId) || null
  const canSign = !!me && !me.signedAt
  const fullySigned = info.status === 'signed'
  const signedCount = info.signers.filter((s) => s.signedAt).length

  return (
    <div className="min-h-screen form-canvas">
      { }
      <link rel="stylesheet" href={DOC_FONTS_URL} />
      <style dangerouslySetInnerHTML={{ __html: AGREEMENT_DOC_CSS }} />

      {/* Slim document header bar */}
      <div className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-[#e5e3df]">
        <div className="max-w-[880px] mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 truncate">
              {info.from}
            </p>
            <p className="text-sm font-semibold text-slate-900 truncate">{info.title}</p>
          </div>
          <span
            className={`shrink-0 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold ${
              fullySigned
                ? 'bg-green-100 text-green-700'
                : 'bg-slate-100 text-slate-600'
            }`}
          >
            {fullySigned ? (
              <>
                <Check className="h-3 w-3" /> Signed
              </>
            ) : info.signers.length > 1 ? (
              `${signedCount} of ${info.signers.length} signed`
            ) : (
              'Awaiting signature'
            )}
          </span>
        </div>
      </div>

      <div className="max-w-[880px] mx-auto px-3 sm:px-6 pt-8 pb-4">
        {justSigned && (
          <div className="agreement-page-width mx-auto max-w-[816px] mb-4 flex items-center gap-2 rounded-xl bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
            <Check className="h-4 w-4 shrink-0" />
            {fullySigned
              ? 'Signed. A copy has been emailed to everyone for their records.'
              : 'Signed. You will get the final copy by email once everyone has signed.'}
          </div>
        )}



        {/* The paper */}
        <div className="agreement-page agreement-doc mx-auto">
          <div dangerouslySetInnerHTML={{ __html: info.bodyHtml }} />

          {/* Signatures, part of the document */}
          <div className="mt-14 pt-7 border-t border-slate-200">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-5">
              {info.signers.length > 1 ? 'Signatures' : 'Signature'}
            </p>

            <div className="space-y-8">
              {info.signers.map((s) => {
                const isMe = s.id === info.currentSignerId
                if (s.signedAt) {
                  return (
                    <div key={s.id}>
                      <p className="text-3xl text-slate-900" style={{ fontFamily: SIGNATURE_FONT }}>
                        {s.signerName}
                      </p>
                      <div className="mt-1 pt-1 border-t border-slate-300 max-w-sm">
                        <p className="text-xs text-slate-500">
                          {s.signerName} · {s.email}
                        </p>
                        <p className="text-[11px] text-slate-400">Signed {fmtSigned(s.signedAt)}</p>
                      </div>
                    </div>
                  )
                }
                if (isMe && canSign) {
                  return (
                    <div key={s.id}>
                      <p className="text-sm font-semibold text-slate-800">
                        Sign as {s.name || s.email}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Type your full legal name. It becomes your electronic signature.
                      </p>
                      <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Your full name"
                        className="mt-3 w-full max-w-sm rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm outline-none focus:border-[#2B79F7] bg-white"
                      />
                      <div className="mt-4 h-16 max-w-sm flex items-end border-b border-slate-400 pb-1">
                        {name.trim() ? (
                          <span className="text-3xl text-slate-900" style={{ fontFamily: SIGNATURE_FONT }}>
                            {name.trim()}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-300">
                            Your signature will appear here
                          </span>
                        )}
                      </div>
                      <label className="mt-4 flex items-start gap-2 text-xs text-slate-600 max-w-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={consent}
                          onChange={(e) => setConsent(e.target.checked)}
                          className="mt-0.5"
                        />
                        I agree that typing my name and clicking Sign is my electronic
                        signature, with the same effect as a handwritten one.
                      </label>
                      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
                      <button
                        type="button"
                        onClick={handleSign}
                        disabled={signing || name.trim().length < 2 || !consent}
                        className="mt-4 inline-flex items-center justify-center gap-2 rounded-full px-6 py-2.5 text-sm text-white font-semibold transition-opacity disabled:opacity-50"
                        style={{ backgroundColor: '#2B79F7' }}
                      >
                        {signing ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Sign'}
                      </button>
                    </div>
                  )
                }
                return (
                  <div key={s.id}>
                    <div className="h-10 max-w-sm border-b border-dashed border-slate-300" />
                    <p className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-400">
                      <Clock className="h-3 w-3" /> Awaiting signature · {s.name || s.email}
                    </p>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <p
          className={`text-center text-slate-400 text-xs mt-6 ${
            fullySigned && info.invoiceUrl ? 'pb-24' : 'pb-6'
          }`}
        >
          Powered by Fokus Kreativez
        </p>
      </div>

      {/* Sign and continue to invoice - pinned to the bottom of the screen
          so it can't be missed after scrolling through a long document. */}
      {fullySigned && info.invoiceUrl && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[#2B79F7]/25 bg-white/95 backdrop-blur px-4 py-3">
          <div className="mx-auto flex max-w-[880px] items-center justify-between gap-3">
            {info.invoicePaid ? (
              <span className="flex items-center gap-2 text-sm font-medium text-green-700">
                <Check className="h-4 w-4 shrink-0" /> The invoice for this agreement has been
                paid. Thank you.
              </span>
            ) : (
              <>
                <span className="min-w-0 text-sm text-slate-700">
                  An invoice for this agreement is ready.
                </span>
                <a
                  href={info.invoiceUrl}
                  className="shrink-0 rounded-full px-5 py-2.5 text-sm font-bold text-white hover:opacity-90"
                  style={{ backgroundColor: '#2B79F7' }}
                >
                  Continue to invoice
                </a>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
