-- =============================================================================
-- Approval items: native image / video uploads + multi-asset + carousel.
--
-- approval_items previously only carried a single `url`. We now also support
-- uploading multiple Cloudinary-hosted assets per item (single-asset by
-- default, optional carousel view when there are 2+).
--
-- Columns added:
--   attachments  jsonb   - array of asset metadata. Empty = legacy URL-only.
--   is_carousel  boolean - whether to render attachments as a carousel.
--   kind         text    - 'url' | 'image' | 'video' | 'mixed' (display hint).
--
-- Each entry inside `attachments` follows this shape (non-binding, validated
-- in app code):
--   {
--     "public_id": "approvals/abc/foo",
--     "secure_url": "https://res.cloudinary.com/.../foo.jpg",
--     "resource_type": "image" | "video",
--     "format": "jpg" | "mp4" | ...,
--     "width": 1080,
--     "height": 1920,
--     "duration": 12.34,         -- videos only
--     "bytes": 184320,
--     "name": "original-filename.jpg"
--   }
-- =============================================================================

ALTER TABLE public.approval_items
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS is_carousel boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'url';

-- 'url' is the only legal value when attachments is empty; the rest follow
-- whether the operator uploaded images, videos, or a mix. Keep this
-- permissive at the DB level so future kinds (e.g. 'audio', 'doc') don't
-- require a migration; app code is the source of truth for valid values.

-- Existing rows already have url-only items, so the defaults above leave
-- their behavior unchanged.

-- =============================================================================
-- Done.
-- =============================================================================
