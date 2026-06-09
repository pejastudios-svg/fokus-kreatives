import { NextRequest, NextResponse } from 'next/server'
import { admin, enqueueEmail } from '@/lib/emailOutbox'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Send scheduled invoices whose send date has arrived.
 *
 * Picks up invoices with send_status='scheduled' and send_on <= today,
 * enqueues a delivery email to the bill-to (a link to the generated .docx),
 * and flips them to 'sent'. Until then the invoice stays a draft the agency
 * can keep editing.
 *
 * Schedule (Vercel Cron): once a day is plenty. Auth: `?secret=<CRON_SECRET>`,
 * same as the other cron routes.
 *
 * Note: actual delivery rides the existing email_outbox -> Apps Script path,
 * so the Apps Script needs an `invoice_sent` template that reads the payload
 * below (to, billToName, invoiceNumber, amount, currency, dueDate, link).
 */
export async function GET(req: NextRequest) {
  try {
    const secret = new URL(req.url).searchParams.get('secret')
    const envSecret = process.env.CRON_SECRET
    if (envSecret && secret !== envSecret) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }

    const db = admin()
    const today = new Date().toISOString().slice(0, 10)

    const { data: due, error } = await db
      .from('payments')
      .select('id, client_id, invoice_number, amount, currency, due_date, bill_to_name, bill_to_email, public_token')
      .eq('is_invoice', true)
      .eq('send_status', 'scheduled')
      .lte('send_on', today)

    if (error) {
      console.error('dispatch-invoices select error:', error)
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    let sent = 0
    let queued = 0
    for (const inv of due ?? []) {
      if (inv.bill_to_email) {
        const ok = await enqueueEmail({
          type: 'invoice_sent',
          payload: {
            clientId: inv.client_id,
            to: inv.bill_to_email,
            billToName: inv.bill_to_name ?? '',
            invoiceNumber: inv.invoice_number ?? '',
            amount: inv.amount,
            currency: inv.currency,
            dueDate: inv.due_date,
            link: inv.public_token
              ? `${process.env.NEXT_PUBLIC_APP_URL}/invoice/${inv.public_token}`
              : '',
          },
          idempotencyKey: `invoice:${inv.id}:send`,
        })
        if (ok) queued += 1
      }
      await db
        .from('payments')
        .update({ send_status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', inv.id)
      sent += 1
    }

    return NextResponse.json({ success: true, processed: sent, emailsQueued: queued })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('dispatch-invoices error:', err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
