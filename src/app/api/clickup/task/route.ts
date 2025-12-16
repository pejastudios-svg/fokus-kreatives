// src/app/api/clickup/task/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { fetchClickUpTaskName } from '@/app/api/clickup/helpers'

export async function POST(req: NextRequest) {
  try {
    const { taskId } = await req.json()

    if (!taskId || typeof taskId !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Missing or invalid taskId' },
        { status: 400 }
      )
    }

    const name = await fetchClickUpTaskName(taskId)

    if (!name) {
      return NextResponse.json(
        { success: false, error: 'Task not found or no access' },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true, name })
  } catch (err: any) {
    console.error('ClickUp task lookup error:', err)
    return NextResponse.json(
      { success: false, error: err?.message || 'Server error' },
      { status: 500 }
    )
  }
}