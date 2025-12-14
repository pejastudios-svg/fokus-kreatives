'use client'

import { useState, useEffect } from 'react'
import { PortalLayout } from '@/components/portal/PortalLayout'
import { Card, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { createClient } from '@/lib/supabase/client'

const statusColors: Record<string, string> = {
  new: 'bg-blue-100 text-blue-700',
  contacted: 'bg-yellow-100 text-yellow-700',
  booked: 'bg-purple-100 text-purple-700',
  showed: 'bg-indigo-100 text-indigo-700',
  closed: 'bg-green-100 text-green-700',
  lost: 'bg-red-100 text-red-700',
}

export default function PortalLeads() {
  const [leads, setLeads] = useState<any[]>([])
  const [view, setView] = useState<'table' | 'pipeline'>('pipeline')
  const supabase = createClient()

  useEffect(() => {
    loadLeads()
  }, [])

  const loadLeads = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data: userData } = await supabase
      .from('users')
      .select('client_id')
      .eq('id', user.id)
      .single()

    if (!userData?.client_id) return

    const { data } = await supabase
      .from('leads')
      .select('*')
      .eq('client_id', userData.client_id)
      .order('created_at', { ascending: false })

    setLeads(data || [])
  }

  const stages = ['new', 'contacted', 'booked', 'showed', 'closed', 'lost']

  return (
    <PortalLayout>
      <div className="p-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Leads</h1>
            <p className="text-gray-500 mt-1">{leads.length} total leads</p>
          </div>
          <div className="flex gap-2">
            <Button
              variant={view === 'pipeline' ? 'primary' : 'outline'}
              size="sm"
              onClick={() => setView('pipeline')}
            >
              Pipeline
            </Button>
            <Button
              variant={view === 'table' ? 'primary' : 'outline'}
              size="sm"
              onClick={() => setView('table')}
            >
              Table
            </Button>
          </div>
        </div>

        {view === 'pipeline' ? (
          <div className="flex gap-4 overflow-x-auto pb-4">
            {stages.map((stage) => (
              <div key={stage} className="min-w-[250px] flex-shrink-0">
                <div className="bg-gray-100 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold text-gray-900 capitalize">{stage}</h3>
                    <span className="text-sm text-gray-500">
                      {leads.filter(l => l.status === stage).length}
                    </span>
                  </div>
                  <div className="space-y-3">
                    {leads.filter(l => l.status === stage).map((lead) => (
                      <Card key={lead.id}>
                        <CardContent className="p-4">
                          <p className="font-medium text-gray-900">{lead.name || 'Unknown'}</p>
                          <p className="text-sm text-gray-500">{lead.email || lead.platform}</p>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="p-0">
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left px-6 py-4 text-sm font-medium text-gray-500">Name</th>
                    <th className="text-left px-6 py-4 text-sm font-medium text-gray-500">Email</th>
                    <th className="text-left px-6 py-4 text-sm font-medium text-gray-500">Status</th>
                    <th className="text-left px-6 py-4 text-sm font-medium text-gray-500">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {leads.map((lead) => (
                    <tr key={lead.id}>
                      <td className="px-6 py-4 font-medium">{lead.name || 'Unknown'}</td>
                      <td className="px-6 py-4 text-gray-500">{lead.email || '-'}</td>
                      <td className="px-6 py-4">
                        <span className={`px-2 py-1 rounded-full text-xs ${statusColors[lead.status] || 'bg-gray-100'}`}>
                          {lead.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-gray-500">
                        {new Date(lead.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </div>
    </PortalLayout>
  )
}