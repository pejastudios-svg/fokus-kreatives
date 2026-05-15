-- =============================================================================
-- Mid-roll CTA support for long-form videos. Two layers:
--
--   default_long_form_cta on brand_content_settings:
--     The brand's evergreen mid-roll CTA. Applies to every long-form unless
--     a per-slot override is set. Can be a polished line ("Want my free
--     framework? Link in bio") OR an idea the AI wraps in voice
--     ("send free playbook PDF, link in bio" -> AI conversationalizes it).
--
--   midroll_cta on content_plan_slots:
--     Per-slot override. Falls through to brand default when null.
--
-- The M4 long-form generator inserts a MID-ROLL CTA beat between INFLECTION
-- (pain peak) and RISING ACTION (failed attempts), where viewer engagement
-- is highest before the natural drop-off.
-- =============================================================================

ALTER TABLE public.brand_content_settings
  ADD COLUMN IF NOT EXISTS default_long_form_cta text;

ALTER TABLE public.content_plan_slots
  ADD COLUMN IF NOT EXISTS midroll_cta text;

-- =============================================================================
-- Done.
-- =============================================================================
