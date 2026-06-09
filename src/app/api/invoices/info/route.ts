import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const admin = () =>
  createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

// Public: render the hosted invoice page. Fetched by /invoice/[token].
export async function GET(req: NextRequest) {
  const token = new URL(req.url).searchParams.get('token')
  if (!token) {
    return NextResponse.json({ success: false, error: 'Missing token' }, { status: 400 })
  }

  const db = admin()
  const { data: pay, error } = await db
    .from('payments')
    .select(
      'invoice_number, currency, amount, line_items, tax_rate, discount, issue_date, due_date, notes, bill_to_name, bill_to_email, payment_link, status, send_status, client_marked_paid_at, client_id',
    )
    .eq('public_token', token)
    .eq('is_invoice', true)
    .single()

  if (error || !pay) {
    return NextResponse.json({ success: false, error: 'Invoice not found' }, { status: 404 })
  }

  const { data: client } = await db
    .from('clients')
    .select('business_name, name, profile_picture_url')
    .eq('id', pay.client_id)
    .single()

  return NextResponse.json({
    success: true,
    invoice: {
      invoiceNumber: pay.invoice_number,
      currency: pay.currency || 'USD',
      lineItems: Array.isArray(pay.line_items) ? pay.line_items : [],
      taxRate: Number(pay.tax_rate) || 0,
      discount: Number(pay.discount) || 0,
      issueDate: pay.issue_date,
      dueDate: pay.due_date,
      notes: pay.notes,
      billToName: pay.bill_to_name,
      billToEmail: pay.bill_to_email,
      paymentLink: pay.payment_link,
      status: pay.status,
      sendStatus: pay.send_status,
      clientMarkedPaidAt: pay.client_marked_paid_at,
      from: client?.business_name || client?.name || 'Fokus Kreatives',
      logo: client?.profile_picture_url || null,
    },
  })
}
