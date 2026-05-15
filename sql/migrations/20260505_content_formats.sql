-- =============================================================================
-- Content formats: the format library powering the content planner.
--
-- A "format" is one of the 35-ish templates the AI uses to write a piece of
-- content (e.g. Hero's Journey, Hot Take, Carousel: Personal Learning, Story:
-- Proof Drop). Each row encodes the format's structure, secret sauce, mad-lib
-- cadence references, gating rule, and which content_type it produces.
--
-- Seeded from sql/seeds/content_formats_seed.sql. Editable from the agency-side
-- admin UI later so format text can be tuned without a deploy.
--
-- Coverage axis (bucket) is independent of pillar. Pillars stay the existing
-- voice-routing concept. Buckets are the planner's coverage targets.
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE public.content_format_type AS ENUM (
    'short_form',
    'engagement_reel',
    'carousel',
    'story'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.content_bucket AS ENUM (
    'storytelling',
    'educational',
    'opinion',
    'proof_community'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.content_formats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Stable lookup key used in code (e.g. 'short_form.heros_journey'). Lets
  -- callers fetch a format without hard-coding its uuid.
  slug text NOT NULL UNIQUE,

  content_type public.content_format_type NOT NULL,
  name text NOT NULL,
  description text NOT NULL,

  -- The kind of raw material the format needs to land. The planner uses this
  -- to gate format selection: if no available answer satisfies the starting
  -- point, the format is skipped for that slot.
  starting_point text NOT NULL,

  -- Ordered beats for the AI to follow. Each entry is { label, description }.
  strategy_beats jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- One-paragraph rule that decides whether the format will pop or flop.
  -- Injected into the AI prompt as a hard rule, not a suggestion.
  secret_sauce text NOT NULL,

  -- Cadence reference for the AI. Each entry is { beat, lines: [string] }.
  -- Mad-libs are NOT fill-in-the-blank templates - they're rhythm guides.
  -- The AI is told never to copy them verbatim.
  mad_libs jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- The planner check that gates this format. Plain English, evaluated by
  -- the planner's scoring step against available raw material.
  gating_rule text NOT NULL,

  -- Voice routing - maps to the existing engine.ts Pillar enum where
  -- applicable. Null means "no specific pillar bias".
  pillar text CHECK (
    pillar IS NULL OR pillar IN ('educational', 'storytelling', 'authority', 'series', 'doubledown')
  ),

  -- Coverage axis - drives the planner's bucket targets per content_stage.
  bucket public.content_bucket NOT NULL,

  -- For video formats: target length in seconds (min/max).
  -- For carousel formats: target slide count (min/max).
  -- For story formats: target frame count (min/max).
  target_length_min integer,
  target_length_max integer,

  -- Default cooldown in posts. Overridable per-brand via
  -- brand_content_settings.format_overrides.
  cooldown_posts integer NOT NULL DEFAULT 5,

  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS content_formats_type_idx
  ON public.content_formats (content_type) WHERE is_active;

CREATE INDEX IF NOT EXISTS content_formats_bucket_idx
  ON public.content_formats (bucket) WHERE is_active;

CREATE INDEX IF NOT EXISTS content_formats_slug_idx
  ON public.content_formats (slug);

DROP TRIGGER IF EXISTS content_formats_set_updated_at ON public.content_formats;
CREATE TRIGGER content_formats_set_updated_at
  BEFORE UPDATE ON public.content_formats
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.content_formats ENABLE ROW LEVEL SECURITY;

-- Service role has full access. Agency staff query via API routes that use the
-- service role key under the hood; clients never read this table directly.
CREATE POLICY "content_formats_service_role_all"
  ON public.content_formats FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- =============================================================================
-- Done.
-- =============================================================================
