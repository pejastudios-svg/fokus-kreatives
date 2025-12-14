'use client'

import { useState, useEffect } from 'react'
import { PortalLayout } from '@/components/portal/PortalLayout'
import { Card, CardContent } from '@/components/ui/Card'
import { Zap, MessageCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

export default function PortalAutomations() {
  const [automations, setAutomations] = useState<any[]>([])
  const supabase = createClient()

  useEffect(() => {
    loadAutomations()
  }, [])

  const loadAutomations = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data: userData } = await supabase
      .from('users')
      .select('client_id')
      .eq('id', user.id)
      .single()

    if (!userData?.client_id) return

    const { data } = await supabase
      .from('automations')
      .select('*')
      .eq('client_id', userData.client_id)

    setAutomations(data || [])
  }

  return (
    <PortalLayout>
      <div className="p-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Automations</h1>
          <p className="text-gray-500 mt-1">Your active message templates</p>
        </div>

        {automations.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Zap className="h-12 w-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500">No automations set up yet</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {automations.map((a) => (
              <Card key={a.id}>
                <CardContent className="p-6">
                  <div className="flex items-start gap-4">
                    <div className={`p-3 rounded-lg ${a.active ? 'bg-green-100' : 'bg-gray-100'}`}>
                      <Zap className={`h-6 w-6 ${a.active ? 'text-green-600' : 'text-gray-400'}`} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="px-3 py-1 bg-[#E8F1FF] text-[#2B79F7] rounded-full text-sm font-medium">
                          {a.keyword}
                        </span>
                        <span className={`text-xs ${a.active ? 'text-green-600' : 'text-gray-400'}`}>
                          {a.active ? 'Active' : 'Paused'}
                        </span>
                      </div>
                      <p className="text-gray-600 text-sm">{a.response_content}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </PortalLayout>
  )
}