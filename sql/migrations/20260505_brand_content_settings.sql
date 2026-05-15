-- =============================================================================
-- Brand content settings: per-client overrides for the content planner.
--
-- Tier defaults (set in code based on content_stage_state.current_stage)
-- always apply unless a row here overrides them. Coverage targets must sum
-- to 100 if all four are set; partial overrides are allowed (null means
-- "use stage default for this bucket").
--
-- Format overrides are a free-form jsonb keyed by content_formats.slug:
--   {
--     "short_form.heros_journey": { "cooldown_posts": 14 },
--     "engagement_reel.poll_reel": { "target_length_max": 25 }
--   }
--
-- One row per client. Created lazily on first override.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.brand_content_settings (
  client_id uuid PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,

  -- Coverage targets (percent, 0-100). Null = use stage default.
  bucket_target_storytelling integer
    CHECK (bucket_target_storytelling IS NULL OR (bucket_target_storytelling BETWEEN 0 AND 100)),
  bucket_target_educational integer
    CHECK (bucket_target_educational IS NULL OR (bucket_target_educational BETWEEN 0 AND 100)),
  bucket_target_opinion integer
    CHECK (bucket_target_opinion IS NULL OR (bucket_target_opinion BETWEEN 0 AND 100)),
  bucket_target_proof_community integer
    CHECK (bucket_target_proof_community IS NULL OR (bucket_target_proof_community BETWEEN 0 AND 100)),

  -- Per-format overrides keyed by content_formats.slug.
  format_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Allow strong language in scripts (overrides profile.voice.profanity_level
  -- if explicitly set). Null = defer to brand profile. Kept here too so the
  -- planner can read a single settings row without joining brand profile.
  allow_strong_language boolean,

  -- Monthly token budget in raw token count (input + output combined).
  -- null = no cap. monthly_token_warn_at fires a notification when usage
  -- crosses the warn threshold, but doesn't block generation.
  monthly_token_budget integer,
  monthly_token_warn_at integer,

  -- Plan horizon - how many months ahead the planner generates slots for.
  -- Default 1 (current month). Editable up to 3 in the planner UI.
  plan_horizon_months integer NOT NULL DEFAULT 1
    CHECK (plan_horizon_months BETWEEN 1 AND 3),

  -- View-only share link config. Null = sharing disabled by default; the
  -- client must explicitly create a share link to enable it.
  share_link_default_ttl_days integer NOT NULL DEFAULT 90
    CHECK (share_link_default_ttl_days BETWEEN 1 AND 365),

  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS brand_content_settings_set_updated_at ON public.brand_content_settings;
CREATE TRIGGER brand_content_settings_set_updated_at
  BEFORE UPDATE ON public.brand_content_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.brand_content_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "brand_content_settings_service_role_all"
  ON public.brand_content_settings FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- =============================================================================
-- Done.
-- =============================================================================
