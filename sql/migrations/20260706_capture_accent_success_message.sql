-- =============================================================================
-- capture_pages: button accent color + custom success message
--
-- accent_color drives both the Submit button and the "Access Your
-- Free Resource" follow-up button on the public capture page. One
-- shared color so the two CTAs feel like the same brand voice.
--
-- success_message is the green confirmation banner shown after a
-- successful submission. Currently hardcoded to "You're in! Let's
-- Keep Going."; this lets each page customize it.
--
-- Both default to null at the column level so existing pages render
-- unchanged - the renderer falls back to the previous hardcoded
-- defaults when these are null/empty.
-- =============================================================================

ALTER TABLE public.capture_pages
  ADD COLUMN IF NOT EXISTS accent_color text,
  ADD COLUMN IF NOT EXISTS success_message text;
