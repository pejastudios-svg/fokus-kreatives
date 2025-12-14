'use client'

import { useState, useEffect } from 'react'
import { PortalLayout } from '@/components/portal/PortalLayout'
import { Card, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { createClient } from '@/lib/supabase/client'

interface Lead {
  id: string
  name: string
  email: string
  phone: string
  platform: string
  status: 'new' | 'contacted' | 'booked' | 'showed' | 'closed' | 'lost'
  created_at: string
}

const statusColors: Record<string, string> = {
  new: 'bg-blue-100 text-blue-700',
  contacted: 'bg-yellow-100 text-yellow-700',
  booked: 'bg-purple-100 text-purple-700',
  showed: 'bg-indigo-100 text-indigo-700',
  closed: 'bg-green-100 text-green-700',
  lost: 'bg-red-100 text-red-700',
}

const statusLabels: Record<string, string> = {
  new: 'New',
  contacted: 'Contacted',
  booked: 'Call Booked',
  showed: 'Showed Up',
  closed: 'Closed',
  lost: 'Lost',
}

export default function PortalLeads() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [view, setView] = useState<'table' | 'pipeline'>('pipeline')
  const supabase = createClient()

  useEffect(() => {
    // Placeholder data
    setLeads([
      { id: '1', name: 'Sarah Johnson', email: 'sarah@example.com', phone: '+1 234 567 890', platform: 'Instagram', status: 'new', created_at: new Date().toISOString() },
      { id: '2', name: 'Mike Peters', email: 'mike@example.com', phone: '+1 234 567 891', platform: 'TikTok', status: 'contacted', created_at: new Date().toISOString() },
      { id: '3', name: 'Emily Davis', email: 'emily@example.com', phone: '+1 234 567 892', platform: 'Instagram', status: 'booked', created_at: new Date().toISOString() },
      { id: '4', name: 'John Smith', email: 'john@example.com', phone: '+1 234 567 893', platform: 'LinkedIn', status: 'closed', created_at: new Date().toISOString() },
    ])
    setIsLoading(false)
  }, [])

  const updateLeadStatus = (leadId: string, newStatus: Lead['status']) => {
    setLeads(leads.map(lead => 
      lead.id === leadId ? { ...lead, status: newStatus } : lead
    ))
  }

  const pipelineStages = ['new', 'contacted', 'booked', 'showed', 'closed', 'lost']

  return (
    <PortalLayout>
      <div className="p-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Leads</h1>
            <p className="text-gray-500 mt-1">Track and manage your leads</p>
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
            {pipelineStages.map((stage) => (
              <div key={stage} className="min-w-[280px] flex-shrink-0">
                <div className="bg-gray-100 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold text-gray-900">{statusLabels[stage]}</h3>
                    <span className="text-sm text-gray-500">
                      {leads.filter(l => l.status === stage).length}
                    </span>
                  </div>
                  <div className="space-y-3">
                    {leads
                      .filter(lead => lead.status === stage)
                      .map((lead) => (
                        <Card key={lead.id} className="cursor-pointer hover:shadow-md transition-shadow">
                          <CardContent className="p-4">
                            <div className="flex items-center gap-3 mb-2">
                              <div className="h-8 w-8 rounded-full bg-brand-gradient flex items-center justify-center text-white text-sm font-medium">
                                {lead.name.charAt(0)}
                              </div>
                              <div>
                                <p className="font-medium text-gray-900 text-sm">{lead.name}</p>
                                <p className="text-xs text-gray-500">{lead.platform}</p>
                              </div>
                            </div>
                            <p className="text-xs text-gray-500">{lead.email}</p>
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
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="text-left px-6 py-4 text-sm font-medium text-gray-500">Name</th>
                    <th className="text-left px-6 py-4 text-sm font-medium text-gray-500">Email</th>
                    <th className="text-left px-6 py-4 text-sm font-medium text-gray-500">Platform</th>
                    <th className="text-left px-6 py-4 text-sm font-medium text-gray-500">Status</th>
                    <th className="text-left px-6 py-4 text-sm font-medium text-gray-500">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {leads.map((lead) => (
                    <tr key={lead.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 font-medium text-gray-900">{lead.name}</td>
                      <td className="px-6 py-4 text-gray-500">{lead.email}</td>
                      <td className="px-6 py-4 text-gray-500">{lead.platform}</td>
                      <td className="px-6 py-4">
                        <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${statusColors[lead.status]}`}>
                          {statusLabels[lead.status]}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
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