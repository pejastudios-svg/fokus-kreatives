import { View, Text, StyleSheet } from '@react-pdf/renderer'
import { ReportLayout, reportColors as C } from './ReportLayout'

// Client-facing leads pipeline report.
//   1. KPIs: Total · This week (delta) · Closed (conversion)
//   2. Status breakdown - workspace status options + count + share %
//   3. Lead list - one row per lead in the active filter

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
  kpiSub: {
    fontSize: 8,
    color: C.muted,
    marginTop: 3,
  },
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
  breakdownPct: {
    width: 80,
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
  tableCell: {
    fontSize: 9,
    color: C.text,
  },
  colName: { width: '28%' },
  colEmail: { width: '32%' },
  colStatus: { width: '18%' },
  colCreated: { width: '11%', textAlign: 'right' },
  colUpdated: { width: '11%', textAlign: 'right' },
  statusPill: {
    fontSize: 8,
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 99,
    alignSelf: 'flex-start',
    fontFamily: 'Helvetica-Bold',
    color: '#fff',
  },
  empty: {
    fontSize: 10,
    color: C.muted,
    fontStyle: 'italic',
    paddingVertical: 14,
    textAlign: 'center',
  },
})

export interface LeadsReportRow {
  name: string
  email: string | null
  statusValue: string | null // raw value, may not be in workspace options
  createdDate: string // ISO
  updatedDate: string | null // ISO
}

export interface LeadsReportStatus {
  value: string
  label: string
  color: string
  count: number
}

export interface LeadsReportBodyProps {
  metrics: {
    total: number
    thisWeek: number
    weekDelta: number // %
    closed: number
    conversionPct: number
  }
  // Pipeline breakdown - one row per status that has leads, plus an
  // "Unset" bucket for leads with no/unknown status.
  byStatus: LeadsReportStatus[]
  unsetCount: number
  rows: LeadsReportRow[]
}

export interface LeadsReportProps extends LeadsReportBodyProps {
  workspaceName: string
  filters: string[]
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

function statusBadge(s: { label: string; color: string }) {
  return (
    <Text
      style={[
        styles.statusPill,
        { backgroundColor: s.color },
      ]}
    >
      {s.label}
    </Text>
  )
}

export function LeadsReportBody({
  metrics,
  byStatus,
  unsetCount,
  rows,
}: LeadsReportBodyProps) {
  const totalForPct = metrics.total || 1
  const statusByValue = new Map<string, LeadsReportStatus>()
  for (const s of byStatus) statusByValue.set(s.value, s)

  return (
    <>
      <View style={styles.kpiGrid} wrap={false}>
        <View style={styles.kpi}>
          <Text style={styles.kpiLabel}>Total leads</Text>
          <Text style={styles.kpiValue}>{metrics.total}</Text>
          <Text style={styles.kpiSub}>in this view</Text>
        </View>
        <View style={styles.kpi}>
          <Text style={styles.kpiLabel}>This week</Text>
          <Text style={styles.kpiValue}>{metrics.thisWeek}</Text>
          <Text
            style={[
              styles.kpiSub,
              {
                color:
                  metrics.weekDelta > 0
                    ? '#047857'
                    : metrics.weekDelta < 0
                      ? '#B91C1C'
                      : C.muted,
              },
            ]}
          >
            {metrics.weekDelta > 0 ? '+' : ''}
            {metrics.weekDelta}% vs prior week
          </Text>
        </View>
        <View style={styles.kpi}>
          <Text style={styles.kpiLabel}>Closed</Text>
          <Text style={styles.kpiValue}>{metrics.closed}</Text>
          <Text style={styles.kpiSub}>
            {metrics.conversionPct}% conversion
          </Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>By status</Text>
      <View wrap={false}>
        {byStatus.length === 0 && unsetCount === 0 ? (
          <Text style={styles.empty}>No leads in this view.</Text>
        ) : (
          <>
            {byStatus.map((s, i) => {
              const pct = Math.round((s.count / totalForPct) * 100)
              const isLast = i === byStatus.length - 1 && unsetCount === 0
              return (
                <View
                  key={s.value}
                  style={[
                    styles.breakdownRow,
                    isLast ? styles.breakdownLast : {},
                  ]}
                >
                  <View
                    style={[styles.breakdownDot, { backgroundColor: s.color }]}
                  />
                  <Text style={styles.breakdownLabel}>{s.label}</Text>
                  <Text style={styles.breakdownCount}>
                    {s.count} {s.count === 1 ? 'lead' : 'leads'}
                  </Text>
                  <Text style={styles.breakdownPct}>{pct}%</Text>
                </View>
              )
            })}
            {unsetCount > 0 && (
              <View style={[styles.breakdownRow, styles.breakdownLast]}>
                <View
                  style={[
                    styles.breakdownDot,
                    { backgroundColor: '#64748B' },
                  ]}
                />
                <Text style={styles.breakdownLabel}>Unset</Text>
                <Text style={styles.breakdownCount}>
                  {unsetCount} {unsetCount === 1 ? 'lead' : 'leads'}
                </Text>
                <Text style={styles.breakdownPct}>
                  {Math.round((unsetCount / totalForPct) * 100)}%
                </Text>
              </View>
            )}
          </>
        )}
      </View>

      <Text style={styles.sectionTitle}>Leads ({rows.length})</Text>
      {rows.length === 0 ? (
        <Text style={styles.empty}>No leads in this view.</Text>
      ) : (
        <View>
          <View style={styles.tableHeader} fixed>
            <Text style={[styles.tableHeaderCell, styles.colName]}>Name</Text>
            <Text style={[styles.tableHeaderCell, styles.colEmail]}>Email</Text>
            <Text style={[styles.tableHeaderCell, styles.colStatus]}>
              Status
            </Text>
            <Text style={[styles.tableHeaderCell, styles.colCreated]}>
              Added
            </Text>
            <Text style={[styles.tableHeaderCell, styles.colUpdated]}>
              Updated
            </Text>
          </View>
          {rows.map((r, idx) => {
            const s = r.statusValue
              ? statusByValue.get(r.statusValue)
              : undefined
            return (
              <View key={idx} style={styles.tableRow} wrap={false}>
                <Text style={[styles.tableCell, styles.colName]}>{r.name}</Text>
                <Text style={[styles.tableCell, styles.colEmail]}>
                  {r.email || '-'}
                </Text>
                <View style={styles.colStatus}>
                  {s ? (
                    statusBadge(s)
                  ) : (
                    <Text
                      style={[
                        styles.statusPill,
                        { backgroundColor: '#64748B' },
                      ]}
                    >
                      Unset
                    </Text>
                  )}
                </View>
                <Text style={[styles.tableCell, styles.colCreated]}>
                  {fmtDate(r.createdDate)}
                </Text>
                <Text style={[styles.tableCell, styles.colUpdated]}>
                  {fmtDate(r.updatedDate)}
                </Text>
              </View>
            )
          })}
        </View>
      )}
    </>
  )
}

export function LeadsReport({
  workspaceName,
  filters,
  metrics,
  byStatus,
  unsetCount,
  rows,
}: LeadsReportProps) {
  return (
    <ReportLayout
      workspaceName={workspaceName}
      reportTitle="Leads Report"
      period="Pipeline snapshot"
      filters={filters}
      title={`${workspaceName} - Leads Report`}
    >
      <LeadsReportBody
        metrics={metrics}
        byStatus={byStatus}
        unsetCount={unsetCount}
        rows={rows}
      />
    </ReportLayout>
  )
}
