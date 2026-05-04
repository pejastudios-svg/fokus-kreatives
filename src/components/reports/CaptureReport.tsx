import { View, Text, StyleSheet } from '@react-pdf/renderer'
import { ReportLayout, reportColors as C } from './ReportLayout'

// Capture pages report. Two sections: pages list (with submission
// counts) + a recent-submissions list across all pages.

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
  // Pages table cols
  colName: { width: '34%' },
  colSlug: { width: '24%' },
  colState: { width: '14%' },
  colSubs: { width: '14%', textAlign: 'right' },
  colCreated: { width: '14%', textAlign: 'right' },
  // Submissions table cols
  colSubName: { width: '20%' },
  colSubEmail: { width: '24%' },
  colSubPhone: { width: '15%' },
  colSubPage: { width: '23%' },
  colSubWhen: { width: '18%', textAlign: 'right' },
  // State pill
  pill: {
    fontSize: 8,
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 99,
    alignSelf: 'flex-start',
    fontFamily: 'Helvetica-Bold',
  },
  pillActive: { color: '#047857', backgroundColor: '#D1FAE5' },
  pillInactive: { color: '#475569', backgroundColor: '#E2E8F0' },
  empty: {
    fontSize: 10,
    color: C.muted,
    fontStyle: 'italic',
    paddingVertical: 14,
    textAlign: 'center',
  },
})

export interface CaptureReportPage {
  name: string
  slug: string
  isActive: boolean
  submissionCount: number
  createdDate: string
}

export interface CaptureReportSubmission {
  pageName: string
  name: string | null
  email: string | null
  phone: string | null
  whenIso: string
}

export interface CaptureReportBodyProps {
  metrics: {
    totalPages: number
    activePages: number
    totalSubmissions: number
    submissions30d: number
  }
  pages: CaptureReportPage[]
  submissions: CaptureReportSubmission[]
}

export interface CaptureReportProps extends CaptureReportBodyProps {
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

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: '2-digit',
    })
  } catch {
    return '—'
  }
}

export function CaptureReportBody({
  metrics,
  pages,
  submissions,
}: CaptureReportBodyProps) {
  return (
    <>
      <View style={styles.kpiGrid} wrap={false}>
        <View style={styles.kpi}>
          <Text style={styles.kpiLabel}>Pages</Text>
          <Text style={styles.kpiValue}>{metrics.totalPages}</Text>
          <Text style={styles.kpiSub}>{metrics.activePages} active</Text>
        </View>
        <View style={styles.kpi}>
          <Text style={styles.kpiLabel}>Submissions</Text>
          <Text style={styles.kpiValue}>{metrics.totalSubmissions}</Text>
          <Text style={styles.kpiSub}>all time</Text>
        </View>
        <View style={styles.kpi}>
          <Text style={styles.kpiLabel}>Last 30 days</Text>
          <Text style={styles.kpiValue}>{metrics.submissions30d}</Text>
          <Text style={styles.kpiSub}>new submissions</Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>Pages ({pages.length})</Text>
      {pages.length === 0 ? (
        <Text style={styles.empty}>No capture pages yet.</Text>
      ) : (
        <View>
          <View style={styles.tableHeader} fixed>
            <Text style={[styles.tableHeaderCell, styles.colName]}>Name</Text>
            <Text style={[styles.tableHeaderCell, styles.colSlug]}>Slug</Text>
            <Text style={[styles.tableHeaderCell, styles.colState]}>State</Text>
            <Text style={[styles.tableHeaderCell, styles.colSubs]}>
              Submissions
            </Text>
            <Text style={[styles.tableHeaderCell, styles.colCreated]}>
              Created
            </Text>
          </View>
          {pages.map((p, idx) => (
            <View key={idx} style={styles.tableRow} wrap={false}>
              <Text style={[styles.tableCell, styles.colName]}>{p.name}</Text>
              <Text
                style={[styles.tableCell, styles.colSlug, { color: C.muted }]}
              >
                /{p.slug}
              </Text>
              <View style={styles.colState}>
                <Text
                  style={[
                    styles.pill,
                    p.isActive ? styles.pillActive : styles.pillInactive,
                  ]}
                >
                  {p.isActive ? 'Active' : 'Inactive'}
                </Text>
              </View>
              <Text style={[styles.tableCell, styles.colSubs]}>
                {p.submissionCount}
              </Text>
              <Text style={[styles.tableCell, styles.colCreated]}>
                {fmtDate(p.createdDate)}
              </Text>
            </View>
          ))}
        </View>
      )}

      <Text style={styles.sectionTitle}>
        Recent submissions ({submissions.length})
      </Text>
      {submissions.length === 0 ? (
        <Text style={styles.empty}>No submissions yet.</Text>
      ) : (
        <View>
          <View style={styles.tableHeader} fixed>
            <Text style={[styles.tableHeaderCell, styles.colSubName]}>
              Name
            </Text>
            <Text style={[styles.tableHeaderCell, styles.colSubEmail]}>
              Email
            </Text>
            <Text style={[styles.tableHeaderCell, styles.colSubPhone]}>
              Phone
            </Text>
            <Text style={[styles.tableHeaderCell, styles.colSubPage]}>
              Page
            </Text>
            <Text style={[styles.tableHeaderCell, styles.colSubWhen]}>
              When
            </Text>
          </View>
          {submissions.map((s, idx) => (
            <View key={idx} style={styles.tableRow} wrap={false}>
              <Text style={[styles.tableCell, styles.colSubName]}>
                {s.name || '—'}
              </Text>
              <Text style={[styles.tableCell, styles.colSubEmail]}>
                {s.email || '—'}
              </Text>
              <Text style={[styles.tableCell, styles.colSubPhone]}>
                {s.phone || '—'}
              </Text>
              <Text
                style={[
                  styles.tableCell,
                  styles.colSubPage,
                  { color: C.muted },
                ]}
              >
                {s.pageName}
              </Text>
              <Text style={[styles.tableCell, styles.colSubWhen]}>
                {fmtDateTime(s.whenIso)}
              </Text>
            </View>
          ))}
        </View>
      )}
    </>
  )
}

export function CaptureReport({
  workspaceName,
  filters,
  metrics,
  pages,
  submissions,
}: CaptureReportProps) {
  return (
    <ReportLayout
      workspaceName={workspaceName}
      reportTitle="Capture Pages Report"
      period="Lead intake overview"
      filters={filters}
      title={`${workspaceName} - Capture Pages Report`}
    >
      <CaptureReportBody
        metrics={metrics}
        pages={pages}
        submissions={submissions}
      />
    </ReportLayout>
  )
}
