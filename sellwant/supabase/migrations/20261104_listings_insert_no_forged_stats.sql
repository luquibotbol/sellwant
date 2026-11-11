-- A seller could write the going rate when creating a listing.
--
-- best_offer_cents and offer_count are derived: offers_touch_stats recomputes
-- them from the offers table after every change to it. The column grants on
-- UPDATE stop a client from writing them to an existing listing, which is why
-- the 2026-08-18 migration looked like it had closed this. It had closed half.
--
-- INSERT is different. listings keeps a table-level INSERT grant, and a
-- table-level grant means column-level restrictions are never consulted, so a
-- brand-new listing could arrive carrying whatever numbers its author liked.
-- The first offer on it would overwrite them -- but until then the public feed
-- showed "most anyone will pay: $9,999.99" against zero offers, on the one
-- figure this marketplace asks strangers to trust.
--
-- Verified against production before writing this, signed in as a fixture
-- seller: POST /rest/v1/listings with best_offer_cents=999999 and
-- offer_count=42 returned the row, and an anonymous read returned it too. The
-- row was deleted straight afterwards.
--
-- The fix goes in the policy, not in a column grant. Moving INSERT to
-- column-level grants is the obvious reflex and the wrong one: PostgREST
-- decides whether a table is insertable from the TABLE privilege, so every
-- insert would 401 while Postgres itself accepted the grant -- the same trap
-- that broke page_views in 20260820_page_views_rpc.sql. A WITH CHECK can say
-- "these two fields must be at their defaults" without touching the grant.
--
-- createListing() never sends either column, so the client is unaffected.
--
-- Not addressed here, and writable on insert by the same mechanism: `status`
-- and `created_at`. A listing inserted as 'sold' or 'cancelled' is invisible
-- to anon (listings_select_anon requires 'active'), so it is no use for
-- manufacturing demand; backdating or future-dating created_at only reorders
-- the author's own listing. Worth tightening, but a different PR.

drop policy if exists listings_insert_own on public.listings;
create policy listings_insert_own on public.listings
for insert to authenticated
with check (
  user_id = auth.uid()
  and not is_suspended()
  -- Derived columns. A new listing has no offers, so both start at their
  -- defaults; the trigger owns them from the first offer onwards.
  and best_offer_cents is null
  and offer_count = 0
);
