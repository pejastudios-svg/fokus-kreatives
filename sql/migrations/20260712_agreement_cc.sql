-- CC recipients: people who get a copy of the agreement by email (send +
-- signed copy) but do NOT sign. Stored as a plain email array - no tokens,
-- they only ever receive the public view link.

alter table agreements
  add column if not exists cc_emails text[] not null default '{}';
