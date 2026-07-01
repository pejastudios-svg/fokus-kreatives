import {
  Document,
  Page,
  View,
  Text,
  StyleSheet,
  type DocumentProps,
} from '@react-pdf/renderer'
import type { ReactNode } from 'react'

// Shared chrome for every page-export PDF: branded header strip with
// workspace name + report title + period + active filters, and a footer
// that auto-renders page number + generation timestamp + agency credit.
//
// Per-report templates wrap their content in this so layout, type
// hierarchy and branding stay consistent across exports.

const COLORS = {
  brand: '#2B79F7',
  text: '#0F172A',
  muted: '#64748B',
  faint: '#94A3B8',
  border: '#E2E8F0',
  bg: '#FFFFFF',
  bgSubtle: '#F8FAFC',
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: COLORS.bg,
    paddingTop: 40,
    paddingBottom: 56,
    paddingHorizontal: 36,
    fontFamily: 'Helvetica',
    fontSize: 10,
    color: COLORS.text,
  },
  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  workspace: {
    fontSize: 9,
    color: COLORS.muted,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  title: {
    fontSize: 20,
    color: COLORS.text,
    fontFamily: 'Helvetica-Bold',
  },
  period: {
    fontSize: 10,
    color: COLORS.muted,
    marginTop: 4,
  },
  brandBar: {
    height: 3,
    width: 36,
    backgroundColor: COLORS.brand,
    marginTop: 10,
    marginBottom: 14,
  },
  filtersRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
    marginBottom: 18,
  },
  filterPill: {
    backgroundColor: COLORS.bgSubtle,
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 99,
    paddingVertical: 2,
    paddingHorizontal: 8,
    fontSize: 8,
    color: COLORS.muted,
  },
  // Footer (fixed - rendered on every page)
  footer: {
    position: 'absolute',
    bottom: 24,
    left: 36,
    right: 36,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: 8,
    color: COLORS.faint,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  // Convenience hooks for child reports
  sectionTitle: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    color: COLORS.text,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 8,
    marginTop: 14,
  },
})

interface ReportPageProps {
  workspaceName: string
  reportTitle: string
  // E.g. "Revenue · last 30 days" or "Leads · all time".
  period: string
  // Optional pill-shaped chips shown under the period (e.g. "USD only",
  // "1 lead", etc.) so the reader knows which slice of the data they're
  // looking at.
  filters?: string[]
  // The agency name that goes in the footer credit. Defaults to the
  // platform name.
  agency?: string
  // ISO timestamp of when the doc was generated. Passed in by the
  // caller (rather than read inline) so report rendering stays pure
  // for the linter and the same value is used across all pages of a
  // multi-section report.
  generatedAtIso: string
  children: ReactNode
}

// One styled Page with the standard chrome (header strip, brand bar,
// filter pills, fixed footer with page numbers). The Body of any
// per-page report drops into this. Used directly by CombinedReport so
// each section becomes its own Page in one Document.
export function ReportPage({
  workspaceName,
  reportTitle,
  period,
  filters = [],
  agency = 'Fokus Kreativez',
  generatedAtIso,
  children,
}: ReportPageProps) {
  const generatedAt = new Date(generatedAtIso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
  return (
    <Page size="A4" style={styles.page}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.workspace}>{workspaceName}</Text>
          <Text style={styles.title}>{reportTitle}</Text>
          <Text style={styles.period}>{period}</Text>
        </View>
        <Text style={{ fontSize: 8, color: COLORS.faint }}>
          Generated {generatedAt}
        </Text>
      </View>

      <View style={styles.brandBar} />

      {filters.length > 0 && (
        <View style={styles.filtersRow}>
          {filters.map((f, i) => (
            <Text key={i} style={styles.filterPill}>
              {f}
            </Text>
          ))}
        </View>
      )}

      {children}

      <View style={styles.footer} fixed>
        <Text>Powered by {agency}</Text>
        <Text
          render={({ pageNumber, totalPages }) =>
            `${pageNumber} / ${totalPages}`
          }
        />
      </View>
    </Page>
  )
}

interface ReportLayoutProps
  extends Omit<DocumentProps, 'children'>,
    Omit<ReportPageProps, 'generatedAtIso' | 'children'> {
  // Optional - defaults to "now" at render time. Most standalone reports
  // omit this; the combined report passes the same value across pages.
  generatedAtIso?: string
  children: ReactNode
}

// Single-section convenience wrapper: returns a complete Document with
// one ReportPage. Existing per-page exports use this; the combined
// report builds its own Document and uses ReportPage directly.
export function ReportLayout({
  generatedAtIso,
  children,
  workspaceName,
  reportTitle,
  period,
  filters,
  agency,
  ...documentProps
}: ReportLayoutProps) {
  // Date.now() is fine here because react-pdf's renderer is a separate
  // pipeline (not React reconciliation), and the value is captured once
  // per call.
  const stamp = generatedAtIso ?? new Date().toISOString()
  return (
    <Document {...documentProps}>
      <ReportPage
        workspaceName={workspaceName}
        reportTitle={reportTitle}
        period={period}
        filters={filters}
        agency={agency}
        generatedAtIso={stamp}
      >
        {children}
      </ReportPage>
    </Document>
  )
}

// Re-export the shared style tokens so child reports stay on-brand
// without re-defining colors / type sizes.
export const reportStyles = styles
export const reportColors = COLORS
