-- =============================================================================
-- Capture pages: optional thank-you email to the submitter
--
-- When thank_you_enabled is true, the submit endpoint sends a customizable
-- email (subject + body) to the address the visitor entered, from the
-- connected Google account via Apps Script. The subject and body support
-- {{Field}} merge tokens that resolve to the submitter's answers (field label,
-- or the built-ins Name / Email / Phone).
--
-- All columns default to off / empty, so every existing capture page behaves
-- exactly as before until a thank-you email is configured + toggled on.
-- =============================================================================

ALTER TABLE public.capture_pages
  ADD COLUMN IF NOT EXISTS thank_you_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS thank_you_subject text,
  ADD COLUMN IF NOT EXISTS thank_you_body text;
