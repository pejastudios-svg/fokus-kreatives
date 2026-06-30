-- =============================================================================
-- Active story campaign on brand_content_settings: the launch offer a brand is
-- currently running. Launch-intent stories pull their offer / event date /
-- reply keyword from HERE rather than inventing one, so auto-generated launch
-- stories stay inside the anti-invention rules.
--
-- Shape (jsonb):
--   {
--     "offer":      "Free ManyChat workshop",   -- what the audience gets
--     "event_date": "2026-01-14",               -- optional; gates auto-launch
--     "keyword":    "14",                        -- reply keyword (falls back to dm_keywords)
--     "mechanic":   "reply" | "dm",             -- default "reply"
--     "active":     true                         -- master on/off switch
--   }
--
-- Null / active=false / event_date in the past => no active campaign, so the
-- planner falls back to teach/prove/engage/bts_invite (no auto-launch).
-- =============================================================================

ALTER TABLE public.brand_content_settings
  ADD COLUMN IF NOT EXISTS story_campaign jsonb;

-- =============================================================================
-- Done.
-- =============================================================================
