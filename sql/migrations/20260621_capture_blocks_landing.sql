-- Landing-page builder for capture pages.
--
-- 1) A new 'landing' layout that renders edge-to-edge (no card), composed
--    from a stack of content blocks instead of just the fixed
--    headline/description/form.
-- 2) A `blocks` jsonb array holding those drag-ordered content elements
--    (heading, text, button, image, embed, divider, spacer, logos, card,
--    and the lead form itself). Empty array = the layout falls back to the
--    page's headline/description + form so existing pages are unaffected.

alter table public.capture_pages
  add column if not exists blocks jsonb not null default '[]'::jsonb;

-- Extend the layout_template CHECK to allow 'landing'. Drop the old
-- constraint (added in 20260615) and recreate it with the new value.
alter table public.capture_pages
  drop constraint if exists capture_pages_layout_template_check;

alter table public.capture_pages
  add constraint capture_pages_layout_template_check
    check (layout_template in (
      'compact', 'split-right', 'split-left', 'hero-overlay',
      'banner-top', 'minimal', 'landing'
    ));
