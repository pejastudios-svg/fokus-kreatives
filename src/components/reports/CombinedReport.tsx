import {
  Document,
  Page,
  View,
  Text,
  StyleSheet,
  type DocumentProps,
} from '@react-pdf/renderer'
import { ReportPage, reportColors as C } from './ReportLayout'
import {
  RevenueReportBody,
  type RevenueReportBodyProps,
} from './RevenueReport'
import { LeadsReportBody, type LeadsReportBodyProps } from './LeadsReport'
import {
  MeetingsReportBody,
  type MeetingsReportBodyProps,
} from './MeetingsReport'
import {
  CaptureReportBody,
  type CaptureReportBodyProps,
} from './CaptureReport'
import { TeamReportBody, type TeamReportBodyProps } from './TeamReport'

// Combined workspace report - one PDF that stitches several per-page
// sections together with a cover page up front. Each section is its
// own A4 Page so the standard chrome (header, brand bar, footer with
// page numbers) renders correctly per section.
//
// Caller controls which sections appear by passing a partial sections
// object; missing keys are skipped.

export type CombinedSectionKey =
  | 'revenue'
  | 'leads'
  | 'meetings'
  | 'capture'
  | 'team'

const SECTION_TITLES: Record<CombinedSectionKey, string> = {
  revenue: 'Revenue',
  leads: 'Leads',
  meetings: 'Meetings',
  capture: 'Capture Pages',
  team: 'Team',
}

const SECTION_PERIODS: Record<CombinedSectionKey, string> = {
  revenue: 'Revenue summary',
  leads: 'Pipeline snapshot',
  meetings: 'Calendar overview',
  capture: 'Lead intake overview',
  team: 'Workspace roster',
}

export interface CombinedReportProps {
  workspaceName: string
  // Human-readable date-range label that shows on the cover and on each
  // section header (e.g. "Last 30 days · 04 Apr 2026 - 03 May 2026").
  rangeLabel: string
  // Generated-at timestamp. Same value across every page.
  generatedAtIso: string
  // Per-section data. Pass undefined / omit to skip a section.
  sections: {
    revenue?: RevenueReportBodyProps
    leads?: LeadsReportBodyProps
    meetings?: MeetingsReportBodyProps
    capture?: CaptureReportBodyProps
    team?: TeamReportBodyProps
  }
}

const coverStyles = StyleSheet.create({
  page: {
    backgroundColor: '#FFFFFF',
    paddingTop: 80,
    paddingBottom: 60,
    paddingHorizontal: 56,
    fontFamily: 'Helvetica',
    color: C.text,
  },
  workspace: {
    fontSize: 11,
    color: C.muted,
    textTransform: 'uppercase',
    letterSpacing: 1.6,
    marginBottom: 12,
  },
  title: {
    fontSize: 36,
    fontFamily: 'Helvetica-Bold',
    lineHeight: 1.1,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: C.muted,
    marginBottom: 24,
  },
  brandBar: {
    height: 4,
    width: 56,
    backgroundColor: '#2B79F7',
    marginBottom: 28,
  },
  metaLabel: {
    fontSize: 9,
    color: C.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  metaValue: {
    fontSize: 12,
    color: C.text,
    marginBottom: 16,
  },
  toc: {
    marginTop: 14,
  },
  tocLabel: {
    fontSize: 9,
    color: C.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  tocRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  tocName: { fontSize: 11, color: C.text, fontFamily: 'Helvetica-Bold' },
  tocPage: { fontSize: 10, color: C.muted },
  footer: {
    position: 'absolute',
    bottom: 32,
    left: 56,
    right: 56,
    fontSize: 8,
    color: C.faint,
    textAlign: 'center',
  },
})

interface CoverPageProps {
  workspaceName: string
  rangeLabel: string
  generatedAtIso: string
  sectionsIncluded: CombinedSectionKey[]
  agency: string
}

function CoverPage({
  workspaceName,
  rangeLabel,
  generatedAtIso,
  sectionsIncluded,
  agency,
}: CoverPageProps) {
  const generatedAt = new Date(generatedAtIso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
  return (
    <Page size="A4" style={coverStyles.page}>
      <Text style={coverStyles.workspace}>{workspaceName}</Text>
      <Text style={coverStyles.title}>Workspace Report</Text>
      <Text style={coverStyles.subtitle}>{rangeLabel}</Text>
      <View style={coverStyles.brandBar} />

      <Text style={coverStyles.metaLabel}>Generated</Text>
      <Text style={coverStyles.metaValue}>{generatedAt}</Text>

      <View style={coverStyles.toc}>
        <Text style={coverStyles.tocLabel}>Sections</Text>
        {sectionsIncluded.map((s, i) => (
          <View key={s} style={coverStyles.tocRow}>
            <Text style={coverStyles.tocName}>{SECTION_TITLES[s]}</Text>
            <Text style={coverStyles.tocPage}>Page {i + 2}</Text>
          </View>
        ))}
      </View>

      <Text style={coverStyles.footer}>Powered by {agency}</Text>
    </Page>
  )
}

export function CombinedReport({
  workspaceName,
  rangeLabel,
  generatedAtIso,
  sections,
}: CombinedReportProps) {
  const order: CombinedSectionKey[] = ['revenue', 'leads', 'meetings', 'capture', 'team']
  const included = order.filter((k) => sections[k] != null)
  const docProps: DocumentProps = { title: `${workspaceName} - Workspace Report` }
  const agency = 'Fokus Kreatives'

  return (
    <Document {...docProps}>
      <CoverPage
        workspaceName={workspaceName}
        rangeLabel={rangeLabel}
        generatedAtIso={generatedAtIso}
        sectionsIncluded={included}
        agency={agency}
      />

      {included.map((key) => {
        const reportTitle = SECTION_TITLES[key]
        const period = `${SECTION_PERIODS[key]} · ${rangeLabel}`
        return (
          <ReportPage
            key={key}
            workspaceName={workspaceName}
            reportTitle={reportTitle}
            period={period}
            generatedAtIso={generatedAtIso}
            agency={agency}
          >
            {key === 'revenue' && sections.revenue && (
              <RevenueReportBody {...sections.revenue} />
            )}
            {key === 'leads' && sections.leads && (
              <LeadsReportBody {...sections.leads} />
            )}
            {key === 'meetings' && sections.meetings && (
              <MeetingsReportBody {...sections.meetings} />
            )}
            {key === 'capture' && sections.capture && (
              <CaptureReportBody {...sections.capture} />
            )}
            {key === 'team' && sections.team && (
              <TeamReportBody {...sections.team} />
            )}
          </ReportPage>
        )
      })}
    </Document>
  )
}
