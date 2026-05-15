-- =============================================================================
-- Content stage state: the brand's progress through the content tiers.
--
-- THREE tier-like concepts coexist in this app - keep them straight:
--   1. clients.package_tier      ('top' | 'middle' | 'lower')
--      Subscription level. Drives campaign cadence + deliverable counts.
--   2. engine.ts Tier             ('beginner' | 'mid' | 'advanced')
--      Voice tier inside the prompt framework. Drives pillar gating and
--      voice register inside scripts.
--   3. content_stage_state         ('foundation' | 'growing' | 'established')
--      Where the brand is in their content roll-out. Drives the planner's
--      coverage targets (more storytelling early, more variety later) and
--      the format library's bucket weighting.
--
-- Stage advancement is auto-PROPOSED when criteria are met (foundation
-- saturation - About Me / Hero's / Wins) but only takes effect when an
-- admin or manager confirms. Notifications fire on proposal.
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE public.content_stage AS ENUM (
    'foundation',
    'growing',
    'established'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.content_stage_state (
  client_id uuid PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,

  current_stage public.content_stage NOT NULL DEFAULT 'foundation',

  -- Set when the saturation criteria for the next stage are met. Cleared
  -- when a manager/admin confirms (advances current_stage) or dismisses.
  proposed_stage public.content_stage,
  proposed_at timestamptz,
  proposed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,

  confirmed_at timestamptz,
  confirmed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,

  -- Snapshot of saturation progress, refreshed by the planner whenever it
  -- runs. Example shape:
  --   {
  --     "about_me_count": 1,
  --     "heros_or_personal_learning_count": 2,
  --     "win_or_before_after_count": 1,
  --     "total_posts": 12,
  --     "next_stage": "growing",
  --     "criteria_met": ["about_me", "heros", "win", "total_posts_floor"]
  --   }
  criteria_progress jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- The proposal banner is dismissible per-client. If dismissed, the planner
  -- won't re-propose until criteria_progress changes substantially.
  dismissed_at timestamptz,
  dismissed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,

  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS content_stage_state_set_updated_at ON public.content_stage_state;
CREATE TRIGGER content_stage_state_set_updated_at
  BEFORE UPDATE ON public.content_stage_state
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.content_stage_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "content_stage_state_service_role_all"
  ON public.content_stage_state FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- =============================================================================
-- Done.
-- =============================================================================
