-- =============================================================================
-- Story redesign: stories become a CARRIER (10-20s video OR 3-slide carousel)
-- holding a compressed version of an existing short-form / engagement-reel /
-- carousel format. The 4 story-native formats (Proof Drop, Day Moment,
-- Behind the Curtain, Vulnerable Share) are deactivated - their use cases
-- are absorbed by compressing the equivalent short-form / engagement-reel
-- format into the story carrier. Question for Audience stays as a true
-- native sticker format (renamed for clarity).
--
-- New columns on story_queue_items:
--   carrier:           'video' | 'slides' | 'sticker'  (null on legacy rows)
--   source_format_id:  the underlying format being compressed (FK to
--                      content_formats). Null for sticker carrier.
--
-- Legacy rows (carrier=null) keep rendering with the old multi-frame shape
-- via a fallback in StoryQueuePanel. New rows render with the beat shape
-- (HOOK / VALUE / CTA).
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE public.story_carrier AS ENUM ('video', 'slides', 'sticker');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.story_queue_items
  ADD COLUMN IF NOT EXISTS carrier public.story_carrier;

ALTER TABLE public.story_queue_items
  ADD COLUMN IF NOT EXISTS source_format_id uuid REFERENCES public.content_formats(id) ON DELETE SET NULL;

-- Deactivate the story-native formats whose use cases are now handled by
-- compressing existing formats. Question for Audience renamed for clarity
-- and stays active as the only true sticker-driven story.
UPDATE public.content_formats
SET is_active = false
WHERE slug IN (
  'story.proof_drop',
  'story.day_moment',
  'story.behind_the_curtain',
  'story.vulnerable_share'
);

-- Keep Question for Audience active (it's the sticker carrier).
UPDATE public.content_formats
SET is_active = true,
    name = 'Sticker Question',
    description = 'Single-frame story with a sticker poll/question. Audience taps the sticker; no voiceover, no carousel - pure engagement.'
WHERE slug = 'story.question_for_audience';

-- =============================================================================
-- Done.
-- =============================================================================
