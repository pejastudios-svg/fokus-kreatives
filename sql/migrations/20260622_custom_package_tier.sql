-- =============================================================================
-- Custom package tier.
--
-- Adds a fourth selectable package, `custom`, alongside the three fixed tiers
-- (top/middle/lower -> Authority Engine / Growth / Foundation). A custom
-- client's content volume + campaign cap + CRM access live in `custom_config`
-- (jsonb); see src/lib/campaignTiers.ts CustomConfig for the shape:
--
--   {
--     "campaignsPerMonth": 1 | 2 | 4,
--     "crmAccess": "full" | "growth" | "none",
--     "content": {
--       "longForm":        { "weekly": n, "monthly": n },
--       "shortForm":       { "weekly": n, "monthly": n },
--       "engagementReels": { "weekly": n, "monthly": n },
--       "carousels":       { "weekly": n, "monthly": n },
--       "stories":         { "weekly": n, "monthly": n }
--     }
--   }
--
-- Long-form is only ever non-zero on custom plans; the fixed tiers leave it 0.
-- =============================================================================

-- Widen the package_tier CHECK to allow 'custom'. The original constraint was
-- created inline with the column, so Postgres named it clients_package_tier_check.
ALTER TABLE public.clients
  DROP CONSTRAINT IF EXISTS clients_package_tier_check;

ALTER TABLE public.clients
  ADD CONSTRAINT clients_package_tier_check
  CHECK (package_tier IS NULL OR package_tier IN ('top', 'middle', 'lower', 'custom'));

-- Per-client custom plan config. Null for the fixed tiers.
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS custom_config jsonb;

-- Campaigns snapshot the client's tier at creation; widen that CHECK too so a
-- custom client's campaigns can record tier_at_creation = 'custom'.
ALTER TABLE public.campaigns
  DROP CONSTRAINT IF EXISTS campaigns_tier_at_creation_check;

ALTER TABLE public.campaigns
  ADD CONSTRAINT campaigns_tier_at_creation_check
  CHECK (tier_at_creation IS NULL OR tier_at_creation IN ('top', 'middle', 'lower', 'custom'));

-- =============================================================================
-- Done.
-- =============================================================================
