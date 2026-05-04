'use client'

import { createContext, useContext, useMemo, type ReactNode } from 'react'

// CRM-side permission model. Three real roles, each owning a different
// type of decision:
//   admin    : invites/removes people, changes roles  ("people decisions")
//   manager  : designs the workspace - custom fields, status options,
//              capture pages, CRM settings              ("workspace decisions")
//   employee : does the operational work - leads, meetings, payments,
//              field VALUES (but not field DEFINITIONS) ("work decisions")
//
// `isClientUser` is the client-portal owner of this CRM. They get
// admin-equivalent access on their own workspace regardless of CrmRole.

export type CrmRole = 'admin' | 'manager' | 'employee'

export interface CrmRoleState {
  role: CrmRole
  isClientUser: boolean
  // The display name of the current CRM workspace (the client's brand
  // name, e.g. "Acme Corp"). Used by reports / exports so they're
  // titled with the client's name. Falls back to "Workspace" when the
  // layout hasn't loaded the client info yet.
  workspaceName: string
  // Convenience flags - same source of truth, less duplication at call sites.
  isAdmin: boolean
  isManagerOrAdmin: boolean
  // Permission helpers. These are the canonical answers - UI and any
  // future API gates should use these names so the model is consistent.
  canManageTeam: boolean // invite, change role, remove
  canEditWorkspace: boolean // custom fields, status options, capture pages, settings
  canEditRecords: boolean // leads, meetings, payments
}

const CrmRoleContext = createContext<CrmRoleState | null>(null)

export function CrmRoleProvider({
  role,
  isClientUser,
  workspaceName,
  children,
}: {
  role: CrmRole
  isClientUser: boolean
  workspaceName: string
  children: ReactNode
}) {
  const value = useMemo<CrmRoleState>(() => {
    const isAdmin = role === 'admin' || isClientUser
    const isManagerOrAdmin = isAdmin || role === 'manager'
    return {
      role,
      isClientUser,
      workspaceName,
      isAdmin,
      isManagerOrAdmin,
      canManageTeam: isAdmin,
      canEditWorkspace: isManagerOrAdmin,
      canEditRecords: true, // every CRM role can edit operational records
    }
  }, [role, isClientUser, workspaceName])
  return (
    <CrmRoleContext.Provider value={value}>{children}</CrmRoleContext.Provider>
  )
}

// Read the current CRM role state. Returns a safe default (employee, no
// edit) when used outside a provider so unrelated UI doesn't crash if
// it ever ends up rendered without the layout wrapper.
export function useCrmRole(): CrmRoleState {
  const ctx = useContext(CrmRoleContext)
  if (ctx) return ctx
  return {
    role: 'employee',
    isClientUser: false,
    workspaceName: 'Workspace',
    isAdmin: false,
    isManagerOrAdmin: false,
    canManageTeam: false,
    canEditWorkspace: false,
    canEditRecords: true,
  }
}
