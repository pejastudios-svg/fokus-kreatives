'use client'

import { useState, useEffect } from 'react'
import { PortalLayout } from '@/components/portal/PortalLayout'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Users, DollarSign, FileText, TrendingUp, ArrowUpRight, ArrowDownRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

export default function PortalDashboard() {
  const [stats, setStats] = useState({
    totalLeads: 0,
    totalRevenue: 0,
    totalContent: 0,
    conversionRate: 0,
  })
  const supabase = createClient()

  useEffect(() => {
    // Fetch stats - for now using placeholder data
    setStats({
      totalLeads: 47,
      totalRevenue: 12500,
      totalContent: 24,
      conversionRate: 8.5,
    })
  }, [])

  const statCards = [
    { 
      title: 'Total Leads', 
      value: stats.totalLeads, 
      icon: Users, 
      change: '+12%',
      positive: true,
      color: 'bg-blue-500'
    },
    { 
      title: 'Total Revenue', 
      value: `$${stats.totalRevenue.toLocaleString()}`, 
      icon: DollarSign, 
      change: '+23%',
      positive: true,
      color: 'bg-green-500'
    },
    { 
      title: 'Content Pieces', 
      value: stats.totalContent, 
      icon: FileText, 
      change: '+8',
      positive: true,
      color: 'bg-purple-500'
    },
    { 
      title: 'Conversion Rate', 
      value: `${stats.conversionRate}%`, 
      icon: TrendingUp, 
      change: '+2.1%',
      positive: true,
      color: 'bg-orange-500'
    },
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
                  <div className={`flex items-center gap-1 text-sm ${stat.positive ? 'text-green-600' : 'text-red-600'}`}>
                    {stat.positive ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
                    {stat.change}
                  </div>
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
              <div className="space-y-4">
                {[
                  { name: 'Sarah Johnson', source: 'Instagram Reel', time: '2 hours ago' },
                  { name: 'Mike Peters', source: 'Carousel Post', time: '5 hours ago' },
                  { name: 'Emily Davis', source: 'DM Automation', time: '1 day ago' },
                ].map((lead, i) => (
                  <div key={i} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-full bg-brand-gradient flex items-center justify-center text-white font-medium">
                        {lead.name.charAt(0)}
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">{lead.name}</p>
                        <p className="text-sm text-gray-500">{lead.source}</p>
                      </div>
                    </div>
                    <span className="text-sm text-gray-400">{lead.time}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <h3 className="text-lg font-semibold text-gray-900">Recent Content</h3>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {[
                  { title: '5 Mistakes Killing Your Business', type: 'Short-form', views: '12.4K' },
                  { title: 'How I Built a 6-Figure Business', type: 'Long-form', views: '8.2K' },
                  { title: 'Morning Routine for Success', type: 'Carousel', views: '5.1K' },
                ].map((content, i) => (
                  <div key={i} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                    <div>
                      <p className="font-medium text-gray-900">{content.title}</p>
                      <p className="text-sm text-gray-500">{content.type}</p>
                    </div>
                    <span className="text-sm font-medium text-[#2B79F7]">{content.views} views</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </PortalLayout>
  )
}