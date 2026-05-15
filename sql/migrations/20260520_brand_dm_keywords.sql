-- =============================================================================
-- DM keywords on brand_content_settings: a list of keywords the brand wants
-- the AI to use for DM CTAs in stories (and eventually scripts in M4).
--
-- A real brand picks 1-2 keywords and uses them consistently so audiences
-- associate them with specific deliverables ("DM me PLAYBOOK"). The AI
-- shouldn't invent a fresh keyword per story (today's behavior - SYSTEM,
-- RECIPE, PLAN, FRAMEWORK, SKELETON, BREAKTHROUGH...). Setting this once
-- forces consistency across every CTA the AI writes.
--
-- Empty array = no preference; AI picks contextually.
-- =============================================================================

ALTER TABLE public.brand_content_settings
  ADD COLUMN IF NOT EXISTS dm_keywords text[];

-- =============================================================================
-- Done.
-- =============================================================================
