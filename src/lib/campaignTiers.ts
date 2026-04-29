/**
 * Tier-driven campaign config. One source of truth for:
 *   - per-campaign deliverable counts
 *   - per-month campaign cap
 *   - cadence label (used in the create-form preview)
 *
 * `lower` is monthly so its cap is 1; `top` is weekly so its cap is 4.
 * `middle` is biweekly with 2 campaigns per month (1st and 3rd week).
 */

export type PackageTier = 'top' | 'middle' | 'lower'

export interface TierConfig {
  cadence: 'weekly' | 'biweekly' | 'monthly'
  campaignsPerMonth: number
  perCampaign: {
    longForm: number
    shortForm: number
    engagementReels: number
    carousels: number
    stories: number
  }
}

export const TIER_CONFIG: Record<PackageTier, TierConfig> = {
  top: {
    cadence: 'weekly',
    campaignsPerMonth: 4,
    perCampaign: {
      longForm: 1,
      shortForm: 5,
      engagementReels: 5,
      carousels: 5,
      stories: 5,
    },
  },
  middle: {
    cadence: 'biweekly',
    campaignsPerMonth: 2,
    perCampaign: {
      longForm: 1,
      shortForm: 4,
      engagementReels: 4,
      carousels: 4,
      stories: 0,
    },
  },
  lower: {
    cadence: 'monthly',
    campaignsPerMonth: 1,
    perCampaign: {
      longForm: 1,
      shortForm: 5,
      engagementReels: 5,
      carousels: 5,
      stories: 0,
    },
  },
}

/**
 * Given the highest (campaign, month) pair this client has used so far,
 * suggest the next slot. Increment campaign within the tier cap; when it
 * hits the cap, roll month forward and reset campaign to 1. The returned
 * slot is just a default - the create form lets the agency override.
 */
export function nextCampaignSlot(args: {
  tier: PackageTier | null
  lastCampaign: number | null
  lastMonth: number | null
}): { campaignNumber: number; monthNumber: number } {
  const cap = args.tier ? TIER_CONFIG[args.tier].campaignsPerMonth : 1

  if (args.lastCampaign == null || args.lastMonth == null) {
    return { campaignNumber: 1, monthNumber: 1 }
  }

  if (args.lastCampaign < cap) {
    return { campaignNumber: args.lastCampaign + 1, monthNumber: args.lastMonth }
  }
  return { campaignNumber: 1, monthNumber: args.lastMonth + 1 }
}

export const TIER_LABEL: Record<PackageTier, string> = {
  top: 'Top (Authority Engine)',
  middle: 'Middle (Growth)',
  lower: 'Lower (Foundation)',
}
