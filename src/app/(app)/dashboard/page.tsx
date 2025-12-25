import { Header } from '@/components/layout/Header'
import { ContentCreationEngine } from '@/components/dashboard/ContentCreationEngine'

export default function DashboardPage() {
  return (
    <>
    <Header 
        title="Content Creation Engine" 
        subtitle="Generate high-converting content for your clients"
      />
      <div className="p-8">
        <ContentCreationEngine />
      </div></>
  )
}