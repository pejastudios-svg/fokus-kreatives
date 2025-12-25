'use client'

import { Sidebar } from './Sidebar'
import { NotificationPopupListener } from '@/components/notifications/NotificationPopupListener'
import { PageTransition } from '@/components/ui/PageTransition'
import { AuthGuard } from '@/components/auth/AuthGuard'

interface DashboardLayoutProps {
  children: React.ReactNode
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  return (
    <AuthGuard>
  <div className="flex h-screen bg-gray-50">
  <div className="hidden md:block">
    <Sidebar />
  </div>

  <main className="flex-1 overflow-auto bg-gray-100">
    <PageTransition>{children}</PageTransition>
  </main>

    <NotificationPopupListener />
  </div>
</AuthGuard>
  )
}