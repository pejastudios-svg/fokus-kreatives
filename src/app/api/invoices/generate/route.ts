import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  BorderStyle,
} from 'docx'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const admin = () =>
  createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

interface LineItem {
  description?: string
  quantity?: number
  unit_price?: number
}

function money(n: number, currency: string): string {
  return `${currency} ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// Compute invoice totals from line items + tax (percent) + discount (absolute).
export function invoiceTotals(items: LineItem[], taxRate: number, discount: number) {
  const subtotal = items.reduce(
    (sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0),
    0,
  )
  const discountAmt = Math.min(Number(discount) || 0, subtotal)
  const taxable = subtotal - discountAmt
  const taxAmt = taxable * ((Number(taxRate) || 0) / 100)
  const total = taxable + taxAmt
  return { subtotal, discountAmt, taxAmt, total }
}

const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
const cellBorders = {
  top: { style: BorderStyle.SINGLE, size: 1, color: 'E2E8F0' },
  bottom: { style: BorderStyle.SINGLE, size: 1, color: 'E2E8F0' },
  left: NO_BORDER,
  right: NO_BORDER,
}

function headerCell(text: string, align: (typeof AlignmentType)[keyof typeof AlignmentType]) {
  return new TableCell({
    borders: cellBorders,
    shading: { fill: 'F1F5F9' },
    children: [
      new Paragraph({
        alignment: align,
        children: [new TextRun({ text, bold: true, size: 20, color: '334155' })],
      }),
    ],
  })
}

function bodyCell(text: string, align: (typeof AlignmentType)[keyof typeof AlignmentType]) {
  return new TableCell({
    borders: cellBorders,
    children: [
      new Paragraph({ alignment: align, children: [new TextRun({ text, size: 20 })] }),
    ],
  })
}

function line(label: string, value: string, bold = false) {
  return new Paragraph({
    alignment: AlignmentType.RIGHT,
    spacing: { before: 60 },
    children: [
      new TextRun({ text: `${label}   `, bold, size: 20, color: '64748B' }),
      new TextRun({ text: value, bold, size: bold ? 24 : 20 }),
    ],
  })
}

export async function POST(req: NextRequest) {
  try {
    const { paymentId } = (await req.json()) as { paymentId?: string }
    if (!paymentId) {
      return NextResponse.json({ success: false, error: 'Missing paymentId' }, { status: 400 })
    }

    const db = admin()
    const { data: pay, error } = await db
      .from('payments')
      .select('*')
      .eq('id', paymentId)
      .single()
    if (error || !pay) {
      return NextResponse.json({ success: false, error: 'Invoice not found' }, { status: 404 })
    }

    const { data: client } = await db
      .from('clients')
      .select('business_name, name')
      .eq('id', pay.client_id)
      .single()
    const fromName = client?.business_name || client?.name || 'Your Business'

    const currency: string = pay.currency || 'USD'
    const items: LineItem[] = Array.isArray(pay.line_items) ? pay.line_items : []
    const { subtotal, discountAmt, taxAmt, total } = invoiceTotals(
      items,
      Number(pay.tax_rate) || 0,
      Number(pay.discount) || 0,
    )

    const fmtDate = (d: string | null) =>
      d ? new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—'

    // --- Build the document --------------------------------------------------
    const itemRows = [
      new TableRow({
        children: [
          headerCell('Description', AlignmentType.LEFT),
          headerCell('Qty', AlignmentType.CENTER),
          headerCell('Unit price', AlignmentType.RIGHT),
          headerCell('Amount', AlignmentType.RIGHT),
        ],
      }),
      ...(items.length
        ? items.map(
            (it) =>
              new TableRow({
                children: [
                  bodyCell(it.description || '—', AlignmentType.LEFT),
                  bodyCell(String(Number(it.quantity) || 0), AlignmentType.CENTER),
                  bodyCell(money(Number(it.unit_price) || 0, currency), AlignmentType.RIGHT),
                  bodyCell(
                    money((Number(it.quantity) || 0) * (Number(it.unit_price) || 0), currency),
                    AlignmentType.RIGHT,
                  ),
                ],
              }),
          )
        : [
            new TableRow({
              children: [bodyCell('No line items', AlignmentType.LEFT), bodyCell('', AlignmentType.CENTER), bodyCell('', AlignmentType.RIGHT), bodyCell('', AlignmentType.RIGHT)],
            }),
          ]),
    ]

    const doc = new Document({
      sections: [
        {
          properties: {},
          children: [
            new Paragraph({ children: [new TextRun({ text: 'INVOICE', bold: true, size: 52, color: '2B79F7' })] }),
            new Paragraph({
              spacing: { after: 200 },
              children: [
                new TextRun({ text: pay.invoice_number ? `# ${pay.invoice_number}` : '', size: 22, color: '64748B' }),
              ],
            }),

            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              borders: {
                top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER,
                insideHorizontal: NO_BORDER, insideVertical: NO_BORDER,
              },
              rows: [
                new TableRow({
                  children: [
                    new TableCell({
                      borders: { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER },
                      width: { size: 50, type: WidthType.PERCENTAGE },
                      children: [
                        new Paragraph({ children: [new TextRun({ text: 'From', bold: true, size: 18, color: '94A3B8' })] }),
                        new Paragraph({ children: [new TextRun({ text: fromName, size: 22, bold: true })] }),
                      ],
                    }),
                    new TableCell({
                      borders: { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER },
                      width: { size: 50, type: WidthType.PERCENTAGE },
                      children: [
                        new Paragraph({ children: [new TextRun({ text: 'Bill to', bold: true, size: 18, color: '94A3B8' })] }),
                        new Paragraph({ children: [new TextRun({ text: pay.bill_to_name || '—', size: 22, bold: true })] }),
                        new Paragraph({ children: [new TextRun({ text: pay.bill_to_email || '', size: 20, color: '64748B' })] }),
                      ],
                    }),
                  ],
                }),
              ],
            }),

            new Paragraph({
              spacing: { before: 200, after: 200 },
              children: [
                new TextRun({ text: `Issue date: `, size: 20, color: '64748B' }),
                new TextRun({ text: `${fmtDate(pay.issue_date)}      `, size: 20 }),
                new TextRun({ text: `Due date: `, size: 20, color: '64748B' }),
                new TextRun({ text: fmtDate(pay.due_date), size: 20 }),
              ],
            }),

            new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: itemRows }),

            new Paragraph({ spacing: { before: 200 } }),
            line('Subtotal', money(subtotal, currency)),
            ...(discountAmt > 0 ? [line('Discount', `- ${money(discountAmt, currency)}`)] : []),
            ...(taxAmt > 0 ? [line(`Tax (${Number(pay.tax_rate) || 0}%)`, money(taxAmt, currency))] : []),
            line('Total', money(total, currency), true),

            ...(pay.notes
              ? [
                  new Paragraph({ spacing: { before: 300 }, children: [new TextRun({ text: 'Notes', bold: true, size: 18, color: '94A3B8' })] }),
                  new Paragraph({ children: [new TextRun({ text: String(pay.notes), size: 20 })] }),
                ]
              : []),
          ],
        },
      ],
    })

    const buffer = await Packer.toBuffer(doc)

    const safeNo = (pay.invoice_number || 'invoice').replace(/[^a-zA-Z0-9-_]/g, '-')
    const fileName = `invoices/${pay.client_id}/${safeNo}-${Date.now()}.docx`
    const { error: upErr } = await db.storage.from('uploads').upload(fileName, buffer, {
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      upsert: true,
    })
    if (upErr) {
      console.error('invoice docx upload error:', upErr)
      return NextResponse.json({ success: false, error: upErr.message }, { status: 500 })
    }
    const { data: urlData } = db.storage.from('uploads').getPublicUrl(fileName)
    const docUrl = urlData.publicUrl

    await db.from('payments').update({ doc_url: docUrl }).eq('id', paymentId)

    return NextResponse.json({ success: true, url: docUrl, total })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('invoice generate error:', err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
