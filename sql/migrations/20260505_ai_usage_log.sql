-- =============================================================================
-- AI usage log: per-call token + cost tracking.
--
-- Every call to generateScript() (and any other AI-bound generation) writes
-- one row here. Drives:
--   - Per-brand monthly token budget enforcement (warn + soft-block)
--   - Cost dashboards
--   - Debugging which routes burn the most credit
--
-- Cost is computed at write-time from a small in-code price table (see
-- src/lib/ai/pricing.ts). Recomputing later is fine since input/output
-- tokens are stored as raw counts.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.ai_usage_log (
  id bigserial PRIMARY KEY,

  -- Nullable because some routes (e.g. ad-hoc test endpoints) aren't tied
  -- to a specific client. Set null on client deletion to preserve history.
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,

  -- Who triggered the call. Null for system / cron jobs.
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,

  -- Logical route name, NOT the URL. Examples:
  --   'planner.script.generate'
  --   'planner.story_queue.refill'
  --   'question_form.generate'
  --   'longform.package'
  --   'carousel.repurpose'
  -- Used for cost-per-route dashboards.
  route text NOT NULL,

  -- Provider + model so we can price correctly when models change.
  provider text NOT NULL CHECK (provider IN ('gemini', 'groq')),
  model text NOT NULL,
  quality text NOT NULL CHECK (quality IN ('high', 'standard', 'cheap')),

  -- Raw token counts. Cached_tokens is for Gemini's context cache (the
  -- portion of input tokens served from cache at ~25% the price).
  -- Null when the provider didn't return usage stats (Groq sometimes
  -- doesn't expose this).
  input_tokens integer,
  output_tokens integer,
  cached_tokens integer,

  -- Computed at write time from src/lib/ai/pricing.ts. USD with 6 decimal
  -- places (Pro output at $10/1M tokens means 1 token = $0.00001).
  cost_usd numeric(10, 6),

  success boolean NOT NULL,
  error_code text,
  duration_ms integer,

  -- Optional metadata blob for the call (slot id, content type, etc.).
  -- Kept loose so we can add fields without migrations.
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_usage_log_client_idx
  ON public.ai_usage_log (client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_usage_log_route_idx
  ON public.ai_usage_log (route, created_at DESC);

-- Used by the budget-check helper that sums tokens for a client across the
-- current calendar month.
CREATE INDEX IF NOT EXISTS ai_usage_log_client_month_idx
  ON public.ai_usage_log (client_id, created_at)
  WHERE client_id IS NOT NULL;

ALTER TABLE public.ai_usage_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_usage_log_service_role_all"
  ON public.ai_usage_log FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- =============================================================================
-- Done.
-- =============================================================================
