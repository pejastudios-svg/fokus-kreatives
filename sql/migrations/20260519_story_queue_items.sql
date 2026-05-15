-- =============================================================================
-- Story queue items: dateless story prompts that staff pull from reactively.
--
-- Stories (Instagram/Facebook 24h ephemeral) don't fit a calendar slot - the
-- agency posts them whenever something happens. So the planner refills a
-- queue of un-dated prompts and the team consumes them as they go.
--
-- Any prompt can be promoted to a dated calendar slot via `pinned_to_date`
-- (and the corresponding `content_plan_slots` row is what shows on the
-- calendar). Consumed prompts persist for history but no longer count as
-- "available" for refill calculations.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.story_queue_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,

  -- One of the 5 story formats from content_formats. Nullable to handle the
  -- edge case where a format gets retired but old prompts persist.
  format_id uuid REFERENCES public.content_formats(id) ON DELETE SET NULL,

  prompt_text text NOT NULL,

  -- Optional staging instructions. e.g. "screenshot the analytics dashboard
  -- with the X axis label visible".
  visual_direction text,

  -- topic ids this prompt draws from. For most story formats this is a
  -- single topic answer (Proof Drop pulls a `proof` answer, Vulnerable
  -- Share pulls a `failed_attempt` etc.).
  raw_material_refs jsonb NOT NULL DEFAULT '[]'::jsonb,

  consumed_at timestamptz,
  consumed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,

  -- When set, the prompt has been promoted to a dated calendar slot. The
  -- pinned_slot_id is the corresponding content_plan_slots row. Stories
  -- pinned to a date show on the calendar as a story stream card.
  pinned_to_date date,
  pinned_slot_id uuid REFERENCES public.content_plan_slots(id) ON DELETE SET NULL,

  -- The staff-supplied seed text used to generate this prompt, if any.
  -- Kept for the regenerate-from-seed path.
  seed_text text,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS story_queue_items_client_idx
  ON public.story_queue_items (client_id, created_at DESC);

-- "Available" = not consumed. Used by the refill threshold check.
CREATE INDEX IF NOT EXISTS story_queue_items_available_idx
  ON public.story_queue_items (client_id) WHERE consumed_at IS NULL;

ALTER TABLE public.story_queue_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "story_queue_items_service_role_all" ON public.story_queue_items;
CREATE POLICY "story_queue_items_service_role_all"
  ON public.story_queue_items FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- =============================================================================
-- Done.
-- =============================================================================
