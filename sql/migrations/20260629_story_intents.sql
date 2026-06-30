-- =============================================================================
-- Story Set v2: flexible intents + launch campaigns + default CTA mechanic.
--
-- A story is no longer a fixed 4-beat sequence. It's a Story Set: an `intent`
-- selecting a variable-length (3-8) sequence of frames. The frame array keeps
-- living in the existing `frames` jsonb column (the element shape evolved from
-- StoryBeat{label,...} to StoryFrameV2{role,text_blocks,visual,...}); the
-- renderer normalizes element shape via normalizeFrame() so NO backfill is
-- required.
--
-- These columns are additive and nullable so legacy + current rows keep
-- rendering unchanged (intent=null => no badge, old shape => normalized).
--
--   intent:    'teach' | 'prove' | 'launch' | 'engage' | 'bts_invite'
--   campaign:  launch-only {offer, event_date, keyword, mechanic} snapshot
--   mechanic:  'reply' (default for stories now) | 'dm'
--
-- text + CHECK (not an enum) matches the who_films precedent and avoids the
-- enum-mutation friction noted for the carrier type. v2 stories keep
-- carrier='video'; `intent` is the real discriminator now.
-- =============================================================================

ALTER TABLE public.story_queue_items
  ADD COLUMN IF NOT EXISTS intent text
    CHECK (intent IS NULL OR intent IN
      ('teach', 'prove', 'launch', 'engage', 'bts_invite'));

ALTER TABLE public.story_queue_items
  ADD COLUMN IF NOT EXISTS campaign jsonb;

ALTER TABLE public.story_queue_items
  ADD COLUMN IF NOT EXISTS mechanic text
    CHECK (mechanic IS NULL OR mechanic IN ('reply', 'dm'));

-- =============================================================================
-- Done.
-- =============================================================================
