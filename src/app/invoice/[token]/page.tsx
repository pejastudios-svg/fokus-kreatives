'use client'

// Public invoice page (/invoice/<token>). Same design language as the
// agreement signing page: a slim header bar with the sender and status,
// then the invoice as a clean paper on a neutral canvas. No color bands,
// no oversized buttons - it should read like a professional document.

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { Check, ExternalLink, Loader2 } from 'lucide-react'

interface LineItem {
  description?: string
  quantity?: number
  unit_price?: number
}

interface Invoice {
  invoiceNumber: string | null
  currency: string
  lineItems: LineItem[]
  taxRate: number
  discount: number
  issueDate: string | null
  dueDate: string | null
  notes: string | null
  billToName: string | null
  billToEmail: string | null
  paymentLink: string | null
  status: string
  sendStatus: string | null
  clientMarkedPaidAt: string | null
  from: string
  logo: string | null
}

function computeTotals(items: LineItem[], taxRate: number, discount: number) {
  const subtotal = items.reduce(
    (s, it) => s + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0),
    0,
  )
  const discountAmt = Math.min(Number(discount) || 0, subtotal)
  const taxable = subtotal - discountAmt
  const taxAmt = taxable * ((Number(taxRate) || 0) / 100)
  return { subtotal, discountAmt, taxAmt, total: taxable + taxAmt }
}

function money(n: number, currency: string) {
  return `${currency} ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtDate(d: string | null) {
  if (!d) return '-'
  return new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export default function InvoicePage() {
  const params = useParams()
  const token = (params?.token as string) || ''

  const [inv, setInv] = useState<Invoice | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [marking, setMarking] = useState(false)
  const [marked, setMarked] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/invoices/info?token=${encodeURIComponent(token)}`)
        const json = await res.json()
        if (cancelled) return
        if (!json.success) {
          setError(json.error || 'Invoice not found')
        } else {
          setInv(json.invoice as Invoice)
          if (json.invoice.clientMarkedPaidAt) setMarked(true)
        }
      } catch {
        if (!cancelled) setError('Could not load this invoice.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token])

  const handlePaid = useCallback(async () => {
    setMarking(true)
    try {
      const res = await fetch('/api/invoices/mark-paid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const json = await res.json()
      if (json.success) setMarked(true)
    } finally {
      setMarking(false)
    }
  }, [token])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f6f5f4]">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    )
  }

  if (error || !inv) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f6f5f4] p-6">
        <div className="bg-white rounded-2xl shadow-sm border border-[#e5e3df] px-8 py-10 text-center max-w-sm">
          <p className="text-slate-800 font-semibold">Invoice unavailable</p>
          <p className="text-slate-500 text-sm mt-1">{error || 'This invoice could not be found.'}</p>
        </div>
      </div>
    )
  }

  const t = computeTotals(inv.lineItems, inv.taxRate, inv.discount)
  const isPaid = inv.status === 'paid'
  const items = inv.lineItems.filter(
    (it) => (it.description || '').trim() || Number(it.quantity) || Number(it.unit_price),
  )

  return (
    <div className="min-h-screen bg-[#f6f5f4]">
      {/* Slim document header bar */}
      <div className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-[#e5e3df]">
        <div className="max-w-[880px] mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {inv.logo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={inv.logo}
                alt=""
                className="h-8 w-8 rounded-full object-cover shrink-0"
              />
            )}
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 truncate">
                {inv.from}
              </p>
              <p className="text-sm font-semibold text-slate-900 truncate">
                Invoice{inv.invoiceNumber ? ` #${inv.invoiceNumber}` : ''}
              </p>
            </div>
          </div>
          <span
            className={`shrink-0 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold ${
              isPaid
                ? 'bg-green-100 text-green-700'
                : marked
                  ? 'bg-blue-100 text-blue-700'
                  : 'bg-slate-100 text-slate-600'
            }`}
          >
            {isPaid ? (
              <>
                <Check className="h-3 w-3" /> Paid
              </>
            ) : marked ? (
              'Payment reported'
            ) : inv.dueDate ? (
              `Due ${fmtDate(inv.dueDate)}`
            ) : (
              'Awaiting payment'
            )}
          </span>
        </div>
      </div>

      <div className="max-w-[880px] mx-auto px-3 sm:px-6 pt-8 pb-4">
        {(isPaid || marked) && (
          <div
            className={`mx-auto max-w-[720px] mb-4 flex items-center gap-2 rounded-xl px-4 py-3 text-sm border ${
              isPaid
                ? 'bg-green-50 border-green-200 text-green-700'
                : 'bg-blue-50 border-blue-200 text-blue-700'
            }`}
          >
            <Check className="h-4 w-4 shrink-0" />
            {isPaid
              ? 'This invoice has been paid. Thank you.'
              : 'Thanks for letting us know. Your payment will be confirmed shortly.'}
          </div>
        )}

        {/* The paper */}
        <div className="mx-auto max-w-[720px] bg-white rounded-lg border border-[#e5e3df] shadow-[0_1px_3px_rgba(0,0,0,0.06)] px-6 sm:px-12 py-10">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Invoice
              </p>
              {inv.invoiceNumber && (
                <p className="text-xl font-semibold text-slate-900 mt-0.5">
                  #{inv.invoiceNumber}
                </p>
              )}
            </div>
            <div className="text-right text-sm">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Issued
              </p>
              <p className="text-slate-800 mt-0.5">{fmtDate(inv.issueDate)}</p>
              {inv.dueDate && (
                <>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mt-3">
                    Due
                  </p>
                  <p className="text-slate-800 mt-0.5">{fmtDate(inv.dueDate)}</p>
                </>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6 mt-8">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                From
              </p>
              <p className="text-slate-900 font-medium text-sm mt-1">{inv.from}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Bill to
              </p>
              <p className="text-slate-900 font-medium text-sm mt-1">{inv.billToName || '-'}</p>
              {inv.billToEmail && <p className="text-slate-500 text-sm">{inv.billToEmail}</p>}
            </div>
          </div>

          {/* Line items: hairlines only, no fills */}
          <table className="w-full text-sm mt-9">
            <thead>
              <tr className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                <th className="text-left font-semibold pb-2.5 border-b border-slate-200">
                  Description
                </th>
                <th className="text-center font-semibold pb-2.5 border-b border-slate-200 w-14">
                  Qty
                </th>
                <th className="text-right font-semibold pb-2.5 border-b border-slate-200 w-28">
                  Unit
                </th>
                <th className="text-right font-semibold pb-2.5 border-b border-slate-200 w-32">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-4 text-slate-400 text-center">
                    No line items
                  </td>
                </tr>
              ) : (
                items.map((it, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="py-3 pr-3 text-slate-800">{it.description || '-'}</td>
                    <td className="py-3 px-3 text-center text-slate-600">
                      {Number(it.quantity) || 0}
                    </td>
                    <td className="py-3 px-3 text-right text-slate-600">
                      {money(Number(it.unit_price) || 0, inv.currency)}
                    </td>
                    <td className="py-3 pl-3 text-right text-slate-800">
                      {money((Number(it.quantity) || 0) * (Number(it.unit_price) || 0), inv.currency)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          {/* Totals */}
          <div className="mt-5 ml-auto max-w-xs space-y-1.5 text-sm">
            <div className="flex justify-between text-slate-500">
              <span>Subtotal</span>
              <span>{money(t.subtotal, inv.currency)}</span>
            </div>
            {t.discountAmt > 0 && (
              <div className="flex justify-between text-slate-500">
                <span>Discount</span>
                <span>- {money(t.discountAmt, inv.currency)}</span>
              </div>
            )}
            {t.taxAmt > 0 && (
              <div className="flex justify-between text-slate-500">
                <span>Tax ({inv.taxRate}%)</span>
                <span>{money(t.taxAmt, inv.currency)}</span>
              </div>
            )}
            <div className="flex justify-between pt-2.5 mt-1 border-t border-slate-200 text-slate-900 font-semibold text-base">
              <span>Total</span>
              <span>{money(t.total, inv.currency)}</span>
            </div>
          </div>

          {inv.notes && (
            <div className="mt-9">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Notes
              </p>
              <p className="text-slate-600 text-sm mt-1.5 whitespace-pre-line break-words">
                {inv.notes}
              </p>
            </div>
          )}

          {/* Actions, part of the document */}
          {!isPaid && (
            <div className="mt-10 pt-7 border-t border-slate-200 flex flex-wrap items-center gap-3">
              {inv.paymentLink && (
                <a
                  href={inv.paymentLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 rounded-full px-6 py-2.5 text-sm text-white font-semibold transition-opacity hover:opacity-90"
                  style={{ backgroundColor: '#2B79F7' }}
                >
                  Pay now <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
              <button
                type="button"
                onClick={handlePaid}
                disabled={marking || marked}
                className="inline-flex items-center justify-center gap-2 rounded-full px-6 py-2.5 text-sm font-semibold border border-slate-300 text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60"
              >
                {marking ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : marked ? (
                  <>
                    <Check className="h-4 w-4" /> Marked as paid
                  </>
                ) : (
                  "I've paid"
                )}
              </button>
              {inv.paymentLink && (
                <p className="w-full text-xs text-slate-400 mt-1">
                  Already paid another way? Use &quot;I&apos;ve paid&quot; and the team will
                  confirm it.
                </p>
              )}
            </div>
          )}
        </div>

        <p className="text-center text-slate-400 text-xs mt-6 pb-6">
          Powered by Fokus Kreativez
        </p>
      </div>
    </div>
  )
}
