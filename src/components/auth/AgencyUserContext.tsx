'use client'

import { createContext, useContext, useMemo, type ReactNode } from 'react'

// Agency-side user context. AuthGuard fetches the role once on mount
// (via /api/me/landing) and exposes it here so any agency page can
// read role-based capabilities INSTANTLY without doing its own fetch.
//
// Removing the per-page `loadUserRole` round-trip is what kills the
// loading flicker on Add Client / Delete / Archive buttons - those
// derive from `role` directly so they render correctly on first paint.
//
// Server-side enforcement still lives on each /api/* route. This
// context only governs UI visibility / convenience, never security.

export type AgencyRole = 'admin' | 'manager' | 'employee' | 'client' | null

export interface AgencyUserState {
  id: string | null
  email: string | null
  role: AgencyRole
  // Permissions, derived once. Pages should prefer these over
  // role-string equality checks.
  canInviteTeam: boolean // admin OR manager (admins can change roles too)
  canManageRoles: boolean // admin only - change role / remove member
  canCreateClients: boolean // admin only
  canArchiveClients: boolean // admin OR manager
  canDeleteClients: boolean // admin only - destructive
}

const AgencyUserContext = createContext<AgencyUserState | null>(null)

export function AgencyUserProvider({
  id,
  email,
  role,
  children,
}: {
  id: string | null
  email: string | null
  role: AgencyRole
  children: ReactNode
}) {
  const value = useMemo<AgencyUserState>(() => {
    const isAdmin = role === 'admin'
    const isManager = role === 'manager'
    const isAdminOrManager = isAdmin || isManager
    return {
      id,
      email,
      role,
      canInviteTeam: isAdminOrManager,
      canManageRoles: isAdmin,
      canCreateClients: isAdmin,
      canArchiveClients: isAdminOrManager,
      canDeleteClients: isAdmin,
    }
  }, [id, email, role])
  return (
    <AgencyUserContext.Provider value={value}>
      {children}
    </AgencyUserContext.Provider>
  )
}

export function useAgencyUser(): AgencyUserState {
  const ctx = useContext(AgencyUserContext)
  if (ctx) return ctx
  // Safe default for unrelated UI rendered outside the provider.
  // Pages that actually do role-gated work are always inside AuthGuard.
  return {
    id: null,
    email: null,
    role: null,
    canInviteTeam: false,
    canManageRoles: false,
    canCreateClients: false,
    canArchiveClients: false,
    canDeleteClients: false,
  }
}
