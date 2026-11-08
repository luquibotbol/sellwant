-- Cancelling a deal did not end access to the other person's contact details.
--
-- contact_details is readable by its owner or `shares_lock_in(profile_id)`,
-- and shares_lock_in returned true for ANY lock_ins row between the two
-- people -- cancelled ones included. create_lock_in lets any signed-in user
-- open a deal on any active listing at its price, and advance_deal lets either
-- party cancel at once, after which the listing goes straight back to active.
-- So a stranger could lock, cancel, and keep permanent live read access to the
-- poster's phone, signup email and payment handles, including numbers changed
-- after the cancellation. The privacy page promises these go only to "the two
-- people in an agreed deal", and offers_select (202611050003) already excludes
-- cancelled deals for the same reason.
--
-- Reproduced on the production catalog replayed locally with every migration:
-- stranger B read poster A's new phone number after B had cancelled.
--
-- shares_lock_in lives in the dashboard-built base schema, not in any earlier
-- migration, so this is its first definition in the repo. Its only caller is
-- the contact_select policy. The one-time exposure during a live deal is the
-- product's unilateral lock-in design and is unchanged here.

begin;

create or replace function public.shares_lock_in(other uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from lock_ins l
    where l.state <> 'cancelled'
      and ((l.buyer_id = auth.uid() and l.seller_id = other)
        or (l.seller_id = auth.uid() and l.buyer_id = other))
  );
$$;

-- Supabase's default privileges grant EXECUTE to anon and authenticated by
-- name, so revoking from PUBLIC alone would leave both in place.
revoke all on function public.shares_lock_in(uuid) from public, anon;
grant execute on function public.shares_lock_in(uuid) to authenticated;

commit;
