import { View, Text, StyleSheet } from '@react-pdf/renderer'
import { ReportLayout, reportColors as C } from './ReportLayout'

// Meetings report. KPI strip + status breakdown + chronological list.

const styles = StyleSheet.create({
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
  kpiSub: { fontSize: 8, color: C.muted, marginTop: 3 },
  sectionTitle: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    color: C.text,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 14,
    marginBottom: 8,
  },
  breakdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  breakdownLast: { borderBottomWidth: 0 },
  breakdownDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  breakdownLabel: { flex: 1, fontSize: 10, color: C.text },
  breakdownCount: {
    width: 100,
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    color: C.text,
    textAlign: 'right',
  },
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
  tableCell: { fontSize: 9, color: C.text },
  colTitle: { width: '36%' },
  colDate: { width: '20%' },
  colDuration: { width: '12%', textAlign: 'right' },
  colLocation: { width: '17%' },
  colStatus: { width: '15%' },
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

const STATUS_THEME: Record<
  string,
  { color: string; bg: string; label: string }
> = {
  scheduled: { color: '#1D4ED8', bg: '#DBEAFE', label: 'Scheduled' },
  completed: { color: '#047857', bg: '#D1FAE5', label: 'Completed' },
  cancelled: { color: '#475569', bg: '#E2E8F0', label: 'Cancelled' },
}

const LOCATION_LABEL: Record<string, string> = {
  zoom: 'Zoom',
  google_meet: 'Google Meet',
  jitsi: 'Jitsi',
  custom: 'Custom',
}

export interface MeetingsReportRow {
  title: string
  dateIso: string
  durationMinutes: number
  locationType: string
  status: 'scheduled' | 'completed' | 'cancelled'
}

export interface MeetingsReportBodyProps {
  metrics: {
    total: number
    upcoming: number
    past: number
    thisWeek: number
  }
  byStatus: {
    scheduled: number
    completed: number
    cancelled: number
  }
  rows: MeetingsReportRow[]
}

export interface MeetingsReportProps extends MeetingsReportBodyProps {
  workspaceName: string
  filters: string[]
}

function fmtDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: '2-digit',
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return '—'
  }
}

export function MeetingsReportBody({
  metrics,
  byStatus,
  rows,
}: MeetingsReportBodyProps) {
  return (
    <>
      <View style={styles.kpiGrid} wrap={false}>
        <View style={styles.kpi}>
          <Text style={styles.kpiLabel}>Total</Text>
          <Text style={styles.kpiValue}>{metrics.total}</Text>
          <Text style={styles.kpiSub}>in this view</Text>
        </View>
        <View style={styles.kpi}>
          <Text style={styles.kpiLabel}>Upcoming</Text>
          <Text style={styles.kpiValue}>{metrics.upcoming}</Text>
          <Text style={styles.kpiSub}>from today</Text>
        </View>
        <View style={styles.kpi}>
          <Text style={styles.kpiLabel}>Past</Text>
          <Text style={styles.kpiValue}>{metrics.past}</Text>
          <Text style={styles.kpiSub}>before today</Text>
        </View>
        <View style={styles.kpi}>
          <Text style={styles.kpiLabel}>This week</Text>
          <Text style={styles.kpiValue}>{metrics.thisWeek}</Text>
          <Text style={styles.kpiSub}>±7 days</Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>By status</Text>
      <View wrap={false}>
        {(['scheduled', 'completed', 'cancelled'] as const).map((k, i, arr) => {
          const count = byStatus[k]
          if (count === 0) return null
          const theme = STATUS_THEME[k]
          const isLast = arr.slice(i + 1).every((kk) => byStatus[kk] === 0)
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
                {count} {count === 1 ? 'meeting' : 'meetings'}
              </Text>
            </View>
          )
        })}
        {byStatus.scheduled === 0 &&
          byStatus.completed === 0 &&
          byStatus.cancelled === 0 && (
            <Text style={styles.empty}>No meetings in this view.</Text>
          )}
      </View>

      <Text style={styles.sectionTitle}>Meetings ({rows.length})</Text>
      {rows.length === 0 ? (
        <Text style={styles.empty}>No meetings in this view.</Text>
      ) : (
        <View>
          <View style={styles.tableHeader} fixed>
            <Text style={[styles.tableHeaderCell, styles.colTitle]}>Title</Text>
            <Text style={[styles.tableHeaderCell, styles.colDate]}>Date</Text>
            <Text style={[styles.tableHeaderCell, styles.colDuration]}>
              Duration
            </Text>
            <Text style={[styles.tableHeaderCell, styles.colLocation]}>
              Location
            </Text>
            <Text style={[styles.tableHeaderCell, styles.colStatus]}>
              Status
            </Text>
          </View>
          {rows.map((r, idx) => {
            const theme = STATUS_THEME[r.status] || STATUS_THEME.scheduled
            return (
              <View key={idx} style={styles.tableRow} wrap={false}>
                <Text style={[styles.tableCell, styles.colTitle]}>
                  {r.title || 'Untitled meeting'}
                </Text>
                <Text style={[styles.tableCell, styles.colDate]}>
                  {fmtDateTime(r.dateIso)}
                </Text>
                <Text style={[styles.tableCell, styles.colDuration]}>
                  {r.durationMinutes} min
                </Text>
                <Text style={[styles.tableCell, styles.colLocation]}>
                  {LOCATION_LABEL[r.locationType] || r.locationType || '—'}
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
              </View>
            )
          })}
        </View>
      )}
    </>
  )
}

export function MeetingsReport({
  workspaceName,
  filters,
  metrics,
  byStatus,
  rows,
}: MeetingsReportProps) {
  return (
    <ReportLayout
      workspaceName={workspaceName}
      reportTitle="Meetings Report"
      period="Calendar overview"
      filters={filters}
      title={`${workspaceName} - Meetings Report`}
    >
      <MeetingsReportBody
        metrics={metrics}
        byStatus={byStatus}
        rows={rows}
      />
    </ReportLayout>
  )
}
