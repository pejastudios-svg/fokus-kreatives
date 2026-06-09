-- Invoices: upgrade a `payments` row into a full invoice with line items,
-- a generated .docx, and a draft -> scheduled -> sent lifecycle.
--
-- A payment with is_invoice=false stays the simple record it always was.
-- When is_invoice=true the extra columns below drive the invoice builder,
-- the DOCX generator, and the scheduled auto-send.

alter table payments
  -- The toggle. true = full invoice (line items + docx + send lifecycle).
  add column if not exists is_invoice boolean not null default false,
  -- [{ description, quantity, unit_price }]
  add column if not exists line_items jsonb not null default '[]'::jsonb,
  -- Send lifecycle, separate from payment `status` (pending/paid/overdue):
  --   'draft'     - created, editable, not going out yet
  --   'scheduled' - locked in to auto-send on send_on
  --   'sent'      - delivered to the bill-to
  add column if not exists send_status text,
  -- Date the invoice should auto-send (defaults to the due date).
  add column if not exists send_on date,
  add column if not exists sent_at timestamptz,
  -- Bill-to (prefilled from the linked lead, editable on the invoice).
  add column if not exists bill_to_name text,
  add column if not exists bill_to_email text,
  add column if not exists issue_date date,
  -- Tax as a percent (e.g. 7.5), discount as an absolute amount in `currency`.
  add column if not exists tax_rate numeric not null default 0,
  add column if not exists discount numeric not null default 0,
  -- Public URL of the generated .docx in the `uploads` bucket.
  add column if not exists doc_url text;

-- The dispatch cron scans for invoices due to send. Index the hot predicate.
create index if not exists payments_invoice_send_idx
  on payments (send_status, send_on)
  where is_invoice = true;
