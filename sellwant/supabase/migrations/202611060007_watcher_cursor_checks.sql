-- Preserve the applied watcher migration; PostgreSQL rejects counted-regex
-- bounds above 255. Check cursor length separately from allowed characters.
BEGIN;
SET LOCAL ROLE postgres;

ALTER TABLE public.agent_watches DROP CONSTRAINT agent_watches_scan_cursor_check;
ALTER TABLE public.agent_watches DROP CONSTRAINT agent_watches_offer_cursor_check;
ALTER TABLE public.agent_watches ADD CONSTRAINT agent_watches_scan_cursor_bounded
  CHECK (scan_cursor IS NULL OR (char_length(scan_cursor) BETWEEN 1 AND 1024 AND scan_cursor ~ '^[A-Za-z0-9_-]+$'));
ALTER TABLE public.agent_watches ADD CONSTRAINT agent_watches_offer_cursor_bounded
  CHECK (offer_cursor IS NULL OR (char_length(offer_cursor) BETWEEN 1 AND 1024 AND offer_cursor ~ '^[A-Za-z0-9_-]+$'));

NOTIFY pgrst,'reload schema';
COMMIT;
