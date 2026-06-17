-- Store each signer's rendered signature as a PNG (data URL) captured in the
-- browser at signing time. The signed-copy PDF embeds this image so it shows
-- the actual handwriting-style signature the signer saw - the Apps Script
-- HTML->PDF renderer has no cursive fonts, so text alone falls back to plain
-- italic. Small (a few KB); it's literally "what they signed".

alter table agreement_signers add column if not exists signature_image text;
