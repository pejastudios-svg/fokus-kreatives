'use client'

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
  if (!d) return '—'
  return new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

const LOGO = 'https://silly-blue-r3z2xucguf.edgeone.app/FOKUS%20CREATIVES%20logo.png'

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
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    )
  }

  if (error || !inv) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100 p-6">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 px-8 py-10 text-center max-w-sm">
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
    <div className="min-h-screen bg-slate-100 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          {/* Header */}
          <div
            className="px-6 sm:px-10 py-7 flex items-center justify-between"
            style={{ background: 'linear-gradient(135deg,#2B79F7 0%,#1E54B7 55%,#143A80 100%)' }}
          >
            <div>
              <p className="text-white text-2xl font-extrabold tracking-tight">INVOICE</p>
              {inv.invoiceNumber && (
                <p className="text-white/80 text-sm mt-0.5">#{inv.invoiceNumber}</p>
              )}
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={inv.logo || LOGO}
              alt={inv.from}
              className="h-14 w-14 rounded-full object-cover bg-white ring-2 ring-white/40"
            />
          </div>

          <div className="px-6 sm:px-10 py-7">
            {/* Status banner */}
            {isPaid ? (
              <div className="mb-6 flex items-center gap-2 rounded-xl bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
                <Check className="h-4 w-4" /> This invoice has been paid. Thank you.
              </div>
            ) : marked ? (
              <div className="mb-6 flex items-center gap-2 rounded-xl bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-700">
                <Check className="h-4 w-4" /> Thanks - we&apos;ve let the team know. They&apos;ll confirm your payment shortly.
              </div>
            ) : null}

            {/* From / Bill to */}
            <div className="grid grid-cols-2 gap-6 mb-7">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">From</p>
                <p className="text-slate-900 font-semibold mt-1">{inv.from}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Bill to</p>
                <p className="text-slate-900 font-semibold mt-1">{inv.billToName || '—'}</p>
                {inv.billToEmail && <p className="text-slate-500 text-sm">{inv.billToEmail}</p>}
              </div>
            </div>

            {/* Dates */}
            <div className="flex gap-8 mb-7 text-sm">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Issued</p>
                <p className="text-slate-800 mt-0.5">{fmtDate(inv.issueDate)}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Due</p>
                <p className="text-slate-800 mt-0.5">{fmtDate(inv.dueDate)}</p>
              </div>
            </div>

            {/* Line items */}
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-slate-500">
                    <th className="text-left font-semibold px-4 py-2.5">Description</th>
                    <th className="text-center font-semibold px-3 py-2.5 w-14">Qty</th>
                    <th className="text-right font-semibold px-3 py-2.5 w-28">Unit</th>
                    <th className="text-right font-semibold px-4 py-2.5 w-32">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-4 text-slate-400 text-center">
                        No line items
                      </td>
                    </tr>
                  ) : (
                    items.map((it, i) => (
                      <tr key={i} className="border-t border-slate-100">
                        <td className="px-4 py-2.5 text-slate-800">{it.description || '—'}</td>
                        <td className="px-3 py-2.5 text-center text-slate-600">
                          {Number(it.quantity) || 0}
                        </td>
                        <td className="px-3 py-2.5 text-right text-slate-600">
                          {money(Number(it.unit_price) || 0, inv.currency)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-slate-800">
                          {money((Number(it.quantity) || 0) * (Number(it.unit_price) || 0), inv.currency)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

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
              <div className="flex justify-between pt-2 mt-1 border-t border-slate-200 text-slate-900 font-bold text-base">
                <span>Total</span>
                <span>{money(t.total, inv.currency)}</span>
              </div>
            </div>

            {inv.notes && (
              <div className="mt-7">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Notes</p>
                <p className="text-slate-600 text-sm mt-1 whitespace-pre-line">{inv.notes}</p>
              </div>
            )}

            {/* Actions */}
            {!isPaid && (
              <div className="mt-8 flex flex-col sm:flex-row gap-3">
                {inv.paymentLink && (
                  <a
                    href={inv.paymentLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-white font-semibold hover:opacity-90 transition-opacity"
                    style={{ backgroundColor: '#2B79F7' }}
                  >
                    Pay now <ExternalLink className="h-4 w-4" />
                  </a>
                )}
                <button
                  type="button"
                  onClick={handlePaid}
                  disabled={marking || marked}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 font-semibold border-2 transition-colors disabled:opacity-60"
                  style={{ borderColor: '#2B79F7', color: '#2B79F7' }}
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
              </div>
            )}
          </div>
        </div>

        <p className="text-center text-slate-400 text-xs mt-4">Powered by Fokus Kreativez</p>
      </div>
    </div>
  )
}
