-- Agreements: client-authored contracts with placeholder fields, sent to a
-- lead for typed e-signature on a public token page (/agreement/<token>),
-- mirroring the hosted invoice page model.
--
-- Templates hold the reusable body with {{placeholder}} chips. An agreement
-- row freezes the FILLED body at send time so the signed document can never
-- drift when the template or the lead's properties change later.
--
-- Both tables are service-role only (RLS on, no policies): every read/write
-- goes through /api routes that run authorizeForClient, and the public
-- signing page resolves rows by unguessable token server-side.

create table if not exists agreement_templates (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  name text not null,
  -- Editor HTML with placeholder chips (<span data-ph="key">).
  body_html text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agreement_templates_client_idx
  on agreement_templates (client_id, updated_at desc);

create table if not exists agreements (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  template_id uuid references agreement_templates(id) on delete set null,
  lead_id uuid references leads(id) on delete set null,
  title text not null,
  -- Filled body, frozen at send time. Immutable once signed.
  body_html text not null,
  -- draft | sent | signed
  status text not null default 'draft',
  public_token uuid not null default gen_random_uuid(),
  recipient_name text,
  recipient_email text,
  -- Typed-name e-signature + audit trail.
  signer_name text,
  signed_at timestamptz,
  sign_ip text,
  sign_user_agent text,
  sent_at timestamptz,
  viewed_at timestamptz,
  -- Optional linked invoice (phase 2).
  payment_id uuid references payments(id) on delete set null,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists agreements_public_token_idx
  on agreements (public_token);
create index if not exists agreements_client_idx
  on agreements (client_id, created_at desc);
create index if not exists agreements_lead_idx
  on agreements (lead_id);

alter table agreement_templates enable row level security;
alter table agreements enable row level security;
