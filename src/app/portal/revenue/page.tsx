'use client'

import { useState, useEffect } from 'react'
import { PortalLayout } from '@/components/portal/PortalLayout'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Plus, DollarSign, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

export default function PortalRevenue() {
  const [revenues, setRevenues] = useState<any[]>([])
  const [showModal, setShowModal] = useState(false)
  const [clientId, setClientId] = useState<string | null>(null)
  const [newRevenue, setNewRevenue] = useState({ amount: '', notes: '' })
  const supabase = createClient()

  useEffect(() => {
    loadRevenue()
  }, [])

  const loadRevenue = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data: userData } = await supabase
      .from('users')
      .select('client_id')
      .eq('id', user.id)
      .single()

    if (!userData?.client_id) return
    setClientId(userData.client_id)

    const { data } = await supabase
      .from('revenue')
      .select('*')
      .eq('client_id', userData.client_id)
      .order('date_closed', { ascending: false })

    setRevenues(data || [])
  }

  const handleAdd = async () => {
    if (!clientId || !newRevenue.amount) return

    await supabase.from('revenue').insert({
      client_id: clientId,
      amount: parseFloat(newRevenue.amount),
      notes: newRevenue.notes,
      date_closed: new Date().toISOString().split('T')[0],
    })

    setShowModal(false)
    setNewRevenue({ amount: '', notes: '' })
    loadRevenue()
  }

  const total = revenues.reduce((sum, r) => sum + Number(r.amount), 0)

  return (
    <PortalLayout>
      <div className="p-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Revenue</h1>
            <p className="text-gray-500 mt-1">Track revenue from your content</p>
          </div>
          <Button onClick={() => setShowModal(true)}>
            <Plus className="h-5 w-5 mr-2" />
            Add Revenue
          </Button>
        </div>

        <Card className="mb-6">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-lg bg-green-100">
                <DollarSign className="h-6 w-6 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Total Revenue</p>
                <p className="text-3xl font-bold text-gray-900">${total.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h3 className="text-lg font-semibold">Revenue History</h3>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left px-6 py-4 text-sm font-medium text-gray-500">Amount</th>
                  <th className="text-left px-6 py-4 text-sm font-medium text-gray-500">Notes</th>
                  <th className="text-left px-6 py-4 text-sm font-medium text-gray-500">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {revenues.map((rev) => (
                  <tr key={rev.id}>
                    <td className="px-6 py-4 font-semibold text-green-600">${Number(rev.amount).toLocaleString()}</td>
                    <td className="px-6 py-4 text-gray-500">{rev.notes || '-'}</td>
                    <td className="px-6 py-4 text-gray-500">{rev.date_closed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {showModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <Card className="w-full max-w-md">
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-lg font-semibold">Add Revenue</h3>
                  <button onClick={() => setShowModal(false)}>
                    <X className="h-5 w-5 text-gray-400" />
                  </button>
                </div>
                <div className="space-y-4">
                  <Input
                    label="Amount ($)"
                    type="number"
                    value={newRevenue.amount}
                    onChange={(e) => setNewRevenue({ ...newRevenue, amount: e.target.value })}
                    placeholder="5000"
                  />
                  <Input
                    label="Notes"
                    value={newRevenue.notes}
                    onChange={(e) => setNewRevenue({ ...newRevenue, notes: e.target.value })}
                    placeholder="Client package, coaching, etc."
                  />
                </div>
                <div className="flex justify-end gap-3 mt-6">
                  <Button variant="outline" onClick={() => setShowModal(false)}>Cancel</Button>
                  <Button onClick={handleAdd}>Add Revenue</Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </PortalLayout>
  )
}