import {
  View,
  Text,
  StyleSheet,
} from '@react-pdf/renderer'
import { ReportLayout } from './ReportLayout'
import type { AdminEvent } from '@/lib/admin/events'

// PDF export of the admin activity feed. Mirrors the on-screen table at
// a high level - one row per event, time / action / actor / client /
// detail / status. Caps the row count so the PDF doesn't balloon when
// the user has hundreds of events in the window.

const COLORS = {
  text: '#0F172A',
  muted: '#64748B',
  faint: '#94A3B8',
  border: '#E2E8F0',
  bgSubtle: '#F8FAFC',
  ok: '#10B981',
  failed: '#EF4444',
  // Category dots
  ai: '#3B82F6',
  slot: '#10B981',
  approval: '#A78BFA',
  task: '#F59E0B',
  competitor: '#EC4899',
  plan: '#10B981',
  comment: '#0EA5E9',
}

const styles = StyleSheet.create({
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 14,
  },
  summaryCell: {
    width: '23%',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 6,
    backgroundColor: COLORS.bgSubtle,
  },
  summaryLabel: {
    fontSize: 8,
    color: COLORS.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  summaryValue: {
    fontSize: 14,
    color: COLORS.text,
    marginTop: 3,
    fontFamily: 'Helvetica-Bold',
  },
  tableHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingBottom: 4,
    marginTop: 6,
  },
  th: {
    fontSize: 8,
    color: COLORS.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  row: {
    flexDirection: 'row',
    paddingVertical: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.border,
    alignItems: 'center',
  },
  rowAlt: {
    backgroundColor: COLORS.bgSubtle,
  },
  td: {
    fontSize: 9,
    color: COLORS.text,
  },
  tdMono: {
    fontSize: 9,
    color: COLORS.muted,
    fontFamily: 'Courier',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 4,
  },
  statusOk: {
    color: COLORS.muted,
    fontSize: 8,
    textTransform: 'uppercase',
  },
  statusFailed: {
    color: COLORS.failed,
    fontSize: 8,
    textTransform: 'uppercase',
  },
  failureLine: {
    fontSize: 8,
    color: COLORS.failed,
    marginTop: 1,
  },
})

const COL = {
  time: '12%',
  action: '20%',
  actor: '16%',
  client: '16%',
  detail: '28%',
  status: '8%',
}

interface AdminActivityReportProps {
  workspaceName: string
  rangeLabel: string
  filtersLabel: string[]
  totalCount: number
  failedCount: number
  categoryCounts: Record<string, number>
  events: AdminEvent[]
  generatedAtIso?: string
}

function fmtTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function categoryColor(cat: string): string {
  return (COLORS as Record<string, string>)[cat] ?? COLORS.muted
}

export function AdminActivityReport({
  workspaceName,
  rangeLabel,
  filtersLabel,
  totalCount,
  failedCount,
  categoryCounts,
  events,
  generatedAtIso,
}: AdminActivityReportProps) {
  // Cap to first 200 rows so multi-page PDFs stay reasonable. Users who
  // want the full set can use CSV export.
  const rows = events.slice(0, 200)

  const okCount = totalCount - failedCount
  const successPct = totalCount === 0 ? 100 : Math.round((okCount / totalCount) * 100)

  return (
    <ReportLayout
      workspaceName={workspaceName}
      reportTitle="Admin activity"
      period={rangeLabel}
      filters={filtersLabel}
      generatedAtIso={generatedAtIso ?? new Date().toISOString()}
    >
      {/* Summary cells */}
      <View style={styles.summaryGrid}>
        <View style={styles.summaryCell}>
          <Text style={styles.summaryLabel}>Events</Text>
          <Text style={styles.summaryValue}>{totalCount.toLocaleString()}</Text>
        </View>
        <View style={styles.summaryCell}>
          <Text style={styles.summaryLabel}>Passed</Text>
          <Text style={styles.summaryValue}>{okCount.toLocaleString()}</Text>
        </View>
        <View style={styles.summaryCell}>
          <Text style={styles.summaryLabel}>Failed</Text>
          <Text style={styles.summaryValue}>{failedCount.toLocaleString()}</Text>
        </View>
        <View style={styles.summaryCell}>
          <Text style={styles.summaryLabel}>Success rate</Text>
          <Text style={styles.summaryValue}>{successPct}%</Text>
        </View>
      </View>

      {/* Per-category counts */}
      {Object.keys(categoryCounts).length > 0 && (
        <View style={{ flexDirection: 'row', gap: 14, marginBottom: 10 }}>
          {Object.entries(categoryCounts).map(([cat, n]) => (
            <View key={cat} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <View style={[styles.dot, { backgroundColor: categoryColor(cat) }]} />
              <Text style={{ fontSize: 9, color: COLORS.muted }}>
                {cat} · {n}
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* Table header */}
      <View style={styles.tableHeader} fixed>
        <Text style={[styles.th, { width: COL.time }]}>Time</Text>
        <Text style={[styles.th, { width: COL.action }]}>Action</Text>
        <Text style={[styles.th, { width: COL.actor }]}>Actor</Text>
        <Text style={[styles.th, { width: COL.client }]}>Client</Text>
        <Text style={[styles.th, { width: COL.detail }]}>Detail</Text>
        <Text style={[styles.th, { width: COL.status, textAlign: 'right' }]}>
          Status
        </Text>
      </View>

      {rows.map((e, i) => (
        <View key={e.id} style={i % 2 === 1 ? [styles.row, styles.rowAlt] : styles.row} wrap={false}>
          <Text style={[styles.tdMono, { width: COL.time }]}>{fmtTime(e.ts)}</Text>
          <View style={{ width: COL.action, flexDirection: 'row', alignItems: 'center' }}>
            <View style={[styles.dot, { backgroundColor: e.status === 'failed' ? COLORS.failed : categoryColor(e.category) }]} />
            <Text style={styles.td}>{e.action}</Text>
          </View>
          <Text style={[styles.td, { width: COL.actor, color: COLORS.muted }]}>
            {e.actorName ?? '-'}
          </Text>
          <Text style={[styles.td, { width: COL.client, color: COLORS.muted }]}>
            {e.clientName ?? '-'}
          </Text>
          <View style={{ width: COL.detail }}>
            <Text style={[styles.td, { color: COLORS.muted }]}>{e.detail}</Text>
            {e.status === 'failed' && e.failureReason && (
              <Text style={styles.failureLine}>{e.failureReason}</Text>
            )}
          </View>
          <Text
            style={[
              e.status === 'failed' ? styles.statusFailed : styles.statusOk,
              { width: COL.status, textAlign: 'right' },
            ]}
          >
            {e.status === 'failed' ? 'failed' : 'ok'}
          </Text>
        </View>
      ))}

      {events.length > rows.length && (
        <Text
          style={{
            fontSize: 8,
            color: COLORS.faint,
            marginTop: 8,
            textAlign: 'center',
          }}
        >
          Showing first {rows.length} of {events.length} events · export CSV for the full set
        </Text>
      )}
    </ReportLayout>
  )
}
