// Shared formatting + routing helpers for notifications. Used by the
// Header bell dropdown and the dedicated Inbox page so both surface
// the same human-readable text + click destination per notification
// type.

export interface NotificationRow {
  id: string
  type: string
  data: Record<string, unknown>
  read_at: string | null
  created_at: string
}

function get(data: Record<string, unknown>, key: string): string | undefined {
  const v = data[key]
  return typeof v === 'string' ? v : undefined
}

export function formatNotificationText(n: NotificationRow): string {
  const data = n.data || {}
  switch (n.type) {
    case 'task_created':
      return `Task created: ${get(data, 'title') || ''}`
    case 'task_status_changed':
      return `Task "${get(data, 'title') || ''}" moved to ${get(data, 'status') || ''}`
    case 'task_mentioned':
      return 'You were mentioned in a task'
    case 'approval_created':
      return `Approval created for ${get(data, 'clientName') || 'client'}: ${get(data, 'title') || ''}`
    case 'approval_approved':
      return `Approval approved for ${get(data, 'clientName') || 'client'}: ${get(data, 'title') || ''}`
    case 'approval_comment': {
      const who = get(data, 'clientName') || 'client'
      const where = get(data, 'title') ? ` on "${get(data, 'title')}"` : ''
      const snippet = get(data, 'contentSnippet') ? `: ${get(data, 'contentSnippet')}` : ''
      return `New comment from ${who}${where}${snippet}`
    }
    case 'approval_mention': {
      const where = get(data, 'title') ? ` on "${get(data, 'title')}"` : ''
      const snippet = get(data, 'contentSnippet') ? `: ${get(data, 'contentSnippet')}` : ''
      return `You were mentioned${where}${snippet}`
    }
    case 'approval_reminder':
      return `Approval reminder: ${get(data, 'title') || ''}`
    case 'approval_comment_resolved': {
      const title = get(data, 'approvalTitle') || 'an approval'
      const snippet = get(data, 'contentSnippet') ? `: ${get(data, 'contentSnippet')}` : ''
      return `A comment on "${title}" was resolved${snippet}`
    }
    case 'brand_intake_submitted':
      return `${get(data, 'clientName') || 'A client'} submitted their brand intake`
    case 'question_form_submitted': {
      const countRaw = data.count
      const count = typeof countRaw === 'number' ? countRaw : 0
      const name = get(data, 'clientName') || 'A client'
      return count
        ? `${name} answered ${count} braindump question${count === 1 ? '' : 's'}`
        : `${name} submitted a braindump`
    }
    case 'series_form_submitted': {
      const countRaw = data.count
      const count = typeof countRaw === 'number' ? countRaw : 0
      const name = get(data, 'clientName') || 'A client'
      const seriesTitle = get(data, 'seriesTitle') || 'a series'
      return count
        ? `${name} filled out ${count} answer${count === 1 ? '' : 's'} for "${seriesTitle}"`
        : `${name} submitted "${seriesTitle}"`
    }
    case 'lead_created':
      return `New lead: ${get(data, 'leadName') || 'Unknown'} (${get(data, 'source') || 'manual'})`
    case 'capture_submission':
      return `New submission on ${get(data, 'pageName') || 'capture page'}`
    case 'meeting_created':
      return `Meeting booked: ${get(data, 'meetingTitle') || get(data, 'title') || 'New meeting'}`
    case 'payment_created':
      return `Payment recorded${get(data, 'amount') ? `: ${get(data, 'amount')}` : ''}`
    case 'payment_due':
      return `Payment due${get(data, 'amount') ? `: ${get(data, 'amount')}` : ''}`
    default:
      return 'Notification'
  }
}

/** Returns the route path a notification's click should navigate to,
 *  or null when the type has no canonical destination. */
export function notificationHref(
  n: NotificationRow,
  opts: { isClientRole: boolean } = { isClientRole: false },
): string | null {
  const data = n.data || {}
  const taskId = get(data, 'taskId')
  if (taskId) return `/tasks?taskId=${taskId}`

  if (
    n.type === 'brand_intake_submitted' ||
    n.type === 'question_form_submitted' ||
    n.type === 'series_form_submitted'
  ) {
    const clientId = get(data, 'clientId')
    return clientId ? `/clients/${clientId}` : null
  }

  if (n.type === 'approval_comment_resolved') {
    const approvalId = get(data, 'approvalId')
    return approvalId ? `/approvals/${approvalId}` : null
  }

  if (
    n.type === 'approval_created' ||
    n.type === 'approval_approved' ||
    n.type === 'approval_comment' ||
    n.type === 'approval_mention' ||
    n.type === 'approval_reminder'
  ) {
    const approvalId = get(data, 'approvalId')
    if (opts.isClientRole) {
      return approvalId ? `/portal/approvals/${approvalId}` : '/portal/approvals'
    }
    return approvalId ? `/approvals/${approvalId}` : '/approvals'
  }

  if (n.type === 'lead_created') {
    const clientId = get(data, 'clientId')
    if (!clientId) return null
    const leadId = get(data, 'leadId')
    return leadId
      ? `/crm/${clientId}/leads?focus=${leadId}`
      : `/crm/${clientId}/leads`
  }

  if (n.type === 'capture_submission') {
    const clientId = get(data, 'clientId')
    if (!clientId) return null
    const submissionId = get(data, 'submissionId')
    // Capture page: switch to submissions tab + open the detail
    // modal for this submission. The page reads `?tab=submissions`
    // + `?focus=<id>` from the URL.
    return submissionId
      ? `/crm/${clientId}/capture?tab=submissions&focus=${submissionId}`
      : `/crm/${clientId}/capture?tab=submissions`
  }

  if (n.type === 'meeting_created') {
    const clientId = get(data, 'clientId')
    if (!clientId) return null
    const meetingId = get(data, 'meetingId')
    return meetingId
      ? `/crm/${clientId}/meetings?focus=${meetingId}`
      : `/crm/${clientId}/meetings`
  }

  if (n.type === 'payment_created' || n.type === 'payment_due') {
    const clientId = get(data, 'clientId')
    if (!clientId) return null
    const paymentId = get(data, 'paymentId')
    return paymentId
      ? `/crm/${clientId}/revenue?focus=${paymentId}`
      : `/crm/${clientId}/revenue`
  }

  return null
}

/** Formats a created_at timestamp as a relative + absolute label.
 *  e.g. "2h ago" / "yesterday" / "May 14". */
export function formatNotificationTime(iso: string): string {
  const now = Date.now()
  const then = new Date(iso).getTime()
  const diffSec = Math.round((now - then) / 1000)
  if (diffSec < 60) return 'just now'
  const min = Math.round(diffSec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const days = Math.round(hr / 24)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
