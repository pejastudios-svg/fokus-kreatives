'use client'

import { Card, CardContent } from '@/components/ui/Card'

export default function CRMInboxPage() {
  return <div className="p-6 lg:p-8 min-h-full">
        <Card>
          <CardContent className="py-12 text-center text-gray-400">
            <p className="text-sm">
              The inbox feature is currently disabled in this version.
            </p>
            <p className="text-xs text-gray-500 mt-2">
              We&apos;re focusing on leads, revenue, meetings, capture pages and email notifications.
            </p>
          </CardContent>
        </Card>
      </div>
}