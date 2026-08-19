-- A seller could bid on their own listing.
--
-- The offer board is the one number this marketplace asks strangers to trust,
-- and nothing stopped the person who benefits from it posting into it. A bare
-- INSERT put a row under "most anyone will pay" that no buyer ever made.
-- Countering IS legitimate -- answering a real bid is how a seller negotiates
-- -- so the rule is not "the poster may not offer" but "the poster may only
-- reply to somebody else's offer".
--
-- Verified against production before writing this: signed in as the listing's
-- own poster, POST /rest/v1/offers returned 201 and the row then rendered on
-- the public board under "Most anyone will pay".

-- Reads offers from inside a policy on offers, so it must be SECURITY DEFINER:
-- a policy that queries its own table recurses (42P17) otherwise.
create or replace function public.offer_parent_ok(
  p_parent uuid, p_listing uuid, p_from uuid
) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from offers o
    where o.id = p_parent
      and o.listing_id = p_listing
      -- Countering yourself would rebuild the same fake ladder one row deeper.
      and o.from_user <> p_from
  );
$$;

drop policy if exists offers_insert on public.offers;
create policy offers_insert on public.offers for insert to authenticated
with check (
  from_user = auth.uid()
  and not is_suspended()
  and exists (
    select 1 from listings l
    where l.id = offers.listing_id and l.status = 'active'
  )
  and (
    -- Anyone but the poster may open an offer.
    from_user <> (select l.user_id from listings l where l.id = offers.listing_id)
    -- The poster may only counter, and only a real offer on this listing.
    or (parent_offer_id is not null
        and offer_parent_ok(parent_offer_id, offers.listing_id, from_user))
  )
);

-- Separately: authenticated held UPDATE on every column of offers, and
-- offers_update_listing_owner declared no WITH CHECK -- so Postgres reused its
-- USING clause and a seller could rewrite the amount on a buyer's offer as
-- long as it stayed on their listing. The app only ever writes status here
-- (decline, withdraw); changing an amount is an INSERT that supersedes, and
-- accept_offer is a SECURITY DEFINER RPC that grants do not touch.
revoke update on public.offers from authenticated;
grant update (status) on public.offers to authenticated;

drop policy if exists offers_update_listing_owner on public.offers;
create policy offers_update_listing_owner on public.offers for update to authenticated
using (
  exists (select 1 from listings l
          where l.id = offers.listing_id and l.user_id = auth.uid())
)
with check (
  exists (select 1 from listings l
          where l.id = offers.listing_id and l.user_id = auth.uid())
);
