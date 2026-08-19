-- The test suite cannot clean up after itself any more, and it is leaking
-- listings into the public feed.
--
-- Its afterAll removes the listings it made. Every one of them has a lock_in
-- by then (the tests exercise the deal flow), and the policy added in
-- "tighten_listing_edit_and_delete" refuses to remove a listing somebody has
-- committed to -- correctly, since that would erase the counterparty's record.
-- RLS filters rather than throwing, so the cleanup reported success and did
-- nothing, and the rows stayed active and public. 18 of 23 active listings on
-- production were test rows before this was noticed.
--
-- Rather than loosening that policy, this adds a cleanup path that can only
-- ever touch fixture data: listings owned by an @example.edu account. Real
-- deals stay protected, because a real account cannot match.

create or replace function public.purge_test_listing(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  owner_email text;
begin
  select u.email into owner_email
  from listings l join auth.users u on u.id = l.user_id
  where l.id = p_id;

  if owner_email is null then
    return; -- already gone
  end if;

  -- The whole safety of this function is this line.
  if owner_email not like '%@example.edu' then
    raise exception 'purge_test_listing only removes fixture data (owner: %)', owner_email;
  end if;

  delete from lock_ins where listing_id = p_id;
  delete from listings where id = p_id;
end;
$$;

revoke all on function public.purge_test_listing(uuid) from public, anon;
grant execute on function public.purge_test_listing(uuid) to authenticated;

-- One-off: clear what has already leaked into the live feed.
do $$
declare r record;
begin
  for r in
    select l.id from listings l join auth.users u on u.id = l.user_id
    where u.email like '%@example.edu' and l.title like 'Test ticket%'
  loop
    perform purge_test_listing(r.id);
  end loop;
end $$;
