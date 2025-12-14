'use client'

import { Sidebar } from './Sidebar'
import { AuthGuard } from '@/components/auth/AuthGuard'

interface DashboardLayoutProps {
  children: React.ReactNode
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  return (
    <AuthGuard>
      <div className="flex h-screen bg-gray-50">
        <Sidebar />
        <main className="flex-1 overflow-auto bg-gray-100">
          <div className="page-enter">
            {children}
          </div>
        </main>
      </div>
    </AuthGuard>
  )
}