'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { Loading } from '@/components/ui/Loading'
import { 
  Users, 
  DollarSign, 
  Calendar, 
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  CheckCircle,
  XCircle,
  Activity,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

interface DashboardStats {
  totalLeads: number
  newLeadsThisWeek: number
  leadsChange: number
  totalRevenue: number
  revenueThisMonth: number
  revenueChange: number
  upcomingMeetings: number
  pendingPayments: number
  closedDeals: number
  lostDeals: number
}

interface RecentLead {
  id: string
  data: Record<string, unknown>
  created_at: string
}

interface UpcomingMeeting {
  id: string
  title: string
  date_time: string
  duration_minutes: number
}

// Removed unused RecentPayment interface

export default function CRMDashboard() {
  const params = useParams()
  const clientId = (params?.clientId || params?.clientid) as string
  const supabase = createClient()

  const [isLoading, setIsLoading] = useState(true)
  const [stats, setStats] = useState<DashboardStats>({
    totalLeads: 0,
    newLeadsThisWeek: 0,
    leadsChange: 0,
    totalRevenue: 0,
    revenueThisMonth: 0,
    revenueChange: 12,
    upcomingMeetings: 0,
    pendingPayments: 0,
    closedDeals: 0,
    lostDeals: 0,
  })
  const [recentLeads, setRecentLeads] = useState<RecentLead[]>([])
  const [upcomingMeetings, setUpcomingMeetings] = useState<UpcomingMeeting[]>([])
  const [leadsByStatus, setLeadsByStatus] = useState<{ status: string; count: number; color: string }[]>([])

  useEffect(() => {
    if (!clientId) return

    const loadDashboardData = async () => {
      setIsLoading(true)

      try {
        // Load leads
        const { data: leads } = await supabase
          .from('leads')
          .select('*')
          .eq('client_id', clientId)
          .order('created_at', { ascending: false })

        // Load payments
        const { data: payments } = await supabase
          .from('payments')
          .select('*')
          .eq('client_id', clientId)
          .order('created_at', { ascending: false })

        // Load meetings
        const { data: meetings } = await supabase
          .from('meetings')
          .select('*')
          .eq('client_id', clientId)
          .gte('date_time', new Date().toISOString())
          .order('date_time', { ascending: true })
          .limit(5)

        // Load custom fields for status colors
        const { data: customFields } = await supabase
          .from('custom_fields')
          .select('*')
          .eq('client_id', clientId)
          .eq('field_type', 'status')
          .single()

        // Calculate stats
        const now = new Date()
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

        const allLeads = (leads || []) as RecentLead[]
        const newLeadsThisWeek = allLeads.filter(l => new Date(l.created_at) > weekAgo).length
        const closedDeals = allLeads.filter(l => (l.data?.status as string) === 'closed').length
        const lostDeals = allLeads.filter(l => (l.data?.status as string) === 'lost').length

        const allPayments = payments || []
        const paidPayments = allPayments.filter(p => p.status === 'paid')
        const totalRevenue = paidPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0)
        const revenueThisMonth = paidPayments
          .filter(p => new Date(p.created_at) >= monthStart)
          .reduce((sum, p) => sum + Number(p.amount || 0), 0)
        const pendingPayments = allPayments.filter(p => p.status === 'pending' || p.status === 'overdue').length

        // Calculate leads by status
        const defaultOptions = [
          { value: 'new', label: 'New', color: '#3B82F6' },
          { value: 'contacted', label: 'Contacted', color: '#F59E0B' },
          { value: 'qualified', label: 'Qualified', color: '#8B5CF6' },
          { value: 'proposal', label: 'Proposal', color: '#EC4899' },
          { value: 'closed', label: 'Closed', color: '#10B981' },
          { value: 'lost', label: 'Lost', color: '#EF4444' },
        ]

        const statusOptions = (customFields?.options || defaultOptions) as { value: string; label: string; color: string }[]

        const leadsByStatusData = statusOptions.map((status) => ({
          status: status.label,
          count: allLeads.filter(l => (l.data?.status as string) === status.value).length,
          color: status.color,
        }))

        setStats({
          totalLeads: allLeads.length,
          newLeadsThisWeek,
          leadsChange: newLeadsThisWeek > 0 ? Math.round((newLeadsThisWeek / Math.max(allLeads.length - newLeadsThisWeek, 1)) * 100) : 0,
          totalRevenue,
          revenueThisMonth,
          revenueChange: 12, // Placeholder
          upcomingMeetings: meetings?.length || 0,
          pendingPayments,
          closedDeals,
          lostDeals,
        })

        setRecentLeads(allLeads.slice(0, 5))
        setUpcomingMeetings((meetings || []) as UpcomingMeeting[])
        setLeadsByStatus(leadsByStatusData)

      } catch (err) {
        console.error('Failed to load dashboard:', err)
      } finally {
        setIsLoading(false)
      }
    }

    loadDashboardData()
  }, [clientId, supabase])

  if (isLoading) {
    return <div className="flex items-center justify-center h-full">
          <Loading size="lg" text="Loading dashboard..." />
        </div>
  }

  const statCards = [
    {
      title: 'Total Leads',
      value: stats.totalLeads,
      change: stats.leadsChange,
      changeLabel: `+${stats.newLeadsThisWeek} this week`,
      icon: Users,
      color: 'from-blue-500 to-blue-600',
      iconBg: 'bg-blue-500',
    },
    {
      title: 'Total Revenue',
      value: `$${stats.totalRevenue.toLocaleString()}`,
      change: stats.revenueChange,
      changeLabel: `$${stats.revenueThisMonth.toLocaleString()} this month`,
      icon: DollarSign,
      color: 'from-green-500 to-green-600',
      iconBg: 'bg-green-500',
    },
    {
      title: 'Upcoming Meetings',
      value: stats.upcomingMeetings,
      change: 0,
      changeLabel: 'scheduled',
      icon: Calendar,
      color: 'from-purple-500 to-purple-600',
      iconBg: 'bg-purple-500',
    },
    {
      title: 'Pending Payments',
      value: stats.pendingPayments,
      change: 0,
      changeLabel: 'awaiting payment',
      icon: Clock,
      color: 'from-orange-500 to-orange-600',
      iconBg: 'bg-orange-500',
    },
  ]

  return <div className="p-6 lg:p-8 min-h-full">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-gray-400 mt-1">Overview of your CRM performance</p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {statCards.map((stat, index) => (
            <div 
              key={index}
              className="bg-[#1E293B] rounded-2xl border border-[#334155] p-6 hover:shadow-xl transition-all"
            >
              <div className="flex items-start justify-between mb-4">
                <div className={`p-3 rounded-xl ${stat.iconBg}`}>
                  <stat.icon className="h-6 w-6 text-white" />
                </div>
                {stat.change !== 0 && (
                  <div className={`flex items-center gap-1 text-sm ${stat.change > 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {stat.change > 0 ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
                    {Math.abs(stat.change)}%
                  </div>
                )}
              </div>
              <h3 className="text-3xl font-bold text-white mb-1">{stat.value}</h3>
              <p className="text-sm text-gray-400">{stat.title}</p>
              <p className="text-xs text-gray-500 mt-1">{stat.changeLabel}</p>
            </div>
          ))}
        </div>

        {/* Charts & Activity */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          {/* Leads by Status Chart */}
          <div className="lg:col-span-2 bg-[#1E293B] rounded-2xl border border-[#334155] p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-white">Leads by Status</h3>
              <Link 
                href={`/crm/${clientId}/leads`}
                className="text-sm text-[#2B79F7] hover:underline"
              >
                View all
              </Link>
            </div>
            <div className="space-y-4">
              {leadsByStatus.map((item) => {
                const maxCount = Math.max(...leadsByStatus.map(l => l.count), 1)
                const percentage = (item.count / maxCount) * 100
                return (
                  <div key={item.status} className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <div 
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: item.color }}
                        />
                        <span className="text-white">{item.status}</span>
                      </div>
                      <span className="text-gray-400 font-medium">{item.count}</span>
                    </div>
                    <div className="h-2 bg-[#0F172A] rounded-full overflow-hidden">
                      <div 
                        className="h-full rounded-full transition-all duration-700"
                        style={{ width: `${percentage}%`, backgroundColor: item.color }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Quick Stats */}
          <div className="bg-[#1E293B] rounded-2xl border border-[#334155] p-6">
            <h3 className="text-lg font-semibold text-white mb-6">Performance</h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-[#0F172A] rounded-xl border border-[#334155]">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-green-500/20 rounded-lg">
                    <CheckCircle className="h-5 w-5 text-green-400" />
                  </div>
                  <span className="text-gray-300">Closed Deals</span>
                </div>
                <span className="text-2xl font-bold text-green-400">{stats.closedDeals}</span>
              </div>
              <div className="flex items-center justify-between p-4 bg-[#0F172A] rounded-xl border border-[#334155]">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-red-500/20 rounded-lg">
                    <XCircle className="h-5 w-5 text-red-400" />
                  </div>
                  <span className="text-gray-300">Lost Deals</span>
                </div>
                <span className="text-2xl font-bold text-red-400">{stats.lostDeals}</span>
              </div>
              <div className="flex items-center justify-between p-4 bg-[#0F172A] rounded-xl border border-[#334155]">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-500/20 rounded-lg">
                    <Activity className="h-5 w-5 text-blue-400" />
                  </div>
                  <span className="text-gray-300">Conversion Rate</span>
                </div>
                <span className="text-2xl font-bold text-blue-400">
                  {stats.totalLeads > 0 
                    ? `${Math.round((stats.closedDeals / stats.totalLeads) * 100)}%`
                    : '0%'
                  }
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Recent Activity */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Recent Leads */}
          <div className="bg-[#1E293B] rounded-2xl border border-[#334155] overflow-hidden">
            <div className="flex items-center justify-between p-6 border-b border-[#334155]">
              <h3 className="text-lg font-semibold text-white">Recent Leads</h3>
              <Link 
                href={`/crm/${clientId}/leads`}
                className="text-sm text-[#2B79F7] hover:underline"
              >
                View all
              </Link>
            </div>
            <div className="divide-y divide-[#334155]">
              {recentLeads.length === 0 ? (
                <div className="p-8 text-center">
                  <Users className="h-10 w-10 text-gray-600 mx-auto mb-3" />
                  <p className="text-gray-400">No leads yet</p>
                </div>
              ) : (
                recentLeads.map((lead) => (
                  <div key={lead.id} className="flex items-center justify-between p-4 hover:bg-[#334155]/30 transition-colors">
                    <div className="flex items-center gap-3">
                      {/* Fixed: bg-gradient-to-br -> bg-linear-to-br */}
                      <div className="h-10 w-10 rounded-full bg-linear-to-br from-[#2B79F7] to-[#1E54B7] flex items-center justify-center text-white font-medium">
                        {((lead.data?.name as string) || 'L').charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-medium text-white">{(lead.data?.name as string) || 'Unknown'}</p>
                        <p className="text-sm text-gray-400">{(lead.data?.email as string) || 'No email'}</p>
                      </div>
                    </div>
                    <span className="text-xs text-gray-500">
                      {new Date(lead.created_at).toLocaleDateString()}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Upcoming Meetings */}
          <div className="bg-[#1E293B] rounded-2xl border border-[#334155] overflow-hidden">
            <div className="flex items-center justify-between p-6 border-b border-[#334155]">
              <h3 className="text-lg font-semibold text-white">Upcoming Meetings</h3>
              <Link 
                href={`/crm/${clientId}/meetings`}
                className="text-sm text-[#2B79F7] hover:underline"
              >
                View all
              </Link>
            </div>
            <div className="divide-y divide-[#334155]">
              {upcomingMeetings.length === 0 ? (
                <div className="p-8 text-center">
                  <Calendar className="h-10 w-10 text-gray-600 mx-auto mb-3" />
                  <p className="text-gray-400">No upcoming meetings</p>
                </div>
              ) : (
                upcomingMeetings.map((meeting) => (
                  <div key={meeting.id} className="flex items-center justify-between p-4 hover:bg-[#334155]/30 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-purple-500/20 rounded-lg">
                        <Calendar className="h-5 w-5 text-purple-400" />
                      </div>
                      <div>
                        <p className="font-medium text-white">{meeting.title}</p>
                        <p className="text-sm text-gray-400">
                          {new Date(meeting.date_time).toLocaleDateString()} at {new Date(meeting.date_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    </div>
                    <span className="text-sm text-purple-400">{meeting.duration_minutes} min</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
}