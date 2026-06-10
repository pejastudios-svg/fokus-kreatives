-- Per-send log for outbound email, powering the quota display in Settings.
-- Gmail has no "remaining quota" API for SMTP, so we count our own sends in
-- a rolling 24h window against the provider cap (~500/day per Gmail account).
-- Apps Script sends are logged too as a fallback signal next to the live
-- MailApp.getRemainingDailyQuota() readout.

create table if not exists email_send_log (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete set null,
  -- 'smtp' (sent from the client's connected Gmail) | 'apps_script'
  channel text not null,
  -- email type (invoice_sent, meeting_invitee_confirmation, ...)
  type text,
  created_at timestamptz not null default now()
);

create index if not exists email_send_log_channel_time_idx
  on email_send_log (channel, created_at);
create index if not exists email_send_log_client_channel_time_idx
  on email_send_log (client_id, channel, created_at);
