-- Email marketing: Mailchimp-style value-email campaigns inside the CRM.
--
-- Groups segment leads (property rules + hand-picked ids). Campaigns send
-- AI-generated or custom emails to a group on freely customizable day rules,
-- through the existing outbox (client Gmail SMTP first, Apps Script fallback).
-- Every recipient send carries a token that drives click tracking and the
-- one-click unsubscribe. Unsubscribed addresses land in email_suppressions -
-- the lead row itself never moves or changes.

-- ===== Groups (saved audiences) =====
create table if not exists email_groups (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  name text not null,
  -- {statuses: ['Hot'], rules: [{field:'source', op:'eq'|'contains', value:'webinar'}]}
  -- Rules match against leads.data jsonb keys. Empty filters + empty lead_ids
  -- means "all leads with an email".
  filters jsonb not null default '{}'::jsonb,
  -- Hand-picked leads added by name, on top of (or instead of) the rules.
  lead_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists email_groups_client_idx on email_groups (client_id);
alter table email_groups enable row level security;

-- ===== Campaigns =====
create table if not exists email_campaigns (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  name text not null,
  -- recurring = AI generates on schedule_rules; broadcast = one email, once.
  kind text not null default 'recurring' check (kind in ('recurring', 'broadcast')),
  status text not null default 'draft'
    check (status in ('draft', 'active', 'paused', 'completed')),
  group_id uuid references email_groups(id) on delete set null,
  -- {weekdays:[2,4], send_time:'09:00', date_from:'2026-07-01', date_to:null,
  --  specific_dates:[], cadence:'weekly'|'every_eligible_day'}
  schedule_rules jsonb not null default '{}'::jsonb,
  -- Skip human review. Safety breakers (caps, backpressure, failure
  -- auto-pause) still apply - the toggle only skips the approval step.
  auto_approve boolean not null default false,
  -- Which CTA library entries (settings jsonb ids) this campaign rotates.
  cta_ids text[] not null default '{}',
  ps_mode text not null default 'ai' check (ps_mode in ('ai', 'custom', 'none')),
  -- Optional steer for the AI ("focus on pricing objections this month").
  topic_focus text,
  -- Why the system paused it (failure spike, quota) - shown in the UI.
  paused_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists email_campaigns_client_idx on email_campaigns (client_id, status);
alter table email_campaigns enable row level security;

-- ===== Emails (one row per scheduled/sent email of a campaign) =====
create table if not exists email_campaign_emails (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references email_campaigns(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  scheduled_for date,
  send_time text,
  subject text not null default '',
  preheader text not null default '',
  hook_title text not null default '',
  -- Ordered content blocks:
  -- [{id, type:'text', content}, {id, type:'image', url, alt},
  --  {id, type:'embed', url, title}, {id, type:'button', label, url}]
  blocks jsonb not null default '[]'::jsonb,
  ps text not null default '',
  -- The CTA(s) frozen at generation time: [{id, label, text, url}]
  cta_snapshot jsonb not null default '[]'::jsonb,
  -- topics.id rows the AI pulled from - dedup so material is never reused.
  source_refs uuid[] not null default '{}',
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'sending', 'sent', 'failed', 'canceled')),
  approved_at timestamptz,
  sent_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A cron bug can fire twice; this makes duplicate generation a no-op.
  unique (campaign_id, scheduled_for)
);

create index if not exists email_campaign_emails_client_idx
  on email_campaign_emails (client_id, status);
create index if not exists email_campaign_emails_due_idx
  on email_campaign_emails (status, scheduled_for);
alter table email_campaign_emails enable row level security;

-- ===== Per-recipient sends =====
create table if not exists email_campaign_sends (
  id uuid primary key default gen_random_uuid(),
  email_id uuid not null references email_campaign_emails(id) on delete cascade,
  campaign_id uuid not null references email_campaigns(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  lead_id uuid references leads(id) on delete set null,
  to_email text not null,
  -- Drives /api/e/c/{token} click redirects and /unsubscribe/{token}.
  token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  status text not null default 'queued'
    check (status in ('queued', 'sent', 'failed', 'unsubscribed')),
  -- Set when the outbox row was enqueued - the daily-cap pump uses NULL here
  -- to find sends still waiting for capacity.
  enqueued_at timestamptz,
  sent_at timestamptz,
  first_clicked_at timestamptz,
  click_count int not null default 0,
  error text,
  created_at timestamptz not null default now(),
  -- A lead can never receive the same email twice.
  unique (email_id, lead_id)
);

create index if not exists email_campaign_sends_email_idx on email_campaign_sends (email_id);
create index if not exists email_campaign_sends_client_idx
  on email_campaign_sends (client_id, created_at);
alter table email_campaign_sends enable row level security;

-- ===== Click log (per-link breakdown) =====
create table if not exists email_link_clicks (
  id uuid primary key default gen_random_uuid(),
  send_id uuid not null references email_campaign_sends(id) on delete cascade,
  url text not null,
  -- 'cta:1', 'button', 'embed', 'social:instagram' - which block was clicked.
  label text,
  clicked_at timestamptz not null default now()
);

create index if not exists email_link_clicks_send_idx on email_link_clicks (send_id);
alter table email_link_clicks enable row level security;

-- ===== Suppressions (the unsubscribe source of truth) =====
create table if not exists email_suppressions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  email text not null,
  reason text not null default 'unsubscribed'
    check (reason in ('unsubscribed', 'bounced', 'complaint', 'manual')),
  -- Which send triggered it (tells the UI "unsubscribed from <email title>").
  source_send_id uuid references email_campaign_sends(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (client_id, email)
);

create index if not exists email_suppressions_client_idx on email_suppressions (client_id);
alter table email_suppressions enable row level security;

-- ===== Per-client settings =====
-- {ctas:[{id,label,text,url}], ps_mode:'ai', ps_pool:[], socials:[{platform,url}],
--  footer_address:'', daily_send_cap:100, monthly_generation_cap:60}
alter table clients add column if not exists email_marketing_settings jsonb;
