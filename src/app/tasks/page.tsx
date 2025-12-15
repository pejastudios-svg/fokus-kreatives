'use client'

import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { Header } from '@/components/layout/Header'
import { Card, CardContent } from '@/components/ui/Card'

export default function TasksPage() {
  return (
    <DashboardLayout>
      <Header
        title="Tasks"
        subtitle="The task system is currently disabled."
      />
      <div className="p-8">
        <Card>
          <CardContent className="py-12 text-center text-gray-500">
            We&apos;re focusing on clients, leads, revenue, meetings, capture pages and email notifications for now.
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  )
}