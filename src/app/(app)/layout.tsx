import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { SWRProvider } from '@/components/providers/SWRProvider'
import { DragAutoScroll } from '@/components/providers/DragAutoScroll'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SWRProvider>
      <DragAutoScroll />
      <DashboardLayout>{children}</DashboardLayout>
    </SWRProvider>
  )
}