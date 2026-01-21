'use client'

import { useEffect, useState } from 'react'
import { PortalLayout } from '@/components/portal/PortalLayout'
import { Card, CardContent } from '@/components/ui/Card'
import { createClient } from '@/lib/supabase/client'
import { CheckCircle, Clock } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useRouter } from 'next/navigation'

interface Approval {
  id: string
  title: string
  status: string
  created_at: string
}

export default function PortalApprovalsPage() {
  const supabase = createClient()
  const router = useRouter()

  const [approvals, setApprovals] = useState<Approval[]>([])
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [clientId, setClientId] = useState<string | null>(null)
  useEffect(() => {
  if (!clientId) return

  let t: ReturnType<typeof setTimeout> | null = null
  const reload = () => {
    if (t) clearTimeout(t)
    t = setTimeout(() => {
      loadApprovals(clientId)
    }, 250)
  }

  const channel = supabase
    .channel(`portal-approvals-list-${clientId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'approvals', filter: `client_id=eq.${clientId}` },
      () => reload()
    )
    .subscribe()

  return () => {
    if (t) clearTimeout(t)
    supabase.removeChannel(channel)
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [clientId])

  const [approvingId, setApprovingId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadApprovals = async (cid: string) => {
    const { data, error } = await supabase
      .from('approvals')
      .select('id, title, status, created_at')
      .eq('client_id', cid)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Portal approvals load error:', error)
      return
    }
    setApprovals(data || [])
  }

  const init = async () => {
    setIsLoading(true)
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) return

      setCurrentUserId(user.id)

      const { data: userRow, error: userRowErr } = await supabase
        .from('users')
        .select('client_id')
        .eq('id', user.id)
        .single()

      if (userRowErr) {
        console.error('Portal user row load error:', userRowErr)
        return
      }

      if (!userRow?.client_id) return

      setClientId(userRow.client_id)
      await loadApprovals(userRow.client_id)
    } finally {
      setIsLoading(false)
    }
  }

  const handleToggleApprove = async (approvalId: string, approved: boolean) => {
    if (!currentUserId) return

    // optimistic
    setApprovals((prev) =>
      prev.map((a) =>
        a.id === approvalId ? { ...a, status: approved ? 'approved' : 'pending' } : a
      )
    )

    setApprovingId(approvalId)
    try {
      const res = await fetch('/api/approvals/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approvalId,
          actorId: currentUserId,
          approved,
        }),
      })

      const data = await res.json()
      if (!data.success) {
        alert(data.error || 'Failed to update approval')
        if (clientId) await loadApprovals(clientId)
        return
      }

      if (clientId) await loadApprovals(clientId)
    } catch (err) {
      console.error('Portal toggle approve error:', err)
      alert('Failed to update approval')
      if (clientId) await loadApprovals(clientId)
    } finally {
      setApprovingId(null)
    }
  }

  return (
    <PortalLayout>
      <div className="p-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Approvals</h1>
          <p className="text-gray-500 mt-1">Review and approve your content assets</p>
        </div>

        {isLoading ? (
          <Card>
            <CardContent className="py-10 text-center text-gray-500">Loading approvals...</CardContent>
          </Card>
        ) : approvals.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-gray-500">No approvals yet.</CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {approvals.map((a) => {
              const createdDate = new Date(a.created_at).toLocaleDateString()
              const isApproved = a.status === 'approved'

              return (
                <Card key={a.id}>
                  <CardContent className="p-4 flex items-center justify-between gap-4">
                    <div
                      className="flex items-center gap-3 cursor-pointer flex-1"
                      onClick={() => router.push(`/portal/approvals/${a.id}`)}
                    >
                      <div className="p-2 rounded-lg bg-[#E8F1FF]">
                        {isApproved ? (
                          <CheckCircle className="h-5 w-5 text-green-500" />
                        ) : (
                          <Clock className="h-5 w-5 text-[#2B79F7]" />
                        )}
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold text-gray-900">{a.title}</h3>
                        <p className="text-xs text-gray-500 mt-0.5">Created {createdDate}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                          isApproved ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                        }`}
                      >
                        {isApproved ? '✅ APPROVED' : '⏳ WAITING FOR FEEDBACK'}
                      </span>

                      <Button variant="outline" size="sm" onClick={() => router.push(`/portal/approvals/${a.id}`)}>
                        Open
                      </Button>

                      <Button
                        size="sm"
                        onClick={() => handleToggleApprove(a.id, !isApproved)}
                        isLoading={approvingId === a.id}
                        className="bg-[#2B79F7] hover:bg-[#1E54B7] shadow-premium text-white"
                      >
                        {isApproved ? 'Un-approve' : 'Approve'}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </div>
    </PortalLayout>
  )
}