import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const admin = () =>
  createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

/**
 * Public: the client clicked "I've paid" on the invoice page. We record the
 * signal and notify the CRM team to confirm. We do NOT mark the invoice paid
 * here - a CRM user confirms it. Idempotent: re-clicks don't re-notify.
 */
export async function POST(req: NextRequest) {
  try {
    const { token } = (await req.json()) as { token?: string }
    if (!token) {
      return NextResponse.json({ success: false, error: 'Missing token' }, { status: 400 })
    }

    const db = admin()
    const { data: pay, error } = await db
      .from('payments')
      .select('id, client_id, invoice_number, amount, currency, bill_to_name, client_marked_paid_at')
      .eq('public_token', token)
      .eq('is_invoice', true)
      .single()

    if (error || !pay) {
      return NextResponse.json({ success: false, error: 'Invoice not found' }, { status: 404 })
    }

    // Already flagged - no-op so re-clicks don't spam the inbox.
    if (pay.client_marked_paid_at) {
      return NextResponse.json({ success: true, alreadyMarked: true })
    }

    await db
      .from('payments')
      .update({ client_marked_paid_at: new Date().toISOString() })
      .eq('id', pay.id)

    // Fan out a CRM-inbox notification to the client's team to confirm.
    try {
      await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/notifications/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: pay.client_id,
          type: 'payment_marked_paid',
          data: {
            clientId: pay.client_id,
            paymentId: pay.id,
            invoiceNumber: pay.invoice_number,
            amount: pay.amount,
            currency: pay.currency,
            billToName: pay.bill_to_name,
          },
        }),
      })
    } catch (e) {
      console.error('mark-paid notification failed:', e)
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('mark-paid error:', err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
