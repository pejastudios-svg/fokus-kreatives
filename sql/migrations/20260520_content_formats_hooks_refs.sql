-- =============================================================================
-- Hook bank + reference scripts per format. Two new jsonb columns:
--
--   hook_patterns:
--     [{ "pattern": "Today I'm [doing X] as a [role].", "example": "Today
--        I'm going on a business trip as a software engineer in Big Tech." }]
--     The AI is told to PICK or ADAPT one of these patterns when writing
--     the hook, instead of freelancing the opening line. This kills the
--     "Finally feeling the camera-shy struggle" failure mode.
--
--   reference_scripts:
--     [{ "label": "Day 1 - business trip", "script": "...full transcript..." }]
--     Few-shot examples of what good output looks like for this format.
--     Loaded into the system prompt so the AI sees a 9/10 example before
--     generating. Format library can carry 2-3 references per format.
-- =============================================================================

ALTER TABLE public.content_formats
  ADD COLUMN IF NOT EXISTS hook_patterns jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.content_formats
  ADD COLUMN IF NOT EXISTS reference_scripts jsonb NOT NULL DEFAULT '[]'::jsonb;

-- =============================================================================
-- Done.
-- =============================================================================
