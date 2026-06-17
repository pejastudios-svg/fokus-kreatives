import { View, Text } from '@react-pdf/renderer'
import { ReportLayout, reportColors, reportStyles } from './ReportLayout'

// Email campaigns PDF export (Emails tab). Mirrors the other page reports:
// stat tiles up top, then a campaigns performance table and the groups
// (audiences) table. CTR is unique clickers / delivered - opens are not
// tracked, so click-through is the headline metric.

export interface EmailsReportCampaign {
  name: string
  kind: string
  status: string
  emailsSent: number
  recipients: number
  delivered: number
  failed: number
  uniqueClicks: number
  totalClicks: number
  ctr: number
  unsubscribed: number
}

export interface EmailsReportGroup {
  name: string
  definition: string
  recipients: number
}

interface EmailsReportProps {
  workspaceName: string
  campaigns: EmailsReportCampaign[]
  groups: EmailsReportGroup[]
  suppressedCount: number
}

const cell = {
  paddingVertical: 5,
  paddingRight: 8,
  fontSize: 9,
  color: reportColors.text,
} as const

const headCell = {
  ...cell,
  fontFamily: 'Helvetica-Bold',
  fontSize: 8,
  color: reportColors.muted,
  textTransform: 'uppercase' as const,
  letterSpacing: 0.5,
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <View
      style={{
        flex: 1,
        borderWidth: 1,
        borderColor: reportColors.border,
        borderRadius: 6,
        padding: 10,
        backgroundColor: reportColors.bgSubtle,
      }}
    >
      <Text style={{ fontSize: 16, fontFamily: 'Helvetica-Bold', color: reportColors.text }}>
        {value}
      </Text>
      <Text style={{ fontSize: 8, color: reportColors.muted, marginTop: 3 }}>{label}</Text>
    </View>
  )
}

export function EmailsReport({
  workspaceName,
  campaigns,
  groups,
  suppressedCount,
}: EmailsReportProps) {
  const totals = campaigns.reduce(
    (acc, c) => ({
      delivered: acc.delivered + c.delivered,
      clicks: acc.clicks + c.uniqueClicks,
      emails: acc.emails + c.emailsSent,
      unsubscribed: acc.unsubscribed + c.unsubscribed,
    }),
    { delivered: 0, clicks: 0, emails: 0, unsubscribed: 0 },
  )
  const avgCtr =
    totals.delivered > 0 ? Math.round((totals.clicks / totals.delivered) * 1000) / 10 : 0

  return (
    <ReportLayout
      workspaceName={workspaceName}
      reportTitle="Email campaigns"
      period={`All time · ${campaigns.length} campaign${campaigns.length === 1 ? '' : 's'}`}
      filters={[
        `${totals.emails} email${totals.emails === 1 ? '' : 's'} sent`,
        `${suppressedCount} unsubscribed`,
      ]}
    >
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 6 }}>
        <StatTile label="Emails delivered" value={String(totals.delivered)} />
        <StatTile label="Unique clicks" value={String(totals.clicks)} />
        <StatTile label="Click-through rate" value={`${avgCtr}%`} />
        <StatTile label="Unsubscribed" value={String(totals.unsubscribed)} />
      </View>

      <Text style={reportStyles.sectionTitle}>Campaign performance</Text>
      <View
        style={{
          flexDirection: 'row',
          borderBottomWidth: 1,
          borderBottomColor: reportColors.border,
        }}
      >
        <Text style={{ ...headCell, flex: 3 }}>Campaign</Text>
        <Text style={{ ...headCell, flex: 1.4 }}>Status</Text>
        <Text style={{ ...headCell, flex: 1 }}>Sent</Text>
        <Text style={{ ...headCell, flex: 1.2 }}>Delivered</Text>
        <Text style={{ ...headCell, flex: 1 }}>Clicks</Text>
        <Text style={{ ...headCell, flex: 1 }}>CTR</Text>
        <Text style={{ ...headCell, flex: 1 }}>Unsubs</Text>
      </View>
      {campaigns.length === 0 && (
        <Text style={{ ...cell, color: reportColors.muted, paddingTop: 8 }}>
          No campaigns yet.
        </Text>
      )}
      {campaigns.map((c, i) => (
        <View
          key={i}
          style={{
            flexDirection: 'row',
            borderBottomWidth: 1,
            borderBottomColor: reportColors.border,
          }}
          wrap={false}
        >
          <Text style={{ ...cell, flex: 3 }}>
            {c.name}
            {c.kind === 'broadcast' ? '  (one-time)' : ''}
          </Text>
          <Text style={{ ...cell, flex: 1.4, color: reportColors.muted }}>{c.status}</Text>
          <Text style={{ ...cell, flex: 1 }}>{c.emailsSent}</Text>
          <Text style={{ ...cell, flex: 1.2 }}>{c.delivered}</Text>
          <Text style={{ ...cell, flex: 1 }}>{c.uniqueClicks}</Text>
          <Text style={{ ...cell, flex: 1 }}>{c.ctr}%</Text>
          <Text style={{ ...cell, flex: 1 }}>{c.unsubscribed}</Text>
        </View>
      ))}

      <Text style={reportStyles.sectionTitle}>Groups (audiences)</Text>
      <View
        style={{
          flexDirection: 'row',
          borderBottomWidth: 1,
          borderBottomColor: reportColors.border,
        }}
      >
        <Text style={{ ...headCell, flex: 2 }}>Group</Text>
        <Text style={{ ...headCell, flex: 4 }}>Definition</Text>
        <Text style={{ ...headCell, flex: 1.2 }}>Recipients</Text>
      </View>
      {groups.length === 0 && (
        <Text style={{ ...cell, color: reportColors.muted, paddingTop: 8 }}>
          No groups - campaigns send to all leads with an email.
        </Text>
      )}
      {groups.map((g, i) => (
        <View
          key={i}
          style={{
            flexDirection: 'row',
            borderBottomWidth: 1,
            borderBottomColor: reportColors.border,
          }}
          wrap={false}
        >
          <Text style={{ ...cell, flex: 2 }}>{g.name}</Text>
          <Text style={{ ...cell, flex: 4, color: reportColors.muted }}>{g.definition}</Text>
          <Text style={{ ...cell, flex: 1.2 }}>{g.recipients}</Text>
        </View>
      ))}
    </ReportLayout>
  )
}
