-- =============================================================================
-- push_subscriptions: per-device Web Push subscriptions.
--
-- One row per (user, browser device). When a user opts into browser
-- notifications, the browser hands us a PushSubscription object with
-- a unique endpoint + a pair of keys (p256dh, auth) we need to sign
-- + encrypt payloads. We store all three so the server can fan out
-- notifications via the web-push library.
--
-- A user can have multiple subscriptions (laptop + phone + tablet);
-- the unique constraint on `endpoint` makes the subscribe call
-- idempotent - a re-subscribe from the same browser overwrites the
-- old row in place.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

  -- Push service URL the browser gave us. Unique per device so a
  -- repeat subscribe collapses to a single row instead of stacking.
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,

  -- Optional context for debugging + diagnostic emails when a
  -- subscription goes 410 (expired/revoked).
  user_agent text,

  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx
  ON public.push_subscriptions (user_id);

-- Service-role-only. Writes happen through API routes that verify
-- the calling user owns the subscription; reads happen server-side
-- only for the fan-out step.
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "push_subscriptions_service_role"
  ON public.push_subscriptions;
CREATE POLICY "push_subscriptions_service_role"
  ON public.push_subscriptions FOR ALL TO service_role
  USING (true) WITH CHECK (true);
