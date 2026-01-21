// src/app/api/clickup/helpers.ts
import 'server-only'

const CLICKUP_API_BASE_URL = 'https://api.clickup.com/api/v2'

const CLICKUP_API_TOKEN = process.env.CLICKUP_API_TOKEN
const CLICKUP_STATUS_WAITING = process.env.CLICKUP_STATUS_WAITING || '⏳ WAITING FOR FEEDBACK'
const CLICKUP_STATUS_APPROVED = process.env.CLICKUP_STATUS_APPROVED || '✅ APPROVED'

if (!CLICKUP_API_TOKEN) {
  console.warn('CLICKUP_API_TOKEN is not set – ClickUp integration will be disabled.')
}

export async function fetchClickUpTaskName(taskId: string): Promise<string | null> {
  if (!CLICKUP_API_TOKEN || !taskId) return null

  try {
    const res = await fetch(`${CLICKUP_API_BASE_URL}/task/${encodeURIComponent(taskId)}`, {
      method: 'GET',
      headers: {
        'Authorization': CLICKUP_API_TOKEN,
      },
      cache: 'no-store',
    })

    if (!res.ok) {
      console.error('ClickUp fetch task failed', taskId, await res.text())
      return null
    }

    const data = await res.json()
    return (data?.name as string) || null
  } catch (err) {
    console.error('ClickUp fetchTaskName error', err)
    return null
  }
}

export async function updateClickUpStatus(taskId: string, waitingOrApproved: 'waiting' | 'approved') {
  if (!CLICKUP_API_TOKEN || !taskId) {
    return { success: false, error: 'Missing token or taskId' }
  }

  const statusName =
    waitingOrApproved === 'approved' ? CLICKUP_STATUS_APPROVED : CLICKUP_STATUS_WAITING

  try {
    const res = await fetch(`${CLICKUP_API_BASE_URL}/task/${encodeURIComponent(taskId)}`, {
      method: 'PUT',
      headers: {
        'Authorization': CLICKUP_API_TOKEN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        status: statusName,
      }),
    })

    if (!res.ok) {
      const text = await res.text()
      console.error('ClickUp update status failed', taskId, text)
      return { success: false, error: text }
    }

    return { success: true }
    } catch (err: unknown) {
    console.error('ClickUp updateStatus error', err)
    const errorMessage = err instanceof Error ? err.message : 'Unknown error'
    return { success: false, error: errorMessage }
  }
}