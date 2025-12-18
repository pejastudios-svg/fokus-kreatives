'use client'

import { useEffect, useState } from 'react'
import { PortalLayout } from '@/components/portal/PortalLayout'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { createClient } from '@/lib/supabase/client'
import { CheckCircle, Clock } from 'lucide-react'
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
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    init()
  }, [])

  const init = async () => {
    setIsLoading(true)
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        setIsLoading(false)
        return
      }

      const { data: userRow } = await supabase
        .from('users')
        .select('client_id')
        .eq('id', user.id)
        .single()

      if (!userRow?.client_id) {
        setIsLoading(false)
        return
      }

      const { data, error } = await supabase
        .from('approvals')
        .select('id, title, status, created_at')
        .eq('client_id', userRow.client_id)
        .order('created_at', { ascending: false })

      if (error) {
        console.error('Portal approvals load error:', error)
      } else {
        setApprovals(data || [])
      }
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <PortalLayout>
      <div className="p-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Approvals</h1>
          <p className="text-gray-500 mt-1">
            Review and approve your content assets
          </p>
        </div>

        {isLoading ? (
          <Card>
            <CardContent className="py-10 text-center text-gray-500">
              Loading approvals...
            </CardContent>
          </Card>
        ) : approvals.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-gray-500">
              No approvals yet.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {approvals.map((a) => {
              const createdDate = new Date(a.created_at).toLocaleDateString()
              const isApproved = a.status === 'approved'
              return (
                <Card
  key={a.id}
  className="cursor-pointer hover:shadow-md"
>
  <CardContent
    className="p-4 flex items-center justify-between"
    onClick={() => router.push(`/portal/approvals/${a.id}`)}
  >
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-[#E8F1FF]">
                        {isApproved ? (
                          <CheckCircle className="h-5 w-5 text-green-500" />
                        ) : (
                          <Clock className="h-5 w-5 text-[#2B79F7]" />
                        )}
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold text-gray-900">
                          {a.title}
                        </h3>
                        <p className="text-xs text-gray-500 mt-0.5">
                          Created {createdDate}
                        </p>
                      </div>
                    </div>
                    <span
                      className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                        isApproved
                          ? 'bg-green-100 text-green-700'
                          : 'bg-yellow-100 text-yellow-700'
                      }`}
                    >
                      {isApproved ? '✅ APPROVED' : '⏳ WAITING FOR FEEDBACK'}
                    </span>
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