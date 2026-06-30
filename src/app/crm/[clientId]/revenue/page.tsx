'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Loading'
import {
  Plus,
  DollarSign,
  AlertCircle,
  CheckCircle,
  Clock,
  X,
  Trash2,
  Bell,
  BellOff,
  Search,
  FileDown,
  FileText,
  Send,
  Loader2,
  ExternalLink,
  Copy,
  Check,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Toggle } from '@/components/ui/Toggle'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { KebabMenu } from '@/components/ui/KebabMenu'
import { DatePicker } from '@/components/ui/DatePicker'
import { DonutChart, ChartLegend } from '@/components/charts/MiniCharts'
import {
  StatusStackedBar,
  type SeriesDef,
} from '@/components/charts/StatusCharts'
import { BucketToggle } from '@/components/charts/BucketToggle'
import {
  LeadFilter,
  type LeadOption as LeadFilterOption,
} from '@/components/crm/LeadFilter'
import { useCrmRole } from '@/components/crm/CrmRoleContext'
import {
  bucketize,
  type BucketMode,
  type ChartEvent,
} from '@/lib/charts/bucketize'
import { CurrencyControl } from '@/components/crm/CurrencyControl'
import { CurrencyPicker } from '@/components/crm/CurrencyPicker'
import {
  useExchangeRates,
  convertAmount,
  convertAmountValue,
  getCurrencySymbol,
} from '@/hooks/useExchangeRates'
import { useDefaultCurrency } from '@/hooks/useDefaultCurrency'

interface Payment {
  id: string
  client_id: string
  amount: number
  currency: string
  status: 'pending' | 'paid' | 'overdue' | 'cancelled'
  due_date: string | null
  paid_date: string | null
  notes: string | null
  invoice_number: string | null
  reminder_enabled: boolean
  lead_id: string | null
  created_at: string
  lead?: {
    data: Record<string, unknown>
  }
  // Provenance: set when this invoice was created by a signed agreement.
  agreement_id?: string | null
  agreement?: { id: string; title: string } | null
  is_recurring?: boolean
  recurrence_type?: 'days' | 'weeks' | 'months' | null
  recurrence_interval?: number | null
  recurring_count?: number
  // --- Invoice fields (only when is_invoice) ---
  is_invoice?: boolean
  line_items?: InvoiceLineItem[]
  send_status?: 'draft' | 'scheduled' | 'sent' | null
  send_on?: string | null
  sent_at?: string | null
  bill_to_name?: string | null
  bill_to_email?: string | null
  issue_date?: string | null
  tax_rate?: number | null
  discount?: number | null
  doc_url?: string | null
  payment_link?: string | null
  public_token?: string | null
  client_marked_paid_at?: string | null
}

interface InvoiceLineItem {
  description: string
  quantity: number
  unit_price: number
}

// Next invoice number for a lead: find their highest existing numeric
// invoice number and increment it, keeping the prefix + zero-padding
// (INV-002 -> INV-003). First invoice for a lead starts at INV-001.
function nextInvoiceNumberForLead(payments: Payment[], leadId: string): string {
  let bestNum = 0
  let bestPrefix = 'INV-'
  let bestWidth = 3
  for (const p of payments) {
    if (p.lead_id !== leadId || !p.invoice_number) continue
    const m = p.invoice_number.trim().match(/^(.*?)(\d+)$/)
    if (!m) continue
    const num = parseInt(m[2], 10)
    if (num > bestNum) {
      bestNum = num
      bestPrefix = m[1] || 'INV-'
      bestWidth = m[2].length
    }
  }
  return bestPrefix + String(bestNum + 1).padStart(bestWidth, '0')
}

// Mirror of the server-side invoiceTotals so the modal can preview totals
// without a round-trip.
function computeTotals(items: InvoiceLineItem[], taxRate: number, discount: number) {
  const subtotal = items.reduce(
    (s, it) => s + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0),
    0,
  )
  const discountAmt = Math.min(Number(discount) || 0, subtotal)
  const taxable = subtotal - discountAmt
  const taxAmt = taxable * ((Number(taxRate) || 0) / 100)
  return { subtotal, discountAmt, taxAmt, total: taxable + taxAmt }
}

type SortKey =
  | 'newest'
  | 'oldest'
  | 'amount-desc'
  | 'amount-asc'
  | 'due-soon'
  | 'due-late'

interface LeadOption {
  id: string
  data: Record<string, unknown>
}

const statusConfig = {
  pending: { label: 'Pending', color: '#F59E0B', bg: 'bg-yellow-500/20', icon: Clock },
  paid: { label: 'Paid', color: '#10B981', bg: 'bg-green-500/20', icon: CheckCircle },
  overdue: { label: 'Overdue', color: '#EF4444', bg: 'bg-red-500/20', icon: AlertCircle },
  cancelled: { label: 'Cancelled', color: '#64748B', bg: 'bg-gray-500/20', icon: X },
}


export default function CRMRevenue() {
  const params = useParams()
  const clientId = ((params as Record<string, string>).clientid || (params as Record<string, string>).clientId) as string
  const supabase = createClient()

  const [isLoading, setIsLoading] = useState(true)
  const [payments, setPayments] = useState<Payment[]>([])
  const [showAddModal, setShowAddModal] = useState(false)
  const [isSavingPayment, setIsSavingPayment] = useState(false)
  const [filter, setFilter] = useState<'all' | 'pending' | 'paid' | 'overdue'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState<SortKey>('newest')
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  const [leads, setLeads] = useState<LeadOption[]>([])
  const [leadSearch, setLeadSearch] = useState('')
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null)

  // Logged-in user email (for notifications)
  const [userEmail, setUserEmail] = useState<string | null>(null)

  useEffect(() => {
    const loadUser = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (user?.email) {
        setUserEmail(user.email)
      }
    }
    loadUser()
  }, [supabase])

  type LineItemDraft = { description: string; quantity: string; unit_price: string }
  const emptyForm = {
    amount: '',
    currency: 'USD',
    status: 'pending' as Payment['status'],
    due_date: '',
    notes: '',
    invoice_number: '',
    reminder_enabled: true,
    is_recurring: false,
    recurrence_type: 'months' as 'days' | 'weeks' | 'months',
    recurrence_interval: 1,
    // Invoice mode (the toggle) + its fields.
    is_invoice: false,
    bill_to_name: '',
    bill_to_email: '',
    issue_date: '',
    tax_rate: '',
    discount: '',
    payment_link: '',
    line_items: [{ description: '', quantity: '1', unit_price: '' }] as LineItemDraft[],
    schedule_send: true,
  }
  const [newPayment, setNewPayment] = useState({ ...emptyForm })
  // When set, the modal is editing an existing invoice rather than creating.
  const [editId, setEditId] = useState<string | null>(null)
  const [sendingId, setSendingId] = useState<string | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // Deep-link from the CRM inbox: `?focus=<paymentId>` scrolls to + briefly
  // highlights that invoice so a "payment marked paid" notification lands
  // right on the row with the Confirm button.
  const searchParams = useSearchParams()
  const focusParam = searchParams?.get('focus') || null
  const [highlightId, setHighlightId] = useState<string | null>(null)
  useEffect(() => {
    if (!focusParam || isLoading) return
    const el = document.getElementById(`pay-${focusParam}`)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setHighlightId(focusParam)
    const t = setTimeout(() => setHighlightId(null), 2800)
    return () => clearTimeout(t)
  }, [focusParam, isLoading, payments.length])

  // When invoice mode is on and a lead is linked, prefill the bill-to from the
  // lead - but only into empty fields, so a manual edit is never clobbered.
  useEffect(() => {
    if (!newPayment.is_invoice || !selectedLeadId) return
    const lead = leads.find((l) => l.id === selectedLeadId)
    if (!lead) return
    const d = (lead.data || {}) as Record<string, string>
    setNewPayment((p) => ({
      ...p,
      bill_to_name: p.bill_to_name || d.name || '',
      bill_to_email: p.bill_to_email || d.email || '',
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLeadId, newPayment.is_invoice])

  // Define loaders using useCallback to fix dependency warnings
  const loadPayments = useCallback(async () => {
    setIsLoading(true)
    const { data } = await supabase
      .from('payments')
      .select(`*, lead:leads(data), agreement:agreements!payments_agreement_id_fkey(id, title)`)
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })

    const now = new Date()
    // Explicit cast to Payment[] to handle the unknown lead data
    const processed: Payment[] = (data || []).map((p) => {
      const payment = p as Payment
      if (payment.status === 'pending' && payment.due_date && new Date(payment.due_date) < now) {
        return { ...payment, status: 'overdue' as const }
      }
      return payment
    })

    setPayments(processed)
    setIsLoading(false)
  }, [clientId, supabase])

  const loadLeads = useCallback(async () => {
    const { data } = await supabase
      .from('leads')
      .select('id, data')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })

    setLeads((data || []) as LeadOption[])
  }, [clientId, supabase])

  useEffect(() => {
    if (clientId) {
      loadPayments()
      loadLeads()
    }
  }, [clientId, loadPayments, loadLeads])

  // Fix: Safe casting of unknown lead data
  const filteredLeadOptions = useMemo(() => {
    const q = leadSearch.toLowerCase()
    return leads.filter((lead) => {
      const data = (lead.data || {}) as Record<string, string>
      const name = (data.name || '').toLowerCase()
      const email = (data.email || '').toLowerCase()
      const platform = (data.platform || '').toLowerCase()
      return (
        !q ||
        name.includes(q) ||
        email.includes(q) ||
        platform.includes(q)
      )
    })
  }, [leads, leadSearch])

  // Live invoice totals for the builder preview + Save amount.
  const invoicePreview = useMemo(() => {
    const items = newPayment.line_items.map((li) => ({
      description: li.description,
      quantity: parseFloat(li.quantity) || 0,
      unit_price: parseFloat(li.unit_price) || 0,
    }))
    return computeTotals(items, parseFloat(newPayment.tax_rate) || 0, parseFloat(newPayment.discount) || 0)
  }, [newPayment.line_items, newPayment.tax_rate, newPayment.discount])

  // --- Invoice form helpers ---
  const setLineItem = (i: number, patch: Partial<LineItemDraft>) =>
    setNewPayment((p) => ({
      ...p,
      line_items: p.line_items.map((li, j) => (j === i ? { ...li, ...patch } : li)),
    }))
  const addLineItem = () =>
    setNewPayment((p) => ({
      ...p,
      line_items: [...p.line_items, { description: '', quantity: '1', unit_price: '' }],
    }))
  const removeLineItem = (i: number) =>
    setNewPayment((p) => ({ ...p, line_items: p.line_items.filter((_, j) => j !== i) }))

  const resetForm = () => {
    setNewPayment({ ...emptyForm })
    setEditId(null)
    setSelectedLeadId(null)
    setLeadSearch('')
    lastAutoInvoiceNo.current = ''
  }

  // Auto-fill the invoice number from the lead's history (their highest
  // number + 1). Only on NEW invoices, and never over a number the user
  // typed themselves - we only replace empty or our own prior suggestion.
  const lastAutoInvoiceNo = useRef('')
  const suggestInvoiceNumber = (leadId: string | null, isInvoice: boolean) => {
    if (editId || !isInvoice || !leadId) return
    setNewPayment((prev) => {
      if (prev.invoice_number && prev.invoice_number !== lastAutoInvoiceNo.current) return prev
      const suggestion = nextInvoiceNumberForLead(payments, leadId)
      lastAutoInvoiceNo.current = suggestion
      return { ...prev, invoice_number: suggestion }
    })
  }

  const handleAddPayment = async () => {
    const inv = newPayment.is_invoice

    const items: InvoiceLineItem[] = newPayment.line_items
      .map((li) => ({
        description: li.description.trim(),
        quantity: parseFloat(li.quantity) || 0,
        unit_price: parseFloat(li.unit_price) || 0,
      }))
      .filter((li) => li.description || li.quantity > 0 || li.unit_price > 0)
    const taxRate = parseFloat(newPayment.tax_rate) || 0
    const discount = parseFloat(newPayment.discount) || 0
    const totals = computeTotals(items, taxRate, discount)
    const amount = inv ? totals.total : parseFloat(newPayment.amount)

    // Invoice needs at least one line item; a plain payment needs an amount.
    if (inv ? items.length === 0 : !newPayment.amount) return
    setIsSavingPayment(true)

    try {
      const base = {
        client_id: clientId,
        lead_id: selectedLeadId || null,
        amount,
        currency: newPayment.currency,
        status: newPayment.status,
        due_date: newPayment.due_date || null,
        notes: newPayment.notes || null,
        invoice_number: newPayment.invoice_number || null,
        reminder_enabled: newPayment.reminder_enabled,
        is_recurring: newPayment.is_recurring,
        recurrence_type: newPayment.is_recurring ? newPayment.recurrence_type : null,
        recurrence_interval: newPayment.is_recurring ? newPayment.recurrence_interval : null,
        is_invoice: inv,
        line_items: inv ? items : [],
        bill_to_name: inv ? newPayment.bill_to_name || null : null,
        bill_to_email: inv ? newPayment.bill_to_email || null : null,
        issue_date: inv ? newPayment.issue_date || null : null,
        tax_rate: inv ? taxRate : 0,
        discount: inv ? discount : 0,
        payment_link: inv ? newPayment.payment_link || null : null,
        // Send on the due date; held as draft/scheduled until then.
        send_on: inv ? newPayment.due_date || null : null,
        send_status: inv ? (newPayment.schedule_send ? 'scheduled' : 'draft') : null,
      }

      let data: Payment | null = null
      if (editId) {
        const res = await supabase
          .from('payments')
          .update(base)
          .eq('id', editId)
          .select(`*, lead:leads(data), agreement:agreements!payments_agreement_id_fkey(id, title)`)
          .single()
        if (res.error) {
          console.error('Failed to update payment:', res.error)
          return
        }
        data = res.data as Payment
        const updated = data
        setPayments((prev) => prev.map((p) => (p.id === editId ? updated : p)))
      } else {
        const res = await supabase
          .from('payments')
          .insert({ ...base, recurring_count: 0 })
          .select(`*, lead:leads(data), agreement:agreements!payments_agreement_id_fkey(id, title)`)
          .single()
        if (res.error) {
          console.error('Failed to add payment:', res.error)
          return
        }
        data = res.data as Payment
        const inserted = data
        setPayments((prev) => [inserted, ...prev])
      }

      // The invoice is now a hosted page (/invoice/<public_token>), generated
      // from the row - no document to build here. The token comes back on the
      // inserted/updated row via the select above.

      // Notify on new records only (not edits).
      if (!editId && data) {
        try {
          if (userEmail) {
            await fetch('/api/notify-email', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                type: 'payment_created',
                payload: {
                  to: userEmail,
                  amount: data.amount,
                  currency: data.currency,
                  dueDate: data.due_date,
                  clientName: '',
                },
              }),
            })
          }
        } catch (err) {
          console.error('Failed to send payment_created email', err)
        }

        void fetch('/api/notifications/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientId,
            type: 'payment_created',
            data: { amount: data.amount, currency: data.currency, dueDate: data.due_date },
          }),
        }).catch((e) => console.error('in-app payment notification failed:', e))
      }

      setShowAddModal(false)
      resetForm()
    } finally {
      setIsSavingPayment(false)
    }
  }

  // Open the modal to edit an existing invoice (draft/scheduled only).
  const openEditInvoice = (p: Payment) => {
    setEditId(p.id)
    setSelectedLeadId(p.lead_id || null)
    setNewPayment({
      ...emptyForm,
      currency: p.currency || 'USD',
      status: p.status === 'paid' ? 'paid' : 'pending',
      due_date: p.due_date || '',
      notes: p.notes || '',
      invoice_number: p.invoice_number || '',
      reminder_enabled: p.reminder_enabled,
      is_invoice: true,
      bill_to_name: p.bill_to_name || '',
      bill_to_email: p.bill_to_email || '',
      issue_date: p.issue_date || '',
      tax_rate: p.tax_rate ? String(p.tax_rate) : '',
      discount: p.discount ? String(p.discount) : '',
      payment_link: p.payment_link || '',
      schedule_send: p.send_status !== 'draft',
      line_items:
        Array.isArray(p.line_items) && p.line_items.length
          ? p.line_items.map((li) => ({
              description: li.description || '',
              quantity: String(li.quantity ?? ''),
              unit_price: String(li.unit_price ?? ''),
            }))
          : [{ description: '', quantity: '1', unit_price: '' }],
    })
    setShowAddModal(true)
  }

  // The hosted invoice page URL for a row. Guarded for SSR (no window).
  const invoiceUrl = (p: Payment) =>
    p.public_token && typeof window !== 'undefined'
      ? `${window.location.origin}/invoice/${p.public_token}`
      : ''

  // Send a draft/scheduled invoice right now (skips waiting for the date).
  // Only flips to 'sent' if the email actually goes out.
  const handleSendNow = async (p: Payment) => {
    if (!p.bill_to_email) {
      alert('Add a bill-to email on this invoice before sending.')
      return
    }
    setSendingId(p.id)
    try {
      const res = await fetch('/api/notify-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'invoice_sent',
          payload: {
            clientId,
            to: p.bill_to_email,
            billToName: p.bill_to_name ?? '',
            invoiceNumber: p.invoice_number ?? '',
            amount: p.amount,
            currency: p.currency,
            dueDate: p.due_date,
            link: invoiceUrl(p),
          },
        }),
      })
      const ok = res.ok && (await res.json().catch(() => ({ success: false }))).success
      if (!ok) {
        alert('Could not send the invoice email. Check the Apps Script invoice_sent template is deployed.')
        return
      }
      const { error } = await supabase
        .from('payments')
        .update({ send_status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', p.id)
      if (!error) {
        setPayments((prev) =>
          prev.map((x) =>
            x.id === p.id ? { ...x, send_status: 'sent', sent_at: new Date().toISOString() } : x,
          ),
        )
      }
    } finally {
      setSendingId(null)
    }
  }

  // CRM confirms the client's "I've paid" - flips the invoice to Paid.
  const handleConfirmPaid = async (p: Payment) => {
    setConfirmingId(p.id)
    try {
      const { error } = await supabase
        .from('payments')
        .update({ status: 'paid', paid_date: new Date().toISOString() })
        .eq('id', p.id)
      if (!error) {
        setPayments((prev) =>
          prev.map((x) => (x.id === p.id ? { ...x, status: 'paid' } : x)),
        )
      }
    } finally {
      setConfirmingId(null)
    }
  }

  const getNextDueDate = (
    currentDue: string | null,
    type: 'days' | 'weeks' | 'months' | null,
    interval: number | null
  ): string | null => {
    if (!currentDue || !type || !interval || interval <= 0) return null
    const date = new Date(currentDue)

    switch (type) {
      case 'days':
        date.setDate(date.getDate() + interval)
        break
      case 'weeks':
        date.setDate(date.getDate() + interval * 7)
        break
      case 'months':
        date.setMonth(date.getMonth() + interval)
        break
    }

    return date.toISOString().split('T')[0]
  }

  const handleUpdateStatus = async (paymentId: string, status: Payment['status']) => {
    const prev = payments
    const payment = payments.find(p => p.id === paymentId)
    if (!payment) return

    const updates: Partial<Payment> = { status }
    if (status === 'paid') {
      updates.paid_date = new Date().toISOString().split('T')[0]
    } else {
      updates.paid_date = null
    }

    const updated = payments.map(p =>
      p.id === paymentId ? { ...p, ...updates } : p
    )
    setPayments(updated)

    const { error } = await supabase
      .from('payments')
      .update(updates)
      .eq('id', paymentId)

    if (error) {
      console.error('Failed to update payment status:', error)
      setPayments(prev)
      return
    }

    // Handle recurring logic
    if (
      status === 'paid' &&
      payment.is_recurring &&
      payment.due_date &&
      payment.recurrence_type &&
      payment.recurrence_interval
    ) {
      const nextDue = getNextDueDate(
        payment.due_date,
        payment.recurrence_type,
        payment.recurrence_interval
      )

      if (nextDue) {
        const { data: nextData, error: nextError } = await supabase
          .from('payments')
          .insert({
            client_id: payment.client_id,
            lead_id: payment.lead_id || null,
            amount: payment.amount,
            currency: payment.currency,
            status: 'pending',
            due_date: nextDue,
            notes: payment.notes,
            invoice_number: payment.invoice_number,
            reminder_enabled: payment.reminder_enabled,
            is_recurring: true,
            recurrence_type: payment.recurrence_type,
            recurrence_interval: payment.recurrence_interval,
            recurring_count: (payment.recurring_count || 0) + 1,
            // Carry invoice fields so a recurring invoice regenerates as a
            // fresh invoice (new token, unpaid, re-scheduled to the next date).
            is_invoice: payment.is_invoice ?? false,
            line_items: payment.is_invoice ? payment.line_items ?? [] : [],
            bill_to_name: payment.bill_to_name ?? null,
            bill_to_email: payment.bill_to_email ?? null,
            issue_date: payment.is_invoice ? nextDue : null,
            tax_rate: payment.tax_rate ?? 0,
            discount: payment.discount ?? 0,
            payment_link: payment.payment_link ?? null,
            send_on: payment.is_invoice ? nextDue : null,
            send_status: payment.is_invoice ? 'scheduled' : null,
          })
          .select()
          .single()

        if (!nextError && nextData) {
          setPayments(prevPayments => [nextData as Payment, ...prevPayments])
        }
      }
    }

  }

  const handleToggleReminder = async (paymentId: string) => {
    const previous = payments
    const payment = payments.find(p => p.id === paymentId)
    if (!payment) return

    const newValue = !payment.reminder_enabled

    const updated = payments.map(p =>
      p.id === paymentId ? { ...p, reminder_enabled: newValue } : p
    )
    setPayments(updated)

    const { error } = await supabase
      .from('payments')
      .update({ reminder_enabled: newValue })
      .eq('id', paymentId)

    if (error) {
      console.error('Failed to toggle reminder:', error)
      setPayments(previous)
    }
  }

  const handleDeletePayment = async (paymentId: string) => {
    const prev = payments
    const updated = payments.filter(p => p.id !== paymentId)
    setPayments(updated)

    const { error } = await supabase
      .from('payments')
      .delete()
      .eq('id', paymentId)

    if (error) {
      console.error('Failed to delete payment:', error)
      setPayments(prev)
      throw new Error('Failed to delete payment')
    }
  }

  // ---- Currency handling -------------------------------------------------
  // - currencyFilter: 'ALL' or a specific code (e.g., 'USD'). Filters which
  //   payments are visible.
  // - convertTo: when set, totals + rows render in this currency.
  // - defaultCurrency: the fallback for "All" so summed totals make sense
  //   (otherwise you'd be adding NGN to USD as if they were the same).
  const [currencyFilter, setCurrencyFilter] = useState<string>('ALL')
  const [convertTo, setConvertTo] = useState<string | null>(null)
  const fx = useExchangeRates('USD')
  const { defaultCurrency, setDefaultCurrency } = useDefaultCurrency(clientId)

  // Chart controls: time bucket size + lead filter (multi-select). Empty
  // chartLeadIds means "all leads".
  const [bucketMode, setBucketMode] = useState<BucketMode>('day')
  const [chartLeadIds, setChartLeadIds] = useState<string[]>([])

  // Lead options for the chart filter. Names come from each lead's data
  // payload (CRMs can have any custom shape, but `name` and `email` are
  // the universal defaults).
  const chartLeadOptions: LeadFilterOption[] = useMemo(() => {
    return leads
      .map((l) => {
        const d = (l.data || {}) as Record<string, unknown>
        const name =
          (typeof d.name === 'string' && d.name) ||
          (typeof d.email === 'string' && d.email) ||
          'Unnamed'
        const email = typeof d.email === 'string' ? d.email : null
        return { id: l.id, name, email }
      })
      .filter((o) => o.name)
  }, [leads])

  const availableCurrencies = useMemo(() => {
    const set = new Set<string>()
    for (const p of payments) {
      if (p.currency) set.add(p.currency.toUpperCase())
    }
    return Array.from(set).sort()
  }, [payments])

  // The currency every total/row should be displayed in. Resolution:
  //   1. convertTo (explicit user override)
  //   2. the single filter currency (no conversion needed)
  //   3. defaultCurrency (the per-CRM "report in this currency" setting)
  const displayCurrencyCode =
    convertTo || (currencyFilter !== 'ALL' ? currencyFilter : defaultCurrency)

  // Convert a payment amount into the active display currency. Always
  // converts now (even without an explicit convertTo) so summed totals
  // are coherent.
  const displayAmount = (p: { amount: number; currency: string }) => {
    return convertAmountValue(p.amount, p.currency || 'USD', displayCurrencyCode, fx.rates)
  }
  const displayAmountFull = (p: { amount: number; currency: string }) => {
    return convertAmount(p.amount, p.currency || 'USD', displayCurrencyCode, fx.rates)
  }

  const filteredPayments = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    const base = payments.filter((p) => {
      if (filter !== 'all' && p.status !== filter) return false
      if (
        currencyFilter !== 'ALL' &&
        (p.currency || '').toUpperCase() !== currencyFilter
      )
        return false
      if (q) {
        const leadData = (p.lead?.data || {}) as Record<string, string>
        const haystack = [
          leadData.name,
          leadData.email,
          p.invoice_number,
          p.notes,
          p.currency,
          String(p.amount),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })

    // Sort. Defensive on missing dates / amounts.
    const dueTime = (p: Payment) =>
      p.due_date ? new Date(p.due_date).getTime() : Number.POSITIVE_INFINITY
    const createdTime = (p: Payment) => new Date(p.created_at).getTime()
    const sorted = [...base]
    switch (sortBy) {
      case 'newest':
        sorted.sort((a, b) => createdTime(b) - createdTime(a))
        break
      case 'oldest':
        sorted.sort((a, b) => createdTime(a) - createdTime(b))
        break
      case 'amount-desc':
        sorted.sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0))
        break
      case 'amount-asc':
        sorted.sort((a, b) => Number(a.amount || 0) - Number(b.amount || 0))
        break
      case 'due-soon':
        sorted.sort((a, b) => dueTime(a) - dueTime(b))
        break
      case 'due-late':
        sorted.sort((a, b) => dueTime(b) - dueTime(a))
        break
    }
    return sorted
  }, [payments, filter, currencyFilter, searchQuery, sortBy])

  // Build the stats from `filteredPayments` (so currency filter is
  // respected) and convert via displayAmount (so convert-to is respected).
  const stats = (() => {
    const sumBy = (predicate: (p: Payment) => boolean) =>
      filteredPayments
        .filter(predicate)
        .reduce((sum, p) => sum + displayAmount(p), 0)
    return {
      total: sumBy((p) => p.status === 'paid'),
      pending: sumBy((p) => p.status === 'pending'),
      overdue: sumBy((p) => p.status === 'overdue'),
      thisMonth: sumBy(
        (p) =>
          p.status === 'paid' &&
          !!p.paid_date &&
          new Date(p.paid_date).getMonth() === new Date().getMonth(),
      ),
    }
  })()

  // 30-day revenue trend - paid amount per day, in the active display
  // currency. Honours the currency filter so a per-currency view shows
  // only that currency's inflow.
  //
  // Critical: bucket keys are LOCAL dates, not UTC. Using
  // toISOString().slice(0,10) silently drops payments in any UTC+
  // timezone because a payment created at 6am Lagos (UTC+1) maps to
  // the previous UTC day, which isn't in the 30-day local window.
  // Revenue chart data, broken down by status (collected/pending/
  // overdue) PLUS a per-bucket collection rate. The rate line is the
  // actionable health signal: it dives when overdue grows and rises
  // when invoices land.
  const REVENUE_SERIES: SeriesDef[] = [
    { key: 'collected', label: 'Collected', color: '#10B981' },
    { key: 'pending', label: 'Pending', color: '#F59E0B' },
    { key: 'overdue', label: 'Overdue', color: '#EF4444' },
  ]
  const { revenueChartData, revenueBucketLabel } = useMemo(() => {
      const leadFilterSet = new Set(chartLeadIds)
      const today = new Date()
      // Build one event per visible payment, with the right reference
      // date per status. Note overdue uses TODAY (not the original
      // due date) because overdue is an open burden NOW - the chart
      // should reflect current exposure, not where the bill landed
      // on the calendar months ago.
      const events: ChartEvent[] = []
      for (const p of payments) {
        if (
          currencyFilter !== 'ALL' &&
          (p.currency || '').toUpperCase() !== currencyFilter
        )
          continue
        if (leadFilterSet.size > 0 && !leadFilterSet.has(p.lead_id || ''))
          continue
        // paid    -> paid_date  (when money came in)
        // pending -> due_date   (when money is expected)
        // overdue -> today      (live exposure, not historical event)
        let ref: Date
        if (p.status === 'paid') {
          ref = new Date(p.paid_date || p.created_at)
        } else if (p.status === 'overdue') {
          ref = today
        } else if (p.status === 'pending') {
          ref = new Date(p.due_date || p.created_at)
        } else {
          continue // cancelled
        }
        const amt = displayAmount(p)
        const values: Record<string, number> = {
          collected: 0,
          pending: 0,
          overdue: 0,
        }
        if (p.status === 'paid') values.collected = amt
        else if (p.status === 'overdue') values.overdue = amt
        else if (p.status === 'pending') values.pending = amt
        events.push({ date: ref, values })
      }

      const { rows, effectiveMode } = bucketize(events, {
        mode: bucketMode,
        seriesKeys: ['collected', 'pending', 'overdue'],
        windowDays: 30,
        windowWeeks: 12,
        windowMonths: 12,
      })

    const labels: Record<string, string> = {
      day: 'Day',
      week: 'Week',
      month: 'Month',
    }
    return {
      revenueChartData: rows,
      revenueBucketLabel: labels[effectiveMode] || effectiveMode,
    }
    // displayAmount depends on convertTo + fx.rates; eslint can't see.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payments, currencyFilter, convertTo, fx.rates, bucketMode, chartLeadIds])

  // Period-over-period metrics for the chart's stat strip:
  //   - Collected this period vs prior period of same length (for delta)
  //   - Outstanding right now (pending + overdue, regardless of date)
  //   - Overdue right now
  // These are the standard accounts-receivable numbers any accountant
  // recognizes at a glance.
  const periodMetrics = useMemo(() => {
    const now = Date.now()
    const dayMs = 24 * 60 * 60 * 1000
    let windowMs: number | null = null
    if (bucketMode === 'day') windowMs = 30 * dayMs
    else if (bucketMode === 'week') windowMs = 12 * 7 * dayMs
    else if (bucketMode === 'month') windowMs = 365 * dayMs
    // bucketMode === 'all' -> no comparison window

    const thisStart = windowMs == null ? 0 : now - windowMs
    const priorStart = windowMs == null ? 0 : now - 2 * windowMs

    let thisCollected = 0
    let priorCollected = 0
    let outstandingNow = 0
    let overdueNow = 0
    const leadSet = new Set(chartLeadIds)
    for (const p of payments) {
      if (
        currencyFilter !== 'ALL' &&
        (p.currency || '').toUpperCase() !== currencyFilter
      )
        continue
      if (leadSet.size > 0 && !leadSet.has(p.lead_id || '')) continue
      const amt = displayAmount(p)
      if (p.status === 'paid') {
        const ref = p.paid_date || p.created_at
        const t = new Date(ref).getTime()
        if (windowMs == null) {
          thisCollected += amt
        } else if (t >= thisStart) {
          thisCollected += amt
        } else if (t >= priorStart) {
          priorCollected += amt
        }
      } else if (p.status === 'pending') {
        outstandingNow += amt
      } else if (p.status === 'overdue') {
        outstandingNow += amt
        overdueNow += amt
      }
    }
    const delta =
      windowMs == null
        ? null
        : priorCollected === 0
          ? thisCollected === 0
            ? 0
            : 100
          : Math.round(
              ((thisCollected - priorCollected) / priorCollected) * 100,
            )
    return { thisCollected, outstandingNow, overdueNow, delta }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payments, currencyFilter, convertTo, fx.rates, bucketMode, chartLeadIds])

  // Payment count distribution for the donut.
  const statusMix = useMemo(() => {
    const counts = { paid: 0, pending: 0, overdue: 0 }
    for (const p of payments) {
      if (p.status === 'paid') counts.paid++
      else if (p.status === 'overdue') counts.overdue++
      else if (p.status === 'pending') counts.pending++
    }
    return [
      { label: 'Paid', value: counts.paid, color: '#10B981' },
      { label: 'Pending', value: counts.pending, color: '#F59E0B' },
      { label: 'Overdue', value: counts.overdue, color: '#EF4444' },
    ]
  }, [payments])
  const statusTotal = statusMix.reduce((s, x) => s + x.value, 0)

  // ---- PDF export -------------------------------------------------------

  const { workspaceName } = useCrmRole()
  const [isExporting, setIsExporting] = useState(false)

  const handleExportPdf = async () => {
    if (isExporting) return
    setIsExporting(true)
    try {
      // Dynamic import keeps the ~300kb @react-pdf bundle out of the
      // page's initial chunk - it only loads when someone exports.
      const [{ pdf }, { RevenueReport }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('@/components/reports/RevenueReport'),
      ])

      // Sum amounts per status (already in display currency) for the
      // breakdown table.
      const byStatus = {
        paid: { count: 0, amount: 0 },
        pending: { count: 0, amount: 0 },
        overdue: { count: 0, amount: 0 },
        cancelled: { count: 0, amount: 0 },
      }
      for (const p of filteredPayments) {
        const k = p.status
        byStatus[k].count++
        byStatus[k].amount += displayAmount(p)
      }

      const rows = filteredPayments.map((p) => {
        const data = (p.lead?.data || {}) as Record<string, string>
        const customer =
          data.name ||
          data.email ||
          (p.lead_id ? 'Linked lead' : 'Unassigned')
        return {
          invoiceNumber: p.invoice_number,
          customer,
          amountOriginal: Number(p.amount || 0),
          originalCurrency: (p.currency || displayCurrencyCode).toUpperCase(),
          status: p.status,
          dueDate: p.due_date,
          paidDate: p.paid_date,
        }
      })

      // Header pills - mirror the active filters so the reader sees
      // exactly which slice they got.
      const filters: string[] = []
      if (currencyFilter !== 'ALL') filters.push(`Currency: ${currencyFilter}`)
      else filters.push(`All currencies in ${displayCurrencyCode}`)
      if (filter !== 'all') filters.push(`Status: ${filter}`)
      if (searchQuery.trim())
        filters.push(`Search: "${searchQuery.trim()}"`)

      const bucketLabel =
        bucketMode === 'all'
          ? 'All time'
          : bucketMode === 'day'
            ? 'Per day · last 30 days'
            : bucketMode === 'week'
              ? 'Per week · last 12 weeks'
              : 'Per month · last 12 months'

      const blob = await pdf(
        <RevenueReport
          workspaceName={workspaceName}
          bucketLabel={bucketLabel}
          filters={filters}
          displayCurrency={displayCurrencyCode}
          metrics={periodMetrics}
          byStatus={byStatus}
          rows={rows}
        />,
      ).toBlob()

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const stamp = new Date().toISOString().slice(0, 10)
      a.download = `${workspaceName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-revenue-${stamp}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      // Revoke after a tick so Safari has time to start the download.
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (err) {
      console.error('Revenue PDF export failed:', err)
      alert('Could not generate PDF. Check the console for details.')
    } finally {
      setIsExporting(false)
    }
  }

  // Format a number as the active display currency. Intl gives us the
  // correct symbol per locale ($, ₦, €, ¥, etc).
  const formatTotal = (n: number) => {
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: displayCurrencyCode,
        maximumFractionDigits: 0,
      }).format(n)
    } catch {
      return `${displayCurrencyCode} ${Math.round(n).toLocaleString()}`
    }
  }
  // Surface a warning when any payment's currency doesn't have a rate.
  // Those rows fall through to original amounts; everyone else converts.
  const unreachableCurrencies = availableCurrencies.filter((c) => !fx.rates[c])
  const conversionWarning =
    unreachableCurrencies.length > 0
      ? `No FX rate for ${unreachableCurrencies.join(', ')}. Those payments are shown in their original currency.`
      : null

function RevenueSkeleton() {
  return (
    <div className="p-3 sm:p-4 lg:p-6 min-h-full animate-in fade-in">
      <div className="flex items-center justify-between mb-3 gap-2">
        <Skeleton className="h-3 w-40 bg-[var(--bg-card-hover)]" />
        {/* Kebab only - Add Payment now lives inside it. */}
        <Skeleton className="h-8 w-8 rounded-lg bg-[var(--bg-card-hover)]" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4 mb-4 sm:mb-6">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="glass-card rounded-2xl p-3 sm:p-4">
            <div className="flex items-center gap-2 mb-2">
              <Skeleton className="h-7 w-7 sm:h-8 sm:w-8 rounded-lg bg-[var(--bg-card-hover)]" />
              <Skeleton className="h-3 w-16 sm:w-20 bg-[var(--bg-card-hover)]" />
            </div>
            <Skeleton className="h-6 sm:h-7 w-20 sm:w-24 bg-[var(--bg-card-hover)]" />
          </div>
        ))}
      </div>

      <div className="flex gap-1.5 mb-4">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-7 sm:h-9 w-16 sm:w-20 rounded-xl bg-[var(--bg-card-hover)]" />
        ))}
      </div>

      <div className="glass-card rounded-2xl overflow-hidden">
        <div className="border-b border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4 flex gap-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-3 w-20 sm:w-24 bg-[var(--bg-card-hover)] shrink-0" />
          ))}
        </div>
        <div className="divide-y divide-[var(--border-primary)]">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="p-4 flex gap-4">
              {[1, 2, 3, 4, 5].map((j) => (
                <Skeleton key={j} className="h-5 w-20 sm:w-24 bg-[var(--bg-card-hover)] shrink-0" />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

  if (isLoading) {
    return <RevenueSkeleton />
  }

  return (
    <div className="p-3 sm:p-4 lg:p-6 min-h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-3 gap-2">
        <p className="text-xs text-[var(--text-tertiary)]">Track payments and invoices</p>
        <KebabMenu
          items={[
            {
              label: 'Add Payment',
              icon: <Plus className="h-4 w-4" />,
              onClick: () => setShowAddModal(true),
            },
            {
              label: isExporting ? 'Generating PDF…' : 'Export as PDF',
              icon: <FileDown className="h-4 w-4" />,
              disabled: isExporting,
              onClick: handleExportPdf,
            },
          ]}
        />
      </div>

      {/* Currency control - filters, default-currency setter, and
          convert-to override all live here. Always shown so users can
          set their default before any payments exist. */}
      <div className="mb-4 space-y-2">
        <CurrencyControl
          available={availableCurrencies}
          filter={currencyFilter}
          onFilterChange={setCurrencyFilter}
          convertTo={convertTo}
          onConvertToChange={setConvertTo}
          defaultCurrency={defaultCurrency}
          onDefaultCurrencyChange={setDefaultCurrency}
          supportedTargets={Object.keys(fx.rates)}
          loading={fx.loading}
          date={fx.date}
          error={fx.error}
        />
        {conversionWarning && (
          <p className="text-[11px] text-amber-500">{conversionWarning}</p>
        )}
      </div>

      {/* Hero: revenue trend chart + status mix donut */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4 mb-4 sm:mb-6">
        <div className="lg:col-span-2 glass-card rounded-2xl p-4 sm:p-5">
          <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
            <div className="flex items-start gap-6 sm:gap-8 flex-wrap">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-semibold">
                  Collected
                </p>
                <div className="flex items-baseline gap-2 mt-1">
                  <p className="text-2xl sm:text-3xl font-bold text-[var(--text-primary)] tabular-nums">
                    {formatTotal(periodMetrics.thisCollected)}
                  </p>
                  {periodMetrics.delta != null && periodMetrics.delta !== 0 && (
                    <span
                      className={`text-xs tabular-nums font-semibold ${
                        periodMetrics.delta > 0
                          ? 'text-emerald-500'
                          : 'text-red-500'
                      }`}
                    >
                      {periodMetrics.delta > 0 ? '↗ +' : '↘ '}
                      {periodMetrics.delta}%
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-[var(--text-tertiary)] mt-0.5">
                  per {revenueBucketLabel.toLowerCase()} window
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-semibold">
                  Outstanding
                </p>
                <p className="text-2xl sm:text-3xl font-bold text-[var(--text-primary)] tabular-nums mt-1">
                  {formatTotal(periodMetrics.outstandingNow)}
                </p>
                <p className="text-[10px] text-[var(--text-tertiary)] mt-0.5">
                  pending + overdue, now
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-semibold">
                  Overdue
                </p>
                <p
                  className={`text-2xl sm:text-3xl font-bold tabular-nums mt-1 ${
                    periodMetrics.overdueNow > 0
                      ? 'text-red-500'
                      : 'text-[var(--text-primary)]'
                  }`}
                >
                  {formatTotal(periodMetrics.overdueNow)}
                </p>
                <p className="text-[10px] text-[var(--text-tertiary)] mt-0.5">
                  past due, now
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap justify-end">
              <LeadFilter
                options={chartLeadOptions}
                value={chartLeadIds}
                onChange={setChartLeadIds}
              />
              <BucketToggle value={bucketMode} onChange={setBucketMode} />
            </div>
          </div>
          <StatusStackedBar
            data={revenueChartData}
            series={REVENUE_SERIES}
            height={260}
            formatValue={(n) => formatTotal(n)}
            yAxisWidth={80}
          />
        </div>

        <div className="glass-card rounded-2xl p-4 sm:p-5 flex flex-col">
          <p className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-semibold mb-3">
            Invoice mix
          </p>
          {statusTotal === 0 ? (
            <p className="text-xs text-[var(--text-tertiary)] py-6 text-center flex-1 flex items-center justify-center">
              No invoices yet.
            </p>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 min-h-[240px]">
              <DonutChart
                data={statusMix}
                size={200}
                thickness={20}
                centerLabel={String(statusTotal)}
                centerSubLabel="invoices"
              />
              <div className="w-full">
                <ChartLegend items={statusMix} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Compact KPI strip - money pucks render the active currency
          symbol (₦/€/$/etc.) so the icon stays in sync with the totals. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3 mb-4 sm:mb-6">
        <RevenueKpi
          iconBg="bg-green-500/15"
          iconColor="text-green-500"
          label="Total"
          value={formatTotal(stats.total)}
          symbolCurrency={displayCurrencyCode}
        />
        <RevenueKpi
          iconBg="bg-blue-500/15"
          iconColor="text-blue-500"
          label="This month"
          value={formatTotal(stats.thisMonth)}
          symbolCurrency={displayCurrencyCode}
        />
        <RevenueKpi
          iconBg="bg-yellow-500/15"
          iconColor="text-yellow-500"
          label="Pending"
          value={formatTotal(stats.pending)}
          valueColor="text-yellow-500"
          symbolCurrency={displayCurrencyCode}
        />
        <RevenueKpi
          iconBg="bg-red-500/15"
          iconColor="text-red-500"
          label="Overdue"
          value={formatTotal(stats.overdue)}
          valueColor="text-red-500"
          symbolCurrency={displayCurrencyCode}
        />
      </div>

      {/* Filter pills + search + sort, all in one row. Wraps to two rows
          on narrow screens. */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          {(['all', 'pending', 'paid', 'overdue'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors shrink-0 ${
                filter === f
                  ? 'bg-[#2B79F7] text-white'
                  : 'bg-[var(--bg-card)] text-[var(--text-secondary)] border border-[var(--border-primary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]'
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>

        {/* Search + sort group wraps to its own line on mobile so it
            doesn't get crushed against the filter pills. flex-1 only
            kicks in from sm: up - on mobile it takes the full row. */}
        <div className="flex items-center gap-2 w-full sm:w-auto sm:flex-1 sm:min-w-[280px]">
          {/* Search */}
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-tertiary)]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search lead, invoice #, notes..."
              className="w-full pl-8 pr-3 py-1.5 rounded-full text-xs bg-[var(--bg-input)] text-[var(--text-primary)] border border-[var(--border-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
            />
          </div>

          {/* Sort */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortKey)}
            className="px-2.5 py-1.5 rounded-full text-xs font-medium bg-[var(--bg-input)] text-[var(--text-secondary)] border border-[var(--border-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7] hover:text-[var(--text-primary)]"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="amount-desc">Amount, high to low</option>
            <option value="amount-asc">Amount, low to high</option>
            <option value="due-soon">Due soonest</option>
            <option value="due-late">Due latest</option>
          </select>
        </div>
      </div>

      {/* Payments list - one card with row dividers, no horizontal scroll
          on mobile, full table-like layout on desktop. */}
      {filteredPayments.length === 0 ? (
        <div className="glass-card rounded-2xl p-8 text-center text-[var(--text-tertiary)]">
          <DollarSign className="h-10 w-10 mx-auto mb-3" />
          <p className="text-sm">No payments found.</p>
          <div className="mt-4 flex justify-center">
            <Button onClick={() => setShowAddModal(true)}>
              <Plus className="h-4 w-4 mr-1.5" />
              Add Payment
            </Button>
          </div>
        </div>
      ) : (
        <div className="glass-card rounded-2xl overflow-hidden divide-y divide-[var(--border-primary)]">
          {filteredPayments.map((payment) => {
            const config = statusConfig[payment.status]
            const StatusIcon = config.icon
            const isTemp = payment.id.startsWith('temp-')
            const leadData = (payment.lead?.data || {}) as Record<string, string>
            const leadName = leadData.name || ''
            const leadEmail = leadData.email || ''
            const leadInitial = (leadName || leadEmail || '?').charAt(0).toUpperCase()
            const overdue =
              payment.status === 'overdue' ||
              (payment.status === 'pending' &&
                payment.due_date &&
                new Date(payment.due_date) < new Date())

            return (
              <div
                key={payment.id}
                id={`pay-${payment.id}`}
                className={`px-3 sm:px-4 py-3 flex items-center gap-3 transition-all ${
                  isTemp ? 'opacity-60 pointer-events-none' : ''
                } ${
                  highlightId === payment.id
                    ? 'ring-2 ring-[#2B79F7] rounded-xl bg-[#2B79F7]/5'
                    : ''
                }`}
              >
                {/* Lead avatar */}
                <div className="h-9 w-9 rounded-full bg-gradient-to-br from-[#2B79F7] to-[#1E54B7] text-white text-xs font-semibold flex items-center justify-center shrink-0">
                  {leadInitial}
                </div>

                {/* Lead + amount + meta */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    {(() => {
                      // Per-row: format in the actual effective currency.
                      // When conversion to convertTo failed for this row,
                      // we keep the original currency on the row instead
                      // of pretending it converted.
                      const result = displayAmountFull(payment)
                      let formatted: string
                      try {
                        formatted = new Intl.NumberFormat(undefined, {
                          style: 'currency',
                          currency: result.effectiveCurrency,
                          maximumFractionDigits: 0,
                        }).format(result.value)
                      } catch {
                        formatted = `${result.effectiveCurrency} ${Math.round(result.value).toLocaleString()}`
                      }
                      return (
                        <span className="text-base font-bold text-[var(--text-primary)] tabular-nums">
                          {formatted}
                        </span>
                      )
                    })()}
                    {convertTo &&
                      payment.currency &&
                      payment.currency !== convertTo &&
                      fx.rates[payment.currency] &&
                      fx.rates[convertTo] && (
                        <span
                          className="text-[10px] text-[var(--text-tertiary)] tabular-nums"
                          title={`Original: ${payment.amount} ${payment.currency}`}
                        >
                          from {payment.currency}
                        </span>
                      )}
                    {payment.invoice_number && (
                      <span className="text-[10px] text-[var(--text-tertiary)] tabular-nums">
                        · #{payment.invoice_number}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[var(--text-secondary)] truncate">
                    {leadName || leadEmail || 'No lead linked'}
                  </p>
                  {payment.agreement && (
                    <p className="text-[10px] font-semibold text-[#2B79F7] truncate">
                      From agreement: {payment.agreement.title}
                    </p>
                  )}
                  <p className="text-[10px] text-[var(--text-tertiary)] mt-0.5">
                    {payment.due_date
                      ? `Due ${new Date(payment.due_date).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                        })}`
                      : 'No due date'}
                    {overdue && ' · overdue'}
                  </p>
                </div>

                {/* Status select - styled as a pill */}
                <select
                  value={payment.status}
                  onChange={(e) =>
                    handleUpdateStatus(payment.id, e.target.value as Payment['status'])
                  }
                  className={`hidden sm:inline-flex items-center gap-1 ${config.bg} text-xs font-medium px-2.5 py-1 rounded-full border-0 focus:outline-none focus:ring-2 focus:ring-[#2B79F7] cursor-pointer shrink-0`}
                  style={{ color: config.color }}
                >
                  <option value="pending">Pending</option>
                  <option value="paid">Paid</option>
                  <option value="overdue">Overdue</option>
                  <option value="cancelled">Cancelled</option>
                </select>
                {/* Mobile: status as a non-interactive chip; full select lives
                    in the row's expanded modal (kebab) - keeping the row tight */}
                <span
                  className={`sm:hidden inline-flex items-center gap-1 ${config.bg} text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0`}
                  style={{ color: config.color }}
                >
                  <StatusIcon className="h-2.5 w-2.5" />
                  {config.label}
                </span>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0">
                  {payment.is_invoice && (
                    <>
                      <span
                        className={`hidden sm:inline-flex items-center text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0 ${
                          payment.send_status === 'sent'
                            ? 'bg-green-500/20 text-green-500'
                            : payment.send_status === 'scheduled'
                              ? 'bg-blue-500/20 text-[#2B79F7]'
                              : 'bg-gray-500/20 text-[var(--text-tertiary)]'
                        }`}
                        title={
                          payment.send_status === 'scheduled' && payment.send_on
                            ? `Auto-sends ${new Date(payment.send_on).toLocaleDateString()}`
                            : undefined
                        }
                      >
                        {payment.send_status === 'sent'
                          ? 'Sent'
                          : payment.send_status === 'scheduled'
                            ? 'Scheduled'
                            : 'Draft'}
                      </span>
                      {payment.client_marked_paid_at && payment.status !== 'paid' && (
                        <button
                          onClick={() => handleConfirmPaid(payment)}
                          disabled={confirmingId === payment.id}
                          title="Client marked this paid - confirm it"
                          className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400 hover:bg-amber-500/30 transition-colors disabled:opacity-50 shrink-0"
                        >
                          {confirmingId === payment.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <CheckCircle className="h-3 w-3" />
                          )}
                          Confirm paid
                        </button>
                      )}
                      {payment.public_token && (
                        <a
                          href={invoiceUrl(payment)}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Open invoice page"
                          className="p-1.5 rounded-md text-[var(--text-tertiary)] hover:text-[#2B79F7] hover:bg-[#2B79F7]/10 transition-colors"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      )}
                      {payment.public_token && (
                        <button
                          onClick={() => {
                            void navigator.clipboard.writeText(invoiceUrl(payment))
                            const id = payment.id
                            setCopiedId(id)
                            setTimeout(
                              () => setCopiedId((c) => (c === id ? null : c)),
                              1500,
                            )
                          }}
                          title={copiedId === payment.id ? 'Copied!' : 'Copy invoice link'}
                          className="p-1.5 rounded-md text-[var(--text-tertiary)] hover:text-[#2B79F7] hover:bg-[#2B79F7]/10 transition-colors"
                        >
                          {copiedId === payment.id ? (
                            <Check className="h-4 w-4 text-green-600" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                        </button>
                      )}
                      {payment.send_status !== 'sent' && (
                        <>
                          <button
                            onClick={() => openEditInvoice(payment)}
                            title="Edit invoice"
                            className="p-1.5 rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] transition-colors"
                          >
                            <FileText className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleSendNow(payment)}
                            disabled={sendingId === payment.id}
                            title="Send now"
                            className="p-1.5 rounded-md text-[var(--text-tertiary)] hover:text-[#2B79F7] hover:bg-[#2B79F7]/10 transition-colors disabled:opacity-50"
                          >
                            {sendingId === payment.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Send className="h-4 w-4" />
                            )}
                          </button>
                        </>
                      )}
                    </>
                  )}
                  <button
                    onClick={() => handleToggleReminder(payment.id)}
                    title={payment.reminder_enabled ? 'Reminder on' : 'Reminder off'}
                    className={`p-1.5 rounded-md transition-colors ${
                      payment.reminder_enabled
                        ? 'text-[#2B79F7] hover:bg-[#2B79F7]/10'
                        : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)]'
                    }`}
                  >
                    {payment.reminder_enabled ? (
                      <Bell className="h-4 w-4" />
                    ) : (
                      <BellOff className="h-4 w-4" />
                    )}
                  </button>
                  <button
                    onClick={() => setPendingDeleteId(payment.id)}
                    title="Delete"
                    className="p-1.5 rounded-md text-[var(--text-tertiary)] hover:text-red-500 hover:bg-red-500/10 transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Add Payment Modal */}
      {showAddModal && (
        <Modal
          onClose={() => {
            setShowAddModal(false)
            resetForm()
          }}
          title={editId ? 'Edit invoice' : newPayment.is_invoice ? 'New invoice' : 'Add Payment'}
        >
          <div className="space-y-4">
            {/* Invoice toggle - off = simple payment record, on = full invoice. */}
            <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-4 py-3">
              <div>
                <p className="text-sm font-medium text-[var(--text-primary)] flex items-center gap-1.5">
                  <FileText className="h-4 w-4 text-[#2B79F7]" /> Create as invoice
                </p>
                <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
                  Line items, totals, and a downloadable .docx. Held as a draft until the send date.
                </p>
              </div>
              <Toggle
                checked={newPayment.is_invoice}
                onChange={(v) => {
                  setNewPayment({ ...newPayment, is_invoice: v })
                  if (v) suggestInvoiceNumber(selectedLeadId, true)
                }}
              />
            </div>

            {newPayment.is_invoice ? (
              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">
                  Currency
                </label>
                <CurrencyPicker
                  value={newPayment.currency}
                  onChange={(next) => {
                    if (next) setNewPayment({ ...newPayment, currency: next })
                  }}
                  options={Object.keys(fx.rates)}
                  variant="input"
                  placeholder="Choose currency"
                />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">
                    Amount
                  </label>
                  <input
                    type="number"
                    value={newPayment.amount}
                    onChange={(e) => setNewPayment({ ...newPayment, amount: e.target.value })}
                    placeholder="0.00"
                    className="w-full px-4 py-2.5 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-xl text-[var(--text-primary)] placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">
                    Currency
                  </label>
                  <CurrencyPicker
                    value={newPayment.currency}
                    onChange={(next) => {
                      if (next) setNewPayment({ ...newPayment, currency: next })
                    }}
                    options={Object.keys(fx.rates)}
                    variant="input"
                    placeholder="Choose currency"
                  />
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">
                  Status
                </label>
                <select
                  value={newPayment.status}
                  onChange={(e) =>
                    setNewPayment({
                      ...newPayment,
                      status: e.target.value as Payment['status'],
                    })
                  }
                  className="w-full px-4 py-2.5 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-xl text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                >
                  <option value="pending">Pending</option>
                  <option value="paid">Paid</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">
                  Due Date
                </label>
                <DatePicker
                  value={newPayment.due_date}
                  onChange={(d) => setNewPayment({ ...newPayment, due_date: d })}
                  placeholder="Pick a due date"
                />
              </div>
            </div>

            {/* Lead selector */}
            <div>
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">
                Lead (optional)
              </label>
              <div className="relative mb-2">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-tertiary)]" />
                <input
                  type="text"
                  value={leadSearch}
                  onChange={(e) => setLeadSearch(e.target.value)}
                  placeholder="Search leads by name, email, platform..."
                  className="w-full pl-9 pr-3 py-2.5 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-xl text-[var(--text-primary)] placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                />
              </div>
              <select
                value={selectedLeadId || ''}
                onChange={(e) => {
                  const leadId = e.target.value || null
                  setSelectedLeadId(leadId)
                  suggestInvoiceNumber(leadId, newPayment.is_invoice)
                }}
                className="w-full px-4 py-2.5 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-xl text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
              >
                <option value="">No lead linked</option>
                {filteredLeadOptions.map((lead) => {
                  const data = (lead.data || {}) as Record<string, string>
                  return (
                    <option key={lead.id} value={lead.id}>
                      {(data.name || 'Unnamed') +
                        (data.email ? ` - ${data.email}` : '')}
                    </option>
                  )
                })}
              </select>
            </div>

            {newPayment.is_invoice && (
              <div className="space-y-4 rounded-xl border border-[var(--border-primary)] p-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">
                      Bill to (name)
                    </label>
                    <input
                      type="text"
                      value={newPayment.bill_to_name}
                      onChange={(e) => setNewPayment({ ...newPayment, bill_to_name: e.target.value })}
                      placeholder="Client name"
                      className="w-full px-4 py-2.5 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-xl text-[var(--text-primary)] placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">
                      Bill to (email)
                    </label>
                    <input
                      type="email"
                      value={newPayment.bill_to_email}
                      onChange={(e) => setNewPayment({ ...newPayment, bill_to_email: e.target.value })}
                      placeholder="client@email.com"
                      className="w-full px-4 py-2.5 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-xl text-[var(--text-primary)] placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">
                    Issue date
                  </label>
                  <DatePicker
                    value={newPayment.issue_date}
                    onChange={(d) => setNewPayment({ ...newPayment, issue_date: d })}
                    placeholder="Pick an issue date"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">
                    Payment link (optional)
                  </label>
                  <input
                    type="url"
                    value={newPayment.payment_link}
                    onChange={(e) => setNewPayment({ ...newPayment, payment_link: e.target.value })}
                    placeholder="https://… (Stripe, PayPal, bank link)"
                    className="w-full px-4 py-2.5 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-xl text-[var(--text-primary)] placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                  />
                  <p className="text-xs text-[var(--text-tertiary)] mt-1">
                    The invoice page&apos;s &ldquo;Pay now&rdquo; button sends the client here.
                  </p>
                </div>

                {/* Line items */}
                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">
                    Line items (what it&apos;s for)
                  </label>
                  <div className="space-y-2">
                    {newPayment.line_items.map((li, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <input
                          type="text"
                          value={li.description}
                          onChange={(e) => setLineItem(i, { description: e.target.value })}
                          placeholder="Description"
                          className="flex-1 min-w-0 px-3 py-2 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg text-[var(--text-primary)] text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                        />
                        <input
                          type="number"
                          value={li.quantity}
                          onChange={(e) => setLineItem(i, { quantity: e.target.value })}
                          placeholder="Qty"
                          className="w-16 px-2 py-2 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg text-[var(--text-primary)] text-sm text-center focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                        />
                        <input
                          type="number"
                          value={li.unit_price}
                          onChange={(e) => setLineItem(i, { unit_price: e.target.value })}
                          placeholder="Price"
                          className="w-24 px-2 py-2 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg text-[var(--text-primary)] text-sm text-right focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                        />
                        {newPayment.line_items.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeLineItem(i)}
                            className="p-2 rounded-md text-[var(--text-tertiary)] hover:text-red-500 shrink-0"
                            aria-label="Remove item"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={addLineItem}
                    className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-[#2B79F7] hover:opacity-80"
                  >
                    <Plus className="h-4 w-4" /> Add item
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">
                      Tax (%)
                    </label>
                    <input
                      type="number"
                      value={newPayment.tax_rate}
                      onChange={(e) => setNewPayment({ ...newPayment, tax_rate: e.target.value })}
                      placeholder="0"
                      className="w-full px-4 py-2.5 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-xl text-[var(--text-primary)] placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">
                      Discount ({newPayment.currency})
                    </label>
                    <input
                      type="number"
                      value={newPayment.discount}
                      onChange={(e) => setNewPayment({ ...newPayment, discount: e.target.value })}
                      placeholder="0.00"
                      className="w-full px-4 py-2.5 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-xl text-[var(--text-primary)] placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                    />
                  </div>
                </div>

                {/* Totals */}
                <div className="rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)] px-4 py-3 text-sm space-y-1">
                  <div className="flex justify-between text-[var(--text-secondary)]">
                    <span>Subtotal</span>
                    <span>{newPayment.currency} {invoicePreview.subtotal.toFixed(2)}</span>
                  </div>
                  {invoicePreview.discountAmt > 0 && (
                    <div className="flex justify-between text-[var(--text-secondary)]">
                      <span>Discount</span>
                      <span>- {newPayment.currency} {invoicePreview.discountAmt.toFixed(2)}</span>
                    </div>
                  )}
                  {invoicePreview.taxAmt > 0 && (
                    <div className="flex justify-between text-[var(--text-secondary)]">
                      <span>Tax ({parseFloat(newPayment.tax_rate) || 0}%)</span>
                      <span>{newPayment.currency} {invoicePreview.taxAmt.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between pt-1.5 mt-1 border-t border-[var(--border-primary)] font-semibold text-[var(--text-primary)]">
                    <span>Total</span>
                    <span>{newPayment.currency} {invoicePreview.total.toFixed(2)}</span>
                  </div>
                </div>

                {/* Auto-send toggle */}
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-[var(--text-primary)]">
                      Auto-send on the due date
                    </p>
                    <p className="text-xs text-[var(--text-tertiary)]">
                      Off keeps it a draft you send yourself.
                    </p>
                  </div>
                  <Toggle
                    checked={newPayment.schedule_send}
                    onChange={(v) => setNewPayment({ ...newPayment, schedule_send: v })}
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">
                Invoice Number
              </label>
              <input
                type="text"
                value={newPayment.invoice_number}
                onChange={(e) =>
                  setNewPayment({
                    ...newPayment,
                    invoice_number: e.target.value,
                  })
                }
                placeholder="INV-001"
                className="w-full px-4 py-2.5 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-xl text-[var(--text-primary)] placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">
                Notes
              </label>
              <textarea
                value={newPayment.notes}
                onChange={(e) =>
                  setNewPayment({ ...newPayment, notes: e.target.value })
                }
                placeholder="Payment notes..."
                rows={3}
                className="w-full px-4 py-2.5 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-xl text-[var(--text-primary)] placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#2B79F7] resize-none"
              />
            </div>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={newPayment.reminder_enabled}
                onChange={(e) =>
                  setNewPayment({
                    ...newPayment,
                    reminder_enabled: e.target.checked,
                  })
                }
                className="w-5 h-5 rounded border-[var(--border-secondary)] bg-[var(--bg-secondary)] text-[#2B79F7] focus:ring-[#2B79F7]"
              />
              <span className="text-[var(--text-secondary)]">Enable payment reminders</span>
            </label>

            {/* Recurring Payment - hidden for invoices (not supported there). */}
            {!newPayment.is_invoice && (
            <div className="border-t border-[var(--border-primary)] pt-4 mt-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newPayment.is_recurring}
                  onChange={(e) =>
                    setNewPayment(prev => ({
                      ...prev,
                      is_recurring: e.target.checked,
                    }))
                  }
                  className="w-5 h-5 rounded border-[var(--border-secondary)] bg-[var(--bg-secondary)] text-[#2B79F7] focus:ring-[#2B79F7]"
                />
                <span className="text-[var(--text-primary)] text-sm">
                  Make this a recurring payment
                </span>
              </label>

              {newPayment.is_recurring && (
                <div className="mt-3 grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-[var(--text-tertiary)] mb-1">
                      Every
                    </label>
                    <input
                      type="number"
                      min={1}
                      value={newPayment.recurrence_interval}
                      onChange={(e) =>
                        setNewPayment(prev => ({
                          ...prev,
                          recurrence_interval: Number(e.target.value) || 1,
                        }))
                      }
                      className="w-full px-3 py-2 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-xl text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-[var(--text-tertiary)] mb-1">
                      Frequency
                    </label>
                    <select
                      value={newPayment.recurrence_type}
                      onChange={(e) =>
                        setNewPayment(prev => ({
                          ...prev,
                          recurrence_type: e.target.value as 'days' | 'weeks' | 'months',
                        }))
                      }
                      className="w-full px-3 py-2 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-xl text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                    >
                      <option value="days">Day(s)</option>
                      <option value="weeks">Week(s)</option>
                      <option value="months">Month(s)</option>
                    </select>
                  </div>
                </div>
              )}
            </div>
            )}
          </div>

          <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-[var(--border-primary)]">
            <Button
              onClick={handleAddPayment}
              isLoading={isSavingPayment}
              disabled={newPayment.is_invoice ? !invoicePreview.total : !newPayment.amount}
            >
              {editId ? 'Save changes' : newPayment.is_invoice ? 'Create invoice' : 'Add Payment'}
            </Button>
          </div>
        </Modal>
      )}

      <ConfirmModal
        open={!!pendingDeleteId}
        title="Delete payment record?"
        message="This permanently removes the payment from your records."
        confirmLabel="Delete"
        tone="danger"
        onConfirm={async () => {
          if (!pendingDeleteId) return
          await handleDeletePayment(pendingDeleteId)
          setPendingDeleteId(null)
        }}
        onClose={() => setPendingDeleteId(null)}
      />
    </div>
  )
}

// Modal Component - bigger, centered, clean overlay
function Modal(props: { children: React.ReactNode; onClose: () => void; title: string }) {
  const { children, onClose, title } = props

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,0,0.6)]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl glass-pop rounded-2xl shadow-2xl flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-primary)]">
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">{title}</h3>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)] transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content - scrollable if needed */}
        <div className="px-6 py-4 overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  )
}

function RevenueKpi({
  icon: Icon,
  iconBg,
  iconColor,
  label,
  value,
  valueColor,
  // When set, the puck renders this currency code's symbol (e.g. '₦',
  // '€', '$') instead of the static lucide icon. Used by money KPIs so
  // the symbol stays in sync with the active display currency.
  symbolCurrency,
}: {
  icon?: React.ComponentType<{ className?: string }>
  iconBg: string
  iconColor: string
  label: string
  value: string
  valueColor?: string
  symbolCurrency?: string
}) {
  const symbol = symbolCurrency ? getCurrencySymbol(symbolCurrency) : null
  return (
    <div className="glass-card rounded-2xl p-3 sm:p-4">
      <div className="flex items-center gap-2 mb-1.5 sm:mb-2">
        <div
          className={`p-1.5 sm:p-2 ${iconBg} rounded-lg flex items-center justify-center min-w-[28px] sm:min-w-[32px]`}
        >
          {symbol ? (
            <span
              className={`text-[11px] sm:text-xs font-bold tabular-nums leading-none ${iconColor}`}
            >
              {symbol}
            </span>
          ) : Icon ? (
            <Icon className={`h-3.5 w-3.5 sm:h-4 sm:w-4 ${iconColor}`} />
          ) : null}
        </div>
        <span className="text-[var(--text-tertiary)] text-[11px] sm:text-xs uppercase tracking-wider font-semibold truncate">
          {label}
        </span>
      </div>
      <p className={`text-lg sm:text-2xl font-bold tabular-nums truncate ${valueColor || 'text-[var(--text-primary)]'}`}>
        {value}
      </p>
    </div>
  )
}