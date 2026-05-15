-- =============================================================================
-- Brand social handles for the [DESCRIPTION] section of long-form scripts.
--
-- Until now the AI was fabricating handles by guessing from the brand name
-- (e.g. brand="Fokus Kreativez" -> AI invents "@fokuskreativez" on every
-- platform). That's the same fabrication bug as inventing URLs - both
-- produce false claims about the brand. Fix: store handles explicitly,
-- thread them into the prompt, and tell the AI to OMIT the line entirely
-- when a handle isn't supplied.
--
-- Stored as separate text columns rather than a JSONB blob so partial
-- updates and indexing stay simple. Empty/null = "omit this line from the
-- description".
--
-- Bio + audience description are added at the same time because the
-- Think Media-style description format also needs a one-paragraph
-- "who this is for" summary that is brand-level, not script-level.
-- =============================================================================

ALTER TABLE public.brand_content_settings
  ADD COLUMN IF NOT EXISTS instagram_handle text,
  ADD COLUMN IF NOT EXISTS tiktok_handle    text,
  ADD COLUMN IF NOT EXISTS youtube_handle   text,
  ADD COLUMN IF NOT EXISTS linkedin_handle  text,
  ADD COLUMN IF NOT EXISTS x_handle         text,
  ADD COLUMN IF NOT EXISTS brand_bio        text,
  ADD COLUMN IF NOT EXISTS audience_blurb   text,
  ADD COLUMN IF NOT EXISTS default_hashtags text[];

-- =============================================================================
-- Done.
-- =============================================================================
