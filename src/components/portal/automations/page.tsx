'use client'

import { PortalLayout } from '@/components/portal/PortalLayout'
import { Card, CardContent } from '@/components/ui/Card'
import { Zap, MessageCircle, Mail } from 'lucide-react'

export default function PortalAutomations() {
  const automations = [
    { keyword: 'GUIDE', response: 'Hey! Here is your free guide...', active: true, leads: 47 },
    { keyword: 'TIPS', response: 'Thanks for your interest! Check your DMs...', active: true, leads: 23 },
    { keyword: 'HELP', response: 'I would love to help! Here is how...', active: false, leads: 12 },
  ]

  return (
    <PortalLayout>
      <div className="p-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Automations</h1>
          <p className="text-gray-500 mt-1">View your active DM automations</p>
        </div>

        <div className="space-y-4">
          {automations.map((automation, index) => (
            <Card key={index}>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={`p-3 rounded-lg ${automation.active ? 'bg-green-100' : 'bg-gray-100'}`}>
                      <Zap className={`h-6 w-6 ${automation.active ? 'text-green-600' : 'text-gray-400'}`} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-gray-900">Keyword:</span>
                        <span className="px-3 py-1 bg-[#E8F1FF] text-[#2B79F7] rounded-full text-sm font-medium">
                          {automation.keyword}
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-xs ${
                          automation.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                        }`}>
                          {automation.active ? 'Active' : 'Paused'}
                        </span>
                      </div>
                      <p className="text-sm text-gray-500">{automation.response}</p>
                      <div className="flex items-center gap-4 mt-2">
                        <span className="flex items-center gap-1 text-xs text-gray-500">
                          <MessageCircle className="h-3 w-3" />
                          {automation.leads} leads captured
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="mt-8">
          <CardContent className="p-6">
            <div className="text-center">
              <Mail className="h-12 w-12 text-gray-300 mx-auto mb-4" />
              <h3 className="font-semibold text-gray-900 mb-2">Need more automations?</h3>
              <p className="text-gray-500">Contact your account manager to set up new keyword triggers.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </PortalLayout>
  )
}