import { View, Text, StyleSheet } from '@react-pdf/renderer'
import { ReportLayout, reportColors as C } from './ReportLayout'

// Client-facing revenue report. Same metrics the screen shows, laid out
// for print:
//   1. KPI strip - Collected / Outstanding / Overdue / Invoices
//   2. Status breakdown - counts + amounts per status
//   3. Invoice table - one row per payment in the active filter
//
// Headline totals are in the active display currency (so they sum
// coherently across mixed-currency workspaces); per-row amounts stay
// in each invoice's original currency so the line items match the
// invoices a client actually received.

const styles = StyleSheet.create({
  // KPI grid
  kpiGrid: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  kpi: {
    flex: 1,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 6,
    padding: 10,
  },
  kpiLabel: {
    fontSize: 8,
    color: C.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  kpiValue: {
    fontSize: 14,
    fontFamily: 'Helvetica-Bold',
    color: C.text,
  },
  kpiSub: {
    fontSize: 8,
    color: C.muted,
    marginTop: 3,
  },
  // Status breakdown
  breakdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  breakdownLast: {
    borderBottomWidth: 0,
  },
  breakdownDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  breakdownLabel: {
    flex: 1,
    fontSize: 10,
    color: C.text,
  },
  breakdownCount: {
    width: 80,
    fontSize: 10,
    color: C.muted,
    textAlign: 'right',
  },
  breakdownAmount: {
    width: 110,
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    color: C.text,
    textAlign: 'right',
  },
  // Invoice table
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: C.bgSubtle,
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: C.border,
  },
  tableHeaderCell: {
    fontSize: 8,
    color: C.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    fontFamily: 'Helvetica-Bold',
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  tableCell: {
    fontSize: 9,
    color: C.text,
  },
  // Column widths (must sum to ~1)
  colInv: { width: '15%' },
  colCust: { width: '32%' },
  colAmt: { width: '20%', textAlign: 'right' },
  colStatus: { width: '13%' },
  colDue: { width: '10%', textAlign: 'right' },
  colPaid: { width: '10%', textAlign: 'right' },
  // Status pill (inline, sized small for table)
  statusPill: {
    fontSize: 8,
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 99,
    alignSelf: 'flex-start',
    fontFamily: 'Helvetica-Bold',
  },
  empty: {
    fontSize: 10,
    color: C.muted,
    fontStyle: 'italic',
    paddingVertical: 14,
    textAlign: 'center',
  },
})

const STATUS_THEME: Record<string, { color: string; bg: string; label: string }> = {
  paid: { color: '#047857', bg: '#D1FAE5', label: 'Paid' },
  pending: { color: '#B45309', bg: '#FEF3C7', label: 'Pending' },
  overdue: { color: '#B91C1C', bg: '#FEE2E2', label: 'Overdue' },
  cancelled: { color: '#475569', bg: '#E2E8F0', label: 'Cancelled' },
}

export interface RevenueReportRow {
  invoiceNumber: string | null
  customer: string // lead name / email / fallback
  amountOriginal: number
  originalCurrency: string
  status: 'paid' | 'pending' | 'overdue' | 'cancelled'
  dueDate: string | null // ISO
  paidDate: string | null // ISO
}

// Data-only props: everything the Body needs to render its View tree.
// Used directly by CombinedReport (which supplies its own page chrome).
export interface RevenueReportBodyProps {
  displayCurrency: string
  metrics: {
    thisCollected: number
    outstandingNow: number
    overdueNow: number
    delta: number | null
  }
  byStatus: {
    paid: { count: number; amount: number }
    pending: { count: number; amount: number }
    overdue: { count: number; amount: number }
    cancelled: { count: number; amount: number }
  }
  rows: RevenueReportRow[]
}

export interface RevenueReportProps extends RevenueReportBodyProps {
  workspaceName: string
  // Header chips - mirrors the active page filters so the reader knows
  // exactly which slice they're looking at.
  bucketLabel: string // e.g. "Per day · last 30 days"
  filters: string[]
}

function fmtMoney(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(n)
  } catch {
    return `${currency} ${Math.round(n).toLocaleString()}`
  }
}

function fmtDate(iso: string | null): string {
  if (!iso) return '-'
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: '2-digit',
    })
  } catch {
    return '-'
  }
}

// Body: just the View tree, no Document/Page chrome. Composable so
// CombinedReport can drop several of these into one Document.
export function RevenueReportBody({
  displayCurrency,
  metrics,
  byStatus,
  rows,
}: RevenueReportBodyProps) {
  const totalInvoices =
    byStatus.paid.count +
    byStatus.pending.count +
    byStatus.overdue.count +
    byStatus.cancelled.count

  return (
    <>
      {/* KPI strip */}
      <View style={styles.kpiGrid} wrap={false}>
        <View style={styles.kpi}>
          <Text style={styles.kpiLabel}>Collected</Text>
          <Text style={styles.kpiValue}>
            {fmtMoney(metrics.thisCollected, displayCurrency)}
          </Text>
          {metrics.delta != null && (
            <Text
              style={[
                styles.kpiSub,
                {
                  color:
                    metrics.delta > 0
                      ? '#047857'
                      : metrics.delta < 0
                        ? '#B91C1C'
                        : C.muted,
                },
              ]}
            >
              {metrics.delta > 0 ? '+' : ''}
              {metrics.delta}% vs prior
            </Text>
          )}
        </View>
        <View style={styles.kpi}>
          <Text style={styles.kpiLabel}>Outstanding</Text>
          <Text style={styles.kpiValue}>
            {fmtMoney(metrics.outstandingNow, displayCurrency)}
          </Text>
          <Text style={styles.kpiSub}>pending + overdue, now</Text>
        </View>
        <View style={styles.kpi}>
          <Text style={styles.kpiLabel}>Overdue</Text>
          <Text
            style={[
              styles.kpiValue,
              { color: metrics.overdueNow > 0 ? '#B91C1C' : C.text },
            ]}
          >
            {fmtMoney(metrics.overdueNow, displayCurrency)}
          </Text>
          <Text style={styles.kpiSub}>past due, now</Text>
        </View>
        <View style={styles.kpi}>
          <Text style={styles.kpiLabel}>Invoices</Text>
          <Text style={styles.kpiValue}>{totalInvoices}</Text>
          <Text style={styles.kpiSub}>
            {byStatus.paid.count} paid ·{' '}
            {byStatus.pending.count + byStatus.overdue.count} open
          </Text>
        </View>
      </View>

      {/* Status breakdown */}
      <Text
        style={{
          fontSize: 11,
          fontFamily: 'Helvetica-Bold',
          color: C.text,
          textTransform: 'uppercase',
          letterSpacing: 0.6,
          marginTop: 14,
          marginBottom: 8,
        }}
      >
        By status
      </Text>
      <View wrap={false}>
        {(['paid', 'pending', 'overdue', 'cancelled'] as const).map(
          (k, i, arr) => {
            const s = byStatus[k]
            if (s.count === 0) return null
            const theme = STATUS_THEME[k]
            const isLast = arr.slice(i + 1).every((kk) => byStatus[kk].count === 0)
            return (
              <View
                key={k}
                style={[
                  styles.breakdownRow,
                  isLast ? styles.breakdownLast : {},
                ]}
              >
                <View
                  style={[styles.breakdownDot, { backgroundColor: theme.color }]}
                />
                <Text style={styles.breakdownLabel}>{theme.label}</Text>
                <Text style={styles.breakdownCount}>
                  {s.count} {s.count === 1 ? 'invoice' : 'invoices'}
                </Text>
                <Text style={styles.breakdownAmount}>
                  {fmtMoney(s.amount, displayCurrency)}
                </Text>
              </View>
            )
          },
        )}
      </View>

      {/* Invoice table */}
      <Text
        style={{
          fontSize: 11,
          fontFamily: 'Helvetica-Bold',
          color: C.text,
          textTransform: 'uppercase',
          letterSpacing: 0.6,
          marginTop: 18,
          marginBottom: 8,
        }}
      >
        Invoices ({rows.length})
      </Text>

      {rows.length === 0 ? (
        <Text style={styles.empty}>No invoices in this view.</Text>
      ) : (
        <View>
          <View style={styles.tableHeader} fixed>
            <Text style={[styles.tableHeaderCell, styles.colInv]}>Invoice</Text>
            <Text style={[styles.tableHeaderCell, styles.colCust]}>
              Customer
            </Text>
            <Text style={[styles.tableHeaderCell, styles.colAmt]}>Amount</Text>
            <Text style={[styles.tableHeaderCell, styles.colStatus]}>
              Status
            </Text>
            <Text style={[styles.tableHeaderCell, styles.colDue]}>Due</Text>
            <Text style={[styles.tableHeaderCell, styles.colPaid]}>Paid</Text>
          </View>
          {rows.map((r, idx) => {
            const theme = STATUS_THEME[r.status]
            return (
              <View key={idx} style={styles.tableRow} wrap={false}>
                <Text style={[styles.tableCell, styles.colInv]}>
                  {r.invoiceNumber || '-'}
                </Text>
                <Text style={[styles.tableCell, styles.colCust]}>
                  {r.customer}
                </Text>
                <Text style={[styles.tableCell, styles.colAmt]}>
                  {fmtMoney(r.amountOriginal, r.originalCurrency)}
                </Text>
                <View style={styles.colStatus}>
                  <Text
                    style={[
                      styles.statusPill,
                      { color: theme.color, backgroundColor: theme.bg },
                    ]}
                  >
                    {theme.label}
                  </Text>
                </View>
                <Text style={[styles.tableCell, styles.colDue]}>
                  {fmtDate(r.dueDate)}
                </Text>
                <Text style={[styles.tableCell, styles.colPaid]}>
                  {fmtDate(r.paidDate)}
                </Text>
              </View>
            )
          })}
        </View>
      )}
    </>
  )
}

// Standalone Document wrapper. Existing per-page export uses this; the
// combined report builds its own Document and uses RevenueReportBody
// directly inside a ReportPage.
export function RevenueReport({
  workspaceName,
  bucketLabel,
  filters,
  displayCurrency,
  metrics,
  byStatus,
  rows,
}: RevenueReportProps) {
  return (
    <ReportLayout
      workspaceName={workspaceName}
      reportTitle="Revenue Report"
      period={bucketLabel}
      filters={filters}
      title={`${workspaceName} - Revenue Report`}
    >
      <RevenueReportBody
        displayCurrency={displayCurrency}
        metrics={metrics}
        byStatus={byStatus}
        rows={rows}
      />
    </ReportLayout>
  )
}
