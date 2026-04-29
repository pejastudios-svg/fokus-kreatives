-- =============================================================================
-- Durable email outbox.
--
-- Replaces the fire-and-forget fetch('/api/notify-email') pattern. Routes
-- enqueue rows here in the same request that wrote the comment / approval /
-- whatever, and a cron worker drains the table - retrying with backoff so a
-- transient Apps Script blip can't lose a notification.
--
-- Idempotency: callers pass a stable `idempotency_key` (e.g. comment-id +
-- ":comment-broadcast"). A unique index swallows duplicate enqueues at the
-- DB layer, so a retried POST never double-fires the same email.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  payload jsonb NOT NULL,
  idempotency_key text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'dead')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

-- Unique only on the non-null subset so callers without a stable key still
-- enqueue normally.
CREATE UNIQUE INDEX IF NOT EXISTS email_outbox_idempotency_key_uq
  ON public.email_outbox (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Worker picks up rows where status='pending' and next_attempt_at <= now().
-- Index makes that filter cheap as the table grows.
CREATE INDEX IF NOT EXISTS email_outbox_due_idx
  ON public.email_outbox (next_attempt_at)
  WHERE status = 'pending';

-- =============================================================================
-- Done.
-- =============================================================================
