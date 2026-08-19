-- Search does not use its index, and never has.
--
-- listings_search_trgm_idx is a trigram index on the concatenation of title,
-- location and description. The feed queries the three columns separately --
-- PostgREST `or=(title.ilike.*,location.ilike.*,description.ilike.*)` -- and
-- Postgres can only use an expression index when the query contains that same
-- expression. It never does, so the index has been dead weight: written on
-- every insert and read by nothing.
--
-- EXPLAIN on production, with 56 active rows:
--
--   Bitmap Heap Scan on listings
--     Filter: (title ~~* '%acl%' OR location ~~* '%acl%' OR description ~~* '%acl%')
--     Rows Removed by Filter: 52
--     ->  Bitmap Index Scan on listings_status_idx
--
-- Every active listing is read and filtered in memory. Fine at 56 rows and a
-- sequential scan of the table at 50,000, on every keystroke, which is exactly
-- the load a search-first feed puts on it.
--
-- Three per-column indexes instead of one over the concatenation: it matches
-- the query the client already sends, so the planner can BitmapOr them, and it
-- needs no change to the API or the app.

create index if not exists listings_title_trgm_idx
  on public.listings using gin (title gin_trgm_ops);

create index if not exists listings_location_trgm_idx
  on public.listings using gin (location gin_trgm_ops);

create index if not exists listings_description_trgm_idx
  on public.listings using gin (description gin_trgm_ops);

-- Dead: nothing can use it, and it costs a write on every listing.
drop index if exists public.listings_search_trgm_idx;

-- The feed's default order, filtered to what the feed actually shows. Sorting
-- by event_date currently reads every active row before taking 20.
create index if not exists listings_active_event_date_idx
  on public.listings (status, event_date asc nulls last)
  where status = 'active';

analyze public.listings;
