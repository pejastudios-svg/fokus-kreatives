-- Lead magnets can now be either an external URL or an uploaded file
-- (PDF / doc) stored in the 'uploads' bucket. The file's public URL is kept
-- in the existing lead_magnet_url column; this flag tells the public page and
-- the delivery email how to treat it (open a link vs open + download a file,
-- and whether to attach the file to the lead-magnet email).
-- Existing pages default to 'url' so their behaviour is unchanged.

alter table capture_pages
  add column if not exists lead_magnet_type text not null default 'url';
