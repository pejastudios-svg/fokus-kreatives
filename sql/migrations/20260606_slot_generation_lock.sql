-- =============================================================================
-- Per-slot generation lock columns. Prevents double-click on Generate /
-- Regenerate from firing two simultaneous Pro generations on the same slot.
--
-- Use:
--   1. Acquire lock atomically:
--        UPDATE content_plan_slots
--           SET generation_lock_at = NOW(), generation_lock_token = $token
--         WHERE id = $slotId
--           AND (generation_lock_at IS NULL
--                OR generation_lock_at < NOW() - INTERVAL '3 minutes')
--      If 0 rows updated, another generation is in flight - reject the call.
--
--   2. Release in finally (token-matched so we never clear someone else's lock):
--        UPDATE content_plan_slots
--           SET generation_lock_at = NULL, generation_lock_token = NULL
--         WHERE id = $slotId AND generation_lock_token = $token
--
-- The 3-minute stale-lock TTL covers worst-case long-form: Pro generation
-- (~30-60s) + person rewrite (Pro, ~30s) + polish (Pro, ~30s) + auto-tighten
-- (Flash, ~10s) + mid-roll retry (Pro, ~30s) + grammar polish (Flash-Lite,
-- ~10s) + checklist eval (Pro, ~30s) = up to ~2.5 minutes. 3 minutes is
-- enough buffer; locks older than that are presumed dead.
-- =============================================================================

ALTER TABLE public.content_plan_slots
  ADD COLUMN IF NOT EXISTS generation_lock_at    timestamptz,
  ADD COLUMN IF NOT EXISTS generation_lock_token text;

-- =============================================================================
-- Done.
-- =============================================================================
