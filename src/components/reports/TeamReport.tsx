import { View, Text, StyleSheet } from '@react-pdf/renderer'
import { ReportLayout, reportColors as C } from './ReportLayout'

// Team roster report. Active members + pending invites.

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
  // Member cols
  colName: { width: '30%' },
  colEmail: { width: '34%' },
  colRole: { width: '18%' },
  colJoined: { width: '18%', textAlign: 'right' },
  // Invite cols (slightly different ordering)
  colInvName: { width: '24%' },
  colInvEmail: { width: '32%' },
  colInvRole: { width: '14%' },
  colInvSent: { width: '15%', textAlign: 'right' },
  colInvExpires: { width: '15%', textAlign: 'right' },
  // Pills
  pill: {
    fontSize: 8,
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 99,
    alignSelf: 'flex-start',
    fontFamily: 'Helvetica-Bold',
  },
  pillAdmin: { color: '#B91C1C', backgroundColor: '#FEE2E2' },
  pillManager: { color: '#1D4ED8', backgroundColor: '#DBEAFE' },
  pillEmployee: { color: '#475569', backgroundColor: '#E2E8F0' },
  pillExpired: { color: '#B91C1C', backgroundColor: '#FEE2E2' },
  pillExpiring: { color: '#B45309', backgroundColor: '#FEF3C7' },
  empty: {
    fontSize: 10,
    color: C.muted,
    fontStyle: 'italic',
    paddingVertical: 14,
    textAlign: 'center',
  },
})

const ROLE_PILL = {
  admin: styles.pillAdmin,
  manager: styles.pillManager,
  employee: styles.pillEmployee,
} as const

export interface TeamReportMember {
  name: string
  email: string
  role: 'admin' | 'manager' | 'employee'
  joinedDate: string
}

export interface TeamReportInvite {
  name: string
  email: string
  role: 'admin' | 'manager' | 'employee'
  sentDate: string
  expiresDate: string
}

export interface TeamReportBodyProps {
  metrics: {
    totalMembers: number
    admins: number
    managers: number
    employees: number
    pendingInvites: number
  }
  members: TeamReportMember[]
  invites: TeamReportInvite[]
  // "Now" timestamp the caller observed at click time. Passed in so the
  // template stays pure (lint forbids Date.now() inside the renderer).
  generatedAtMs: number
}

export interface TeamReportProps extends TeamReportBodyProps {
  workspaceName: string
  filters: string[]
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

function rolePill(role: 'admin' | 'manager' | 'employee') {
  const style = ROLE_PILL[role] || styles.pillEmployee
  return (
    <Text style={[styles.pill, style]}>
      {role.charAt(0).toUpperCase() + role.slice(1)}
    </Text>
  )
}

export function TeamReportBody({
  metrics,
  members,
  invites,
  generatedAtMs,
}: TeamReportBodyProps) {
  return (
    <>
      <View style={styles.kpiGrid} wrap={false}>
        <View style={styles.kpi}>
          <Text style={styles.kpiLabel}>Total members</Text>
          <Text style={styles.kpiValue}>{metrics.totalMembers}</Text>
          <Text style={styles.kpiSub}>active in workspace</Text>
        </View>
        <View style={styles.kpi}>
          <Text style={styles.kpiLabel}>Admins</Text>
          <Text style={styles.kpiValue}>{metrics.admins}</Text>
          <Text style={styles.kpiSub}>full access</Text>
        </View>
        <View style={styles.kpi}>
          <Text style={styles.kpiLabel}>Managers</Text>
          <Text style={styles.kpiValue}>{metrics.managers}</Text>
          <Text style={styles.kpiSub}>workspace ops</Text>
        </View>
        <View style={styles.kpi}>
          <Text style={styles.kpiLabel}>Pending</Text>
          <Text style={styles.kpiValue}>{metrics.pendingInvites}</Text>
          <Text style={styles.kpiSub}>not yet accepted</Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>
        Active members ({members.length})
      </Text>
      {members.length === 0 ? (
        <Text style={styles.empty}>No active members.</Text>
      ) : (
        <View>
          <View style={styles.tableHeader} fixed>
            <Text style={[styles.tableHeaderCell, styles.colName]}>Name</Text>
            <Text style={[styles.tableHeaderCell, styles.colEmail]}>Email</Text>
            <Text style={[styles.tableHeaderCell, styles.colRole]}>Role</Text>
            <Text style={[styles.tableHeaderCell, styles.colJoined]}>
              Joined
            </Text>
          </View>
          {members.map((m, idx) => (
            <View key={idx} style={styles.tableRow} wrap={false}>
              <Text style={[styles.tableCell, styles.colName]}>{m.name}</Text>
              <Text style={[styles.tableCell, styles.colEmail]}>{m.email}</Text>
              <View style={styles.colRole}>{rolePill(m.role)}</View>
              <Text style={[styles.tableCell, styles.colJoined]}>
                {fmtDate(m.joinedDate)}
              </Text>
            </View>
          ))}
        </View>
      )}

      <Text style={styles.sectionTitle}>
        Pending invites ({invites.length})
      </Text>
      {invites.length === 0 ? (
        <Text style={styles.empty}>No pending invites.</Text>
      ) : (
        <View>
          <View style={styles.tableHeader} fixed>
            <Text style={[styles.tableHeaderCell, styles.colInvName]}>
              Invitee
            </Text>
            <Text style={[styles.tableHeaderCell, styles.colInvEmail]}>
              Email
            </Text>
            <Text style={[styles.tableHeaderCell, styles.colInvRole]}>
              Role
            </Text>
            <Text style={[styles.tableHeaderCell, styles.colInvSent]}>
              Sent
            </Text>
            <Text style={[styles.tableHeaderCell, styles.colInvExpires]}>
              Expires
            </Text>
          </View>
          {invites.map((inv, idx) => {
            const expiresMs = new Date(inv.expiresDate).getTime()
            const expired = expiresMs < generatedAtMs
            const expiringSoon =
              !expired &&
              expiresMs - generatedAtMs < 2 * 24 * 60 * 60 * 1000
            return (
              <View key={idx} style={styles.tableRow} wrap={false}>
                <Text style={[styles.tableCell, styles.colInvName]}>
                  {inv.name || '—'}
                </Text>
                <Text style={[styles.tableCell, styles.colInvEmail]}>
                  {inv.email}
                </Text>
                <View style={styles.colInvRole}>{rolePill(inv.role)}</View>
                <Text style={[styles.tableCell, styles.colInvSent]}>
                  {fmtDate(inv.sentDate)}
                </Text>
                <View style={styles.colInvExpires}>
                  {expired ? (
                    <Text style={[styles.pill, styles.pillExpired]}>
                      Expired
                    </Text>
                  ) : expiringSoon ? (
                    <Text style={[styles.pill, styles.pillExpiring]}>
                      {fmtDate(inv.expiresDate)}
                    </Text>
                  ) : (
                    <Text style={styles.tableCell}>
                      {fmtDate(inv.expiresDate)}
                    </Text>
                  )}
                </View>
              </View>
            )
          })}
        </View>
      )}
    </>
  )
}

export function TeamReport({
  workspaceName,
  filters,
  metrics,
  members,
  invites,
  generatedAtMs,
}: TeamReportProps) {
  return (
    <ReportLayout
      workspaceName={workspaceName}
      reportTitle="Team Report"
      period="Workspace roster"
      filters={filters}
      title={`${workspaceName} - Team Report`}
    >
      <TeamReportBody
        metrics={metrics}
        members={members}
        invites={invites}
        generatedAtMs={generatedAtMs}
      />
    </ReportLayout>
  )
}
