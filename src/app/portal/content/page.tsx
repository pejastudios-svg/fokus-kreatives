'use client'

import { useState, useEffect } from 'react'
import { PortalLayout } from '@/components/portal/PortalLayout'
import { Card, CardContent } from '@/components/ui/Card'
import { FileText, Film, LayoutGrid } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

export default function PortalContent() {
  const [content, setContent] = useState<any[]>([])
  const supabase = createClient()

  useEffect(() => {
    loadContent()
  }, [])

  const loadContent = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data: userData } = await supabase
      .from('users')
      .select('client_id')
      .eq('id', user.id)
      .single()

    if (!userData?.client_id) return

    const { data } = await supabase
      .from('content')
      .select('*')
      .eq('client_id', userData.client_id)
      .order('created_at', { ascending: false })

    setContent(data || [])
  }

  const getIcon = (type: string) => {
    if (type?.includes('long')) return FileText
    if (type?.includes('short')) return Film
    return LayoutGrid
  }

  return (
    <PortalLayout>
      <div className="p-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Content</h1>
          <p className="text-gray-500 mt-1">{content.length} pieces created</p>
        </div>

        {content.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <FileText className="h-12 w-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500">No content created yet</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {content.map((item) => {
              const Icon = getIcon(item.content_type)
              return (
                <Card key={item.id} hover>
                  <CardContent className="p-6">
                    <div className="flex items-start gap-4">
                      <div className="p-3 rounded-lg bg-[#E8F1FF]">
                        <Icon className="h-6 w-6 text-[#2B79F7]" />
                      </div>
                      <div className="flex-1">
                        <p className="font-medium text-gray-900">{item.content_type || 'Content'}</p>
                        <p className="text-sm text-gray-500">{item.content_pillar}</p>
                        <p className="text-xs text-gray-400 mt-2">
                          {new Date(item.created_at).toLocaleDateString()}
                        </p>
                      </div>
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