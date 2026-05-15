-- =============================================================================
-- Structured story prompts: store per-frame production briefs instead of a
-- single text+visual blob. Each frame carries (beat, capture, on_screen_text,
-- voiceover) so the team can execute without ambiguity.
--
-- Old prompt_text / visual_direction columns stay (filled with derived
-- summary text on new rows; populated as-is on legacy rows) so the panel
-- can render either shape without a schema-version flag.
--
-- who_films: tags whether the AGENCY can produce in-house, or the CLIENT
-- has to film something (talking head, on-location, etc.).
-- =============================================================================

ALTER TABLE public.story_queue_items
  ADD COLUMN IF NOT EXISTS frames jsonb;

ALTER TABLE public.story_queue_items
  ADD COLUMN IF NOT EXISTS who_films text
    CHECK (who_films IS NULL OR who_films IN ('agency', 'client'));

-- =============================================================================
-- Done.
-- =============================================================================
