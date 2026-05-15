-- =============================================================================
-- capture_pages: per-page meeting duration for the slot-availability
-- picker.
--
-- When the page uses Google Meet or Zoom (where WE create the event
-- on submit), the visitor needs to be shown only the time slots that
-- aren't already booked. Knowing the duration lets the slot generator
-- step the right interval (30-min default) and the conflict checker
-- compare slot+duration windows against existing meetings.
-- =============================================================================

ALTER TABLE public.capture_pages
  ADD COLUMN IF NOT EXISTS meeting_duration_minutes integer NOT NULL DEFAULT 30
  CHECK (meeting_duration_minutes BETWEEN 5 AND 480);
