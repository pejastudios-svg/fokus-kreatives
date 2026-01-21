import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { updateClickUpStatus } from '@/app/api/clickup/helpers'

// Types for Supabase responses
interface ClientRef {
  name: string | null
  business_name: string | null
}

interface AssigneeRow {
  user_id: string
}

interface UserRow {
  id: string
  email: string | null
  role: string
}

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const secret = url.searchParams.get('secret')
    const envSecret = process.env.CRON_SECRET

    if (envSecret && secret !== envSecret) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const nowIso = new Date().toISOString()

    const { data: approvals, error } = await supabase
      .from('approvals')
      .select('id, clickup_task_id, title, client_id, clients(name, business_name)')
      .eq('status', 'pending')
      .not('auto_approve_at', 'is', null)
      .lte('auto_approve_at', nowIso)

    if (error) {
      console.error('[auto-approve] select error', error)
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    let processed = 0

    for (const a of approvals || []) {
      const approvalId = a.id as string

      await supabase
        .from('approval_items')
        .update({ status: 'approved', updated_at: nowIso })
        .eq('approval_id', approvalId)

      await supabase
        .from('approvals')
        .update({ status: 'approved', updated_at: nowIso })
        .eq('id', approvalId)

      if (a.clickup_task_id) {
        await updateClickUpStatus(a.clickup_task_id as string, 'approved')
      }

      // notify assignees
      const { data: assignees } = await supabase
        .from('approval_assignees')
        .select('user_id')
        .eq('approval_id', approvalId)

      const userIds = Array.from(new Set((assignees || []).map((r: AssigneeRow) => r.user_id).filter(Boolean)))

      // Cast 'a' to a shape with clients
      const approvalWithClients = a as unknown as { clients: ClientRef | ClientRef[] | null }
      const relClients = approvalWithClients.clients
      
      let clientName = 'Client'
      if (Array.isArray(relClients) && relClients.length > 0) {
        clientName = relClients[0]?.business_name || relClients[0]?.name || 'Client'
      } else if (relClients && !Array.isArray(relClients)) {
        const singleClient = relClients as ClientRef
        clientName = singleClient.business_name || singleClient.name || 'Client'
      }

      if (userIds.length > 0) {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin
        const secret2 = process.env.APPS_SCRIPT_SECRET

        await fetch(`${appUrl}/api/notifications/create`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userIds,
            type: 'approval_approved',
            data: { approvalId, title: a.title, clientName },
          }),
        })

        if (secret2) {
          const { data: users } = await supabase
            .from('users')
            .select('id, email, role')
            .in('id', userIds)

          const clientEmails = (users || []).filter((u: UserRow) => u.role === 'client').map((u: UserRow) => u.email).filter(Boolean)
          const teamEmails = (users || []).filter((u: UserRow) => u.role !== 'client').map((u: UserRow) => u.email).filter(Boolean)

          const portalUrl = `${appUrl}/portal/approvals/${approvalId}`
          const agencyUrl = `${appUrl}/approvals/${approvalId}`

          if (clientEmails.length) {
            await fetch(`${appUrl}/api/notify-email`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                type: 'approval_approved',
                payload: {
                  secret: secret2,
                  to: clientEmails,
                  clientName,
                  approvalTitle: a.title,
                  approvalId,
                  url: portalUrl,
                },
              }),
            })
          }

          if (teamEmails.length) {
            await fetch(`${appUrl}/api/notify-email`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                type: 'approval_approved',
                payload: {
                  secret: secret2,
                  to: teamEmails,
                  clientName,
                  approvalTitle: a.title,
                  approvalId,
                  url: agencyUrl,
                },
              }),
            })
          }
        }
      }

      processed++
    }

    return NextResponse.json({ success: true, processed })
  } catch (err: unknown) {
    console.error('[auto-approve] error', err)
    const errorMessage = err instanceof Error ? err.message : 'Server error'
    return NextResponse.json({ success: false, error: errorMessage }, { status: 500 })
  }
}