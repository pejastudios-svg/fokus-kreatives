import { redirect } from 'next/navigation'

export default function CRMPage({ params }: { params: { clientId: string } }) {
  redirect(`/crm/${params.clientId}/dashboard`)
}