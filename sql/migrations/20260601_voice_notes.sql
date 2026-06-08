-- =============================================================================
-- Voice notes for the question form + series form.
--
-- Each answer can carry a recorded audio note (uploaded to Supabase storage;
-- the public URL is stored here). The browser also transcribes the note live
-- into the text answer, so `answer` stays the searchable source of truth and
-- `audio_url` is the playable original the agency can listen back to.
-- =============================================================================

ALTER TABLE public.topics
  ADD COLUMN IF NOT EXISTS audio_url text;

ALTER TABLE public.series_answers
  ADD COLUMN IF NOT EXISTS audio_url text;
