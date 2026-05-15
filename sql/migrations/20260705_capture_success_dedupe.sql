-- =============================================================================
-- Capture pages: customizable success button + duplicate-email policy
--
-- - success_button_text: per-page label for the CTA shown after a
--   successful submission. Defaults to "Access Your Free Resource"
--   at render-time when null, so existing pages keep the original copy.
-- - block_duplicate_emails: when true, the public submit endpoint
--   rejects a second submission from an email that has already been
--   captured on this page. Default false (allow + dedupe leads).
-- =============================================================================

ALTER TABLE public.capture_pages
  ADD COLUMN IF NOT EXISTS success_button_text text,
  ADD COLUMN IF NOT EXISTS block_duplicate_emails boolean NOT NULL DEFAULT false;

-- Index to make the "has this email submitted to this page?" lookup
-- cheap. Only useful when block_duplicate_emails=true; harmless
-- otherwise. lower(email) so the check is case-insensitive.
CREATE INDEX IF NOT EXISTS capture_submissions_page_email_idx
  ON public.capture_submissions (capture_page_id, lower(email))
  WHERE email IS NOT NULL;

-- field_labels: snapshot of the page's field id→label map at
-- submission time. Lets the submissions tab + email render
-- human-readable labels even after the page's fields are renamed
-- or removed later (without this, old submissions show their raw
-- field ids like "field-1766430496663").
ALTER TABLE public.capture_submissions
  ADD COLUMN IF NOT EXISTS field_labels jsonb;
