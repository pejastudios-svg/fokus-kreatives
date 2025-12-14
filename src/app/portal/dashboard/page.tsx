'use client'

import { useState, useEffect } from 'react'
import { PortalLayout } from '@/components/portal/PortalLayout'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Users, DollarSign, FileText, TrendingUp, ArrowUpRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

export default function PortalDashboard() {
  const [stats, setStats] = useState({
    totalLeads: 0,
    totalRevenue: 0,
    totalContent: 0,
    conversionRate: 0,
  })
  const [recentLeads, setRecentLeads] = useState<any[]>([])
  const [recentContent, setRecentContent] = useState<any[]>([])
  const supabase = createClient()

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data: userData } = await supabase
      .from('users')
      .select('client_id')
      .eq('id', user.id)
      .single()

    if (!userData?.client_id) return

    // Load leads
    const { data: leads } = await supabase
      .from('leads')
      .select('*')
      .eq('client_id', userData.client_id)
      .order('created_at', { ascending: false })
      .limit(5)

    // Load revenue
    const { data: revenue } = await supabase
      .from('revenue')
      .select('amount')
      .eq('client_id', userData.client_id)

    // Load content
    const { data: content } = await supabase
      .from('content')
      .select('*')
      .eq('client_id', userData.client_id)
      .order('created_at', { ascending: false })
      .limit(5)

    const totalRevenue = revenue?.reduce((sum, r) => sum + Number(r.amount), 0) || 0
    const totalLeads = leads?.length || 0

    setStats({
      totalLeads,
      totalRevenue,
      totalContent: content?.length || 0,
      conversionRate: totalLeads > 0 ? ((revenue?.length || 0) / totalLeads * 100) : 0,
    })

    setRecentLeads(leads || [])
    setRecentContent(content || [])
  }

  const statCards = [
    { title: 'Total Leads', value: stats.totalLeads, icon: Users, color: 'bg-blue-500' },
    { title: 'Total Revenue', value: `$${stats.totalRevenue.toLocaleString()}`, icon: DollarSign, color: 'bg-green-500' },
    { title: 'Content Pieces', value: stats.totalContent, icon: FileText, color: 'bg-purple-500' },
    { title: 'Conversion Rate', value: `${stats.conversionRate.toFixed(1)}%`, icon: TrendingUp, color: 'bg-orange-500' },
  ]

  return (
    <PortalLayout>
      <div className="p-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Welcome to Your Portal</h1>
          <p className="text-gray-500 mt-1">Track your leads, revenue, and content performance</p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {statCards.map((stat, index) => (
            <Card key={index}>
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className={`p-3 rounded-lg ${stat.color}`}>
                    <stat.icon className="h-6 w-6 text-white" />
                  </div>
                  <ArrowUpRight className="h-4 w-4 text-green-500" />
                </div>
                <h3 className="text-2xl font-bold text-gray-900">{stat.value}</h3>
                <p className="text-sm text-gray-500">{stat.title}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Recent Activity */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <h3 className="text-lg font-semibold text-gray-900">Recent Leads</h3>
            </CardHeader>
            <CardContent>
              {recentLeads.length === 0 ? (
                <p className="text-gray-500 text-center py-8">No leads yet</p>
              ) : (
                <div className="space-y-4">
                  {recentLeads.map((lead, i) => (
                    <div key={i} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-brand-gradient flex items-center justify-center text-white font-medium">
                          {(lead.name || 'L').charAt(0)}
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">{lead.name || 'Unknown'}</p>
                          <p className="text-sm text-gray-500">{lead.platform || 'Unknown source'}</p>
                        </div>
                      </div>
                      <span className="text-sm text-gray-400">
                        {new Date(lead.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <h3 className="text-lg font-semibold text-gray-900">Recent Content</h3>
            </CardHeader>
            <CardContent>
              {recentContent.length === 0 ? (
                <p className="text-gray-500 text-center py-8">No content yet</p>
              ) : (
                <div className="space-y-4">
                  {recentContent.map((item, i) => (
                    <div key={i} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                      <div>
                        <p className="font-medium text-gray-900">{item.content_type || 'Content'}</p>
                        <p className="text-sm text-gray-500">{item.content_pillar || 'General'}</p>
                      </div>
                      <span className="text-sm text-gray-400">
                        {new Date(item.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </PortalLayout>
  )
}