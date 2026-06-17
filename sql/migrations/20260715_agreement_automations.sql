-- Phase 3b: status triggers. A rule binds a template to a lead status:
-- when any lead enters that status, a DRAFT agreement is staged from the
-- template (lead attached, signer prefilled) and the team is notified to
-- review & send. Staging never auto-sends - a human always confirms.

create table if not exists agreement_automations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  template_id uuid not null references agreement_templates(id) on delete cascade,
  -- The lead status VALUE (custom_fields status option value) that fires it.
  trigger_status text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (template_id, trigger_status)
);

create index if not exists agreement_automations_client_idx
  on agreement_automations (client_id, trigger_status);

alter table agreement_automations enable row level security;
