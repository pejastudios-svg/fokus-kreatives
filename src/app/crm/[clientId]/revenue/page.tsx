'use client'

import { useState, useEffect, useMemo } from 'react'
import { useParams } from 'next/navigation'
import { CRMLayout } from '@/components/crm/CRMLayout'
import { Button } from '@/components/ui/Button'
import { Loading } from '@/components/ui/Loading'
import {
  Plus,
  DollarSign,
  TrendingUp,
  AlertCircle,
  CheckCircle,
  Clock,
  X,
  Trash2,
  Bell,
  BellOff,
  Search,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

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
    data: Record<string, any>
  }
  is_recurring?: boolean
  recurrence_type?: 'days' | 'weeks' | 'months' | null
  recurrence_interval?: number | null
  recurring_count?: number
}

interface LeadOption {
  id: string
  data: Record<string, any>
}

const statusConfig = {
  pending: { label: 'Pending', color: '#F59E0B', bg: 'bg-yellow-500/20', icon: Clock },
  paid: { label: 'Paid', color: '#10B981', bg: 'bg-green-500/20', icon: CheckCircle },
  overdue: { label: 'Overdue', color: '#EF4444', bg: 'bg-red-500/20', icon: AlertCircle },
  cancelled: { label: 'Cancelled', color: '#64748B', bg: 'bg-gray-500/20', icon: X },
}

export default function CRMRevenue() {
  const params = useParams()
  const clientId = params.clientId as string
  const supabase = createClient()

  const [isLoading, setIsLoading] = useState(true)
  const [payments, setPayments] = useState<Payment[]>([])
  const [showAddModal, setShowAddModal] = useState(false)
  const [isSavingPayment, setIsSavingPayment] = useState(false)
  const [filter, setFilter] = useState<'all' | 'pending' | 'paid' | 'overdue'>('all')
  const [nextPayment, setNextPayment] = useState<Payment | null>(null)

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

  const [newPayment, setNewPayment] = useState({
    amount: '',
    currency: 'USD',
    status: 'pending' as const,
    due_date: '',
    notes: '',
    invoice_number: '',
    reminder_enabled: true,
    is_recurring: false,
    recurrence_type: 'months' as 'days' | 'weeks' | 'months',
    recurrence_interval: 1,
  })

  useEffect(() => {
    if (clientId) {
      loadPayments()
      loadLeads()
    }
  }, [clientId])

  const loadPayments = async () => {
    setIsLoading(true)
    const { data } = await supabase
      .from('payments')
      .select(`*, lead:leads(data)`)
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })

    const now = new Date()
    const processed: Payment[] = (data || []).map((p: any) => {
      if (p.status === 'pending' && p.due_date && new Date(p.due_date) < now) {
        return { ...p, status: 'overdue' as const }
      }
      return p
    })

    setPayments(processed)

    // Compute next upcoming payment: pending + future due_date
    const upcoming = processed
      .filter(p => p.status === 'pending' && p.due_date && new Date(p.due_date) >= now)
      .sort(
        (a, b) =>
          new Date(a.due_date as string).getTime() -
          new Date(b.due_date as string).getTime()
      )

    setNextPayment(upcoming[0] || null)
    setIsLoading(false)
  }

  const loadLeads = async () => {
    const { data } = await supabase
      .from('leads')
      .select('id, data')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })

    setLeads((data || []) as LeadOption[])
  }

  const filteredLeadOptions = useMemo(() => {
    const q = leadSearch.toLowerCase()
    return leads.filter((lead) => {
      const name = (lead.data?.name || '').toLowerCase()
      const email = (lead.data?.email || '').toLowerCase()
      const platform = (lead.data?.platform || '').toLowerCase()
      return (
        !q ||
        name.includes(q) ||
        email.includes(q) ||
        platform.includes(q)
      )
    })
  }, [leads, leadSearch])

    const handleAddPayment = async () => {
    if (!newPayment.amount) return

    const { data, error } = await supabase
      .from('payments')
      .insert({
        client_id: clientId,
        lead_id: selectedLeadId || null,
        amount: parseFloat(newPayment.amount),
        currency: newPayment.currency,
        status: newPayment.status,
        due_date: newPayment.due_date || null,
        notes: newPayment.notes || null,
        invoice_number: newPayment.invoice_number || null,
        reminder_enabled: newPayment.reminder_enabled,
        is_recurring: newPayment.is_recurring,
        recurrence_type: newPayment.is_recurring ? newPayment.recurrence_type : null,
        recurrence_interval: newPayment.is_recurring ? newPayment.recurrence_interval : null,
        recurring_count: 0,
      })
      .select()
      .single()

    if (error) {
      console.error('Failed to add payment:', error)
      return
    }

    if (data) {
      // Update local state
      setPayments(prev => [data as Payment, ...prev])
      setShowAddModal(false)
      setNewPayment({
        amount: '',
        currency: 'USD',
        status: 'pending',
        due_date: '',
        notes: '',
        invoice_number: '',
        reminder_enabled: true,
        is_recurring: false,
        recurrence_type: 'months',
        recurrence_interval: 1,
      })
      setSelectedLeadId(null)
      setLeadSearch('')

      // Fire-and-forget email notification
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
                clientName: '', // optional: wire client name later
              },
            }),
          })
        }
      } catch (err) {
        console.error('Failed to send payment_created email', err)
      }
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

    // Optimistic update
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

    // If paid & recurring, create next payment
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
          })
          .select()
          .single()

        if (!nextError && nextData) {
          setPayments(prevPayments => [nextData as Payment, ...prevPayments])
        }
      }
    }

    // Recompute nextPayment from updated list
    const now = new Date()
    const processed = updated.map(p => {
      if (p.status === 'pending' && p.due_date && new Date(p.due_date) < now) {
        return { ...p, status: 'overdue' as const }
      }
      return p
    })
    const upcoming = processed
      .filter(p => p.status === 'pending' && p.due_date && new Date(p.due_date) >= now)
      .sort(
        (a, b) =>
          new Date(a.due_date as string).getTime() -
          new Date(b.due_date as string).getTime()
      )
    setNextPayment(upcoming[0] || null)
  }

  const handleToggleReminder = async (paymentId: string) => {
    const previous = payments
    const payment = payments.find(p => p.id === paymentId)
    if (!payment) return

    const newValue = !payment.reminder_enabled

    // Optimistic
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
    const confirmed = window.confirm('Delete this payment record?')
    if (!confirmed) return

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
    }
  }

  const filteredPayments = payments.filter(p => {
    if (filter === 'all') return true
    return p.status === filter
  })

  const stats = {
    total: payments
      .filter(p => p.status === 'paid')
      .reduce((sum, p) => sum + p.amount, 0),
    pending: payments
      .filter(p => p.status === 'pending')
      .reduce((sum, p) => sum + p.amount, 0),
    overdue: payments
      .filter(p => p.status === 'overdue')
      .reduce((sum, p) => sum + p.amount, 0),
    thisMonth: payments
      .filter(
        p =>
          p.status === 'paid' &&
          p.paid_date &&
          new Date(p.paid_date).getMonth() === new Date().getMonth()
      )
      .reduce((sum, p) => sum + p.amount, 0),
  }

  if (isLoading) {
    return (
      <CRMLayout>
        <div className="flex items-center justify-center h-full">
          <Loading size="lg" text="Loading revenue..." />
        </div>
      </CRMLayout>
    )
  }

  return (
    <CRMLayout>
      <div className="p-6 lg:p-8 min-h-full">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">Revenue</h1>
            <p className="text-gray-400 mt-1">Track payments and invoices</p>
          </div>
          <Button onClick={() => setShowAddModal(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Payment
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          {nextPayment && (
            <div className="bg-[#1E293B] rounded-2xl border border-[#334155] p-6">
              <h3 className="text-lg font-semibold text-white mb-2">Next Payment</h3>
              <p className="text-2xl font-bold text-white">
                ${nextPayment.amount.toLocaleString()}{' '}
                <span className="text-sm text-gray-400">{nextPayment.currency}</span>
              </p>
              <p className="text-gray-400 mt-1">
                Due on {new Date(nextPayment.due_date as string).toLocaleDateString()}
              </p>
              {nextPayment.notes && (
                <p className="text-gray-500 text-sm mt-2">{nextPayment.notes}</p>
              )}
            </div>
          )}

          <div className="bg-[#1E293B] rounded-2xl border border-[#334155] p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 bg-green-500/20 rounded-lg">
                <DollarSign className="h-5 w-5 text-green-400" />
              </div>
              <span className="text-gray-400 text-sm">Total Revenue</span>
            </div>
            <p className="text-3xl font-bold text-white">
              ${stats.total.toLocaleString()}
            </p>
          </div>

          <div className="bg-[#1E293B] rounded-2xl border border-[#334155] p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 bg-blue-500/20 rounded-lg">
                <TrendingUp className="h-5 w-5 text-blue-400" />
              </div>
              <span className="text-gray-400 text-sm">This Month</span>
            </div>
            <p className="text-3xl font-bold text-white">
              ${stats.thisMonth.toLocaleString()}
            </p>
          </div>

          <div className="bg-[#1E293B] rounded-2xl border border-[#334155] p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 bg-yellow-500/20 rounded-lg">
                <Clock className="h-5 w-5 text-yellow-400" />
              </div>
              <span className="text-gray-400 text-sm">Pending</span>
            </div>
            <p className="text-3xl font-bold text-yellow-400">
              ${stats.pending.toLocaleString()}
            </p>
          </div>

          <div className="bg-[#1E293B] rounded-2xl border border-[#334155] p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 bg-red-500/20 rounded-lg">
                <AlertCircle className="h-5 w-5 text-red-400" />
              </div>
              <span className="text-gray-400 text-sm">Overdue</span>
            </div>
            <p className="text-3xl font-bold text-red-400">
              ${stats.overdue.toLocaleString()}
            </p>
          </div>
        </div>

        {/* Filter */}
        <div className="flex gap-2 mb-6">
          {(['all', 'pending', 'paid', 'overdue'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                filter === f
                  ? 'bg-[#2B79F7] text-white'
                  : 'bg-[#1E293B] text-gray-400 hover:text-white border border-[#334155]'
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>

        {/* Payments Table */}
        <div className="bg-[#1E293B] rounded-2xl border border-[#334155] overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#334155] bg-[#0F172A]">
                <th className="text-left px-6 py-4 text-xs font-semibold text-gray-400 uppercase">
                  Amount
                </th>
                <th className="text-left px-6 py-4 text-xs font-semibold text-gray-400 uppercase">
                  Lead
                </th>
                <th className="text-left px-6 py-4 text-xs font-semibold text-gray-400 uppercase">
                  Status
                </th>
                <th className="text-left px-6 py-4 text-xs font-semibold text-gray-400 uppercase">
                  Due Date
                </th>
                <th className="text-left px-6 py-4 text-xs font-semibold text-gray-400 uppercase">
                  Invoice
                </th>
                <th className="text-left px-6 py-4 text-xs font-semibold text-gray-400 uppercase">
                  Notes
                </th>
                <th className="text-left px-6 py-4 text-xs font-semibold text-gray-400 uppercase">
                  Reminder
                </th>
                <th className="w-20" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[#334155]">
              {filteredPayments.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center">
                    <DollarSign className="h-10 w-10 text-gray-600 mx-auto mb-3" />
                    <p className="text-gray-400">No payments found</p>
                  </td>
                </tr>
              ) : (
                filteredPayments.map((payment) => {
  const config = statusConfig[payment.status]
  const isTemp = payment.id.startsWith('temp-')

  return (
    <tr
      key={payment.id}
      className={`hover:bg-[#334155]/30 transition-colors group ${
        isTemp ? 'opacity-60 pointer-events-none' : ''
      }`}
    >
                      <td className="px-6 py-4">
                        <span className="text-xl font-bold text-white">
                          ${payment.amount.toLocaleString()}
                        </span>
                        <span className="text-gray-500 text-sm ml-1">
                          {payment.currency}
                        </span>
                      </td>

                      <td className="px-6 py-4 text-gray-300">
                        {payment.lead?.data?.name || '—'}
                        {payment.lead?.data?.email && (
                          <div className="text-xs text-gray-500">
                            {payment.lead.data.email}
                          </div>
                        )}
                      </td>

                      <td className="px-6 py-4">
                        <select
                          value={payment.status}
                          onChange={(e) =>
                            handleUpdateStatus(
                              payment.id,
                              e.target.value as Payment['status']
                            )
                          }
                          className={`${config.bg} text-sm font-medium px-3 py-1.5 rounded-full border-0 focus:outline-none focus:ring-2 focus:ring-[#2B79F7]`}
                          style={{ color: config.color }}
                        >
                          <option value="pending">Pending</option>
                          <option value="paid">Paid</option>
                          <option value="overdue">Overdue</option>
                          <option value="cancelled">Cancelled</option>
                        </select>
                      </td>

                      <td className="px-6 py-4 text-gray-300">
                        {payment.due_date
                          ? new Date(payment.due_date).toLocaleDateString()
                          : '—'}
                      </td>

                      <td className="px-6 py-4 text-gray-400">
                        {payment.invoice_number || '—'}
                      </td>

                      <td className="px-6 py-4 text-gray-400 max-w-xs truncate">
                        {payment.notes || '—'}
                      </td>

                      <td className="px-6 py-4">
                        <button
                          onClick={() => handleToggleReminder(payment.id)}
                          className={`p-2 rounded-lg transition-colors ${
                            payment.reminder_enabled
                              ? 'bg-[#2B79F7]/20 text-[#2B79F7]'
                              : 'bg-gray-700 text-gray-400'
                          }`}
                        >
                          {payment.reminder_enabled ? (
                            <Bell className="h-4 w-4" />
                          ) : (
                            <BellOff className="h-4 w-4" />
                          )}
                        </button>
                      </td>

                      <td className="px-6 py-4">
                        <button
                          onClick={() => handleDeletePayment(payment.id)}
                          className="p-2 hover:bg-red-500/20 rounded-lg text-gray-400 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Add Payment Modal */}
        {showAddModal && (
          <Modal onClose={() => setShowAddModal(false)} title="Add Payment">
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">
                    Amount
                  </label>
                  <input
                    type="number"
                    value={newPayment.amount}
                    onChange={(e) =>
                      setNewPayment({ ...newPayment, amount: e.target.value })
                    }
                    placeholder="0.00"
                    className="w-full px-4 py-2.5 bg-[#0F172A] border border-[#334155] rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">
                    Currency
                  </label>
                  <select
                    value={newPayment.currency}
                    onChange={(e) =>
                      setNewPayment({ ...newPayment, currency: e.target.value })
                    }
                    className="w-full px-4 py-2.5 bg-[#0F172A] border border-[#334155] rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                  >
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                    <option value="GBP">GBP</option>
                    <option value="NGN">NGN</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">
                    Status
                  </label>
                  <select
                    value={newPayment.status}
                    onChange={(e) =>
                      setNewPayment({
                        ...newPayment,
                        status: e.target.value as any,
                      })
                    }
                    className="w-full px-4 py-2.5 bg-[#0F172A] border border-[#334155] rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                  >
                    <option value="pending">Pending</option>
                    <option value="paid">Paid</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">
                    Due Date
                  </label>
                  <input
                    type="date"
                    value={newPayment.due_date}
                    onChange={(e) =>
                      setNewPayment({ ...newPayment, due_date: e.target.value })
                    }
                    className="w-full px-4 py-2.5 bg-[#0F172A] border border-[#334155] rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                  />
                </div>
              </div>

              {/* Lead selector */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">
                  Lead (optional)
                </label>
                <div className="relative mb-2">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
                  <input
                    type="text"
                    value={leadSearch}
                    onChange={(e) => setLeadSearch(e.target.value)}
                    placeholder="Search leads by name, email, platform..."
                    className="w-full pl-9 pr-3 py-2.5 bg-[#0F172A] border border-[#334155] rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                  />
                </div>
                <select
                  value={selectedLeadId || ''}
                  onChange={(e) =>
                    setSelectedLeadId(e.target.value || null)
                  }
                  className="w-full px-4 py-2.5 bg-[#0F172A] border border-[#334155] rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                >
                  <option value="">No lead linked</option>
                  {filteredLeadOptions.map((lead) => (
                    <option key={lead.id} value={lead.id}>
                      {(lead.data?.name || 'Unnamed') +
                        (lead.data?.email ? ` — ${lead.data.email}` : '')}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">
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
                  className="w-full px-4 py-2.5 bg-[#0F172A] border border-[#334155] rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">
                  Notes
                </label>
                <textarea
                  value={newPayment.notes}
                  onChange={(e) =>
                    setNewPayment({ ...newPayment, notes: e.target.value })
                  }
                  placeholder="Payment notes..."
                  rows={3}
                  className="w-full px-4 py-2.5 bg-[#0F172A] border border-[#334155] rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#2B79F7] resize-none"
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
                  className="w-5 h-5 rounded border-gray-600 bg-[#0F172A] text-[#2B79F7] focus:ring-[#2B79F7]"
                />
                <span className="text-gray-300">Enable payment reminders</span>
              </label>

              {/* Recurring Payment */}
              <div className="border-t border-[#334155] pt-4 mt-4">
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
                    className="w-5 h-5 rounded border-gray-600 bg-[#0F172A] text-[#2B79F7] focus:ring-[#2B79F7]"
                  />
                  <span className="text-gray-200 text-sm">
                    Make this a recurring payment
                  </span>
                </label>

                {newPayment.is_recurring && (
                  <div className="mt-3 grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1">
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
                        className="w-full px-3 py-2 bg-[#0F172A] border border-[#334155] rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-gray-400 mb-1">
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
                        className="w-full px-3 py-2 bg-[#0F172A] border border-[#334155] rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#2B79F7]"
                      >
                        <option value="days">Day(s)</option>
                        <option value="weeks">Week(s)</option>
                        <option value="months">Month(s)</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-[#334155]">
              <Button
  onClick={handleAddPayment}
  isLoading={isSavingPayment}
>
  Add Payment
</Button>
            </div>
          </Modal>
        )}
      </div>
    </CRMLayout>
  )
}

// Modal Component – bigger, centered, clean overlay
function Modal(props: { children: React.ReactNode; onClose: () => void; title: string }) {
  const { children, onClose, title } = props

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,0,0.6)]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-[#1E293B] rounded-2xl border border-[#334155] shadow-2xl flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#334155]">
          <h3 className="text-lg font-semibold text-white">{title}</h3>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-[#334155] transition-colors"
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