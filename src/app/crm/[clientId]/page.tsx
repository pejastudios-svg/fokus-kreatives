import { redirect } from 'next/navigation'

export default function CRMPage({ params }: { params: { clientid: string } }) {
  redirect(`/crm/${params.clientid}/dashboard`)
}