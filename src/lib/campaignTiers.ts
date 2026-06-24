/**
 * Tier-driven campaign config. One source of truth for:
 *   - per-campaign deliverable counts
 *   - per-month campaign cap
 *   - cadence label (used in the create-form preview)
 *   - CRM access level
 *
 * Three fixed tiers (relabelled for clients as Foundation / Growth / Authority
 * Engine) plus a per-client `custom` tier. Long-form is NOT part of the fixed
 * tiers - it only appears when a client is on `custom` and the agency dials it
 * in. Everything downstream (planner, ClickUp campaign creation, exports) reads
 * a client's effective config through `resolveTierConfig`, so custom clients
 * flow through the exact same code paths as the fixed tiers.
 *
 * Monthly = perCampaign * campaignsPerMonth. Weekly (shown on the pricing card)
 * = monthly / 4. The fixed-tier numbers below reproduce the pricing card:
 *   Foundation: 1 campaign/mo  -> SF 8 / ER 4 / C 4 / St 4   (20/mo, 5/wk)
 *   Growth:     2 campaigns/mo -> SF 12 / ER 8 / C 8 / St 8  (36/mo, 9/wk)
 *   Authority:  4 campaigns/mo -> SF 24 / ER 20 / C 20 / St 20 (84/mo, 21/wk)
 */

/** The three fixed subscription tiers. Internal keys are kept as
 *  top/middle/lower for back-compat; clients see the labels below. */
export type PackageTier = 'top' | 'middle' | 'lower'

/** Every selectable package, including the per-client custom plan. */
export type TierKey = PackageTier | 'custom'

export interface ContentCounts {
  longForm: number
  shortForm: number
  engagementReels: number
  carousels: number
  stories: number
}

export interface TierConfig {
  cadence: 'weekly' | 'biweekly' | 'monthly'
  campaignsPerMonth: number
  /** Counts produced per campaign. Monthly total = these * campaignsPerMonth. */
  perCampaign: ContentCounts
}

export const TIER_CONFIG: Record<PackageTier, TierConfig> = {
  top: {
    cadence: 'weekly',
    campaignsPerMonth: 4,
    perCampaign: {
      longForm: 0,
      shortForm: 6,
      engagementReels: 5,
      carousels: 5,
      stories: 5,
    },
  },
  middle: {
    cadence: 'biweekly',
    campaignsPerMonth: 2,
    perCampaign: {
      longForm: 0,
      shortForm: 6,
      engagementReels: 4,
      carousels: 4,
      stories: 4,
    },
  },
  lower: {
    cadence: 'monthly',
    campaignsPerMonth: 1,
    perCampaign: {
      longForm: 0,
      shortForm: 8,
      engagementReels: 4,
      carousels: 4,
      stories: 4,
    },
  },
}

// --- Custom tier -----------------------------------------------------------

/** CRM access a custom client gets, mapped onto a fixed tier's access matrix:
 *  full -> Authority (top), growth -> Growth (middle), none -> Foundation
 *  (lower, portal-only). */
export type CrmAccess = 'full' | 'growth' | 'none'

/** One content type's volume on a custom plan. `weekly` is what the agency
 *  usually types; `monthly` is what actually drives generation (defaults to
 *  weekly * 4 but can be overridden independently). */
export interface CustomContentRow {
  weekly: number
  monthly: number
}

export interface CustomConfig {
  campaignsPerMonth: 1 | 2 | 4
  crmAccess: CrmAccess
  content: {
    longForm: CustomContentRow
    shortForm: CustomContentRow
    engagementReels: CustomContentRow
    carousels: CustomContentRow
    stories: CustomContentRow
  }
}

export function defaultCustomConfig(): CustomConfig {
  const zero = (): CustomContentRow => ({ weekly: 0, monthly: 0 })
  return {
    // Default to weekly: one campaign per week (4/month). Each week IS a
    // campaign, so the per-week numbers are the per-campaign deliverables.
    campaignsPerMonth: 4,
    crmAccess: 'none',
    content: {
      longForm: zero(),
      shortForm: zero(),
      engagementReels: zero(),
      carousels: zero(),
      stories: zero(),
    },
  }
}

// --- Resolution ------------------------------------------------------------

/** Minimal client shape needed to resolve a tier. */
export interface TierClientLike {
  package_tier?: TierKey | null
  custom_config?: CustomConfig | null
}

const cadenceForCap = (cap: number): TierConfig['cadence'] =>
  cap >= 4 ? 'weekly' : cap === 2 ? 'biweekly' : 'monthly'

/**
 * The effective TierConfig for any client - fixed or custom. Custom clients
 * collapse their monthly numbers into per-campaign counts (monthly / cap) so
 * the rest of the system treats them identically to a fixed tier. Falls back
 * to Foundation (lower) when no tier / no custom config is set.
 */
export function resolveTierConfig(client: TierClientLike): TierConfig {
  if (client.package_tier === 'custom' && client.custom_config) {
    const cc = client.custom_config
    const cap = cc.campaignsPerMonth || 1
    const per = (m: number) => Math.max(0, Math.round((m || 0) / cap))
    return {
      cadence: cadenceForCap(cap),
      campaignsPerMonth: cap,
      perCampaign: {
        longForm: per(cc.content.longForm.monthly),
        shortForm: per(cc.content.shortForm.monthly),
        engagementReels: per(cc.content.engagementReels.monthly),
        carousels: per(cc.content.carousels.monthly),
        stories: per(cc.content.stories.monthly),
      },
    }
  }
  const t = (client.package_tier ?? 'lower') as PackageTier
  return TIER_CONFIG[t] ?? TIER_CONFIG.lower
}

/** Monthly totals for a resolved config (per-campaign * cap). */
export function monthlyCounts(cfg: TierConfig): ContentCounts {
  const m = (n: number) => n * cfg.campaignsPerMonth
  return {
    longForm: m(cfg.perCampaign.longForm),
    shortForm: m(cfg.perCampaign.shortForm),
    engagementReels: m(cfg.perCampaign.engagementReels),
    carousels: m(cfg.perCampaign.carousels),
    stories: m(cfg.perCampaign.stories),
  }
}

/** Weekly totals for display (monthly / 4). */
export function weeklyCounts(cfg: TierConfig): ContentCounts {
  const mo = monthlyCounts(cfg)
  const w = (n: number) => Math.round((n / 4) * 10) / 10
  return {
    longForm: w(mo.longForm),
    shortForm: w(mo.shortForm),
    engagementReels: w(mo.engagementReels),
    carousels: w(mo.carousels),
    stories: w(mo.stories),
  }
}

/** The fixed tier whose CRM matrix a client should use. Custom clients map via
 *  their crmAccess; fixed tiers map to themselves. */
export function effectiveCrmTier(client: TierClientLike): PackageTier {
  if (client.package_tier === 'custom') {
    const access = client.custom_config?.crmAccess ?? 'none'
    return access === 'full' ? 'top' : access === 'growth' ? 'middle' : 'lower'
  }
  return (client.package_tier ?? 'lower') as PackageTier
}

/** Default number of monthly question-form topics = one per campaign. */
export function defaultTopicCount(client: TierClientLike): number {
  return resolveTierConfig(client).campaignsPerMonth
}

/**
 * Given the highest (campaign, month) pair this client has used so far,
 * suggest the next slot. Increment campaign within the tier cap; when it
 * hits the cap, roll month forward and reset campaign to 1. The returned
 * slot is just a default - the create form lets the agency override.
 */
export function nextCampaignSlot(args: {
  campaignsPerMonth: number
  lastCampaign: number | null
  lastMonth: number | null
}): { campaignNumber: number; monthNumber: number } {
  const cap = args.campaignsPerMonth > 0 ? args.campaignsPerMonth : 1

  if (args.lastCampaign == null || args.lastMonth == null) {
    return { campaignNumber: 1, monthNumber: 1 }
  }

  if (args.lastCampaign < cap) {
    return { campaignNumber: args.lastCampaign + 1, monthNumber: args.lastMonth }
  }
  return { campaignNumber: 1, monthNumber: args.lastMonth + 1 }
}

/** Client-facing labels for the fixed tiers (shown on the pricing card). */
export const TIER_LABEL: Record<PackageTier, string> = {
  top: 'Authority Engine',
  middle: 'Growth',
  lower: 'Foundation',
}

/** Labels including the custom plan. */
export const TIER_KEY_LABEL: Record<TierKey, string> = {
  ...TIER_LABEL,
  custom: 'Custom',
}
