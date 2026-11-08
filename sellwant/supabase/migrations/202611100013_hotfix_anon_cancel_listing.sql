-- HOTFIX: anyone with the public anon key could take down any listing.
--
-- Production's cancel_listing (read from the live catalog on 2026-11-09) is
-- SECURITY DEFINER, executable by PUBLIC (acl `=X/postgres`), and checks
-- ownership with `if v.user_id <> auth.uid() then raise`. For an anonymous
-- caller auth.uid() is NULL, so that comparison is NULL rather than true, the
-- exception is skipped, and the listing is set to cancelled. The anon key is
-- public by design (it ships in the JS bundle), so this needs no account:
-- POST /rest/v1/rpc/cancel_listing with any active listing id.
--
-- 202611050001 fixes this too, but that migration also replaces the trading
-- RPCs the current client depends on, so it has to ship together with the new
-- client. This one is independent: safe to apply on its own, today, before any
-- deploy. The live client only ever calls cancel_listing while signed in.
--
-- It is idempotent, and harmless to apply before or after 202611050001.

begin;

create or replace function public.cancel_listing(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v listings; v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  select * into v from listings where id = p_id for update;
  if v.id is null then
    raise exception 'no such listing';
  end if;
  if v.user_id is distinct from v_uid then
    raise exception 'not your listing' using errcode = '42501';
  end if;
  -- A locked listing is mid-handoff. Pulling it from under the other person
  -- is the deal screen's job to cancel, not this one's.
  if v.status <> 'active' then
    raise exception 'this listing is % and cannot be taken down here', v.status;
  end if;
  update listings set status = 'cancelled' where id = p_id;
end;
$$;

-- Supabase grants EXECUTE to anon by name as well as to PUBLIC; revoke both.
revoke all on function public.cancel_listing(uuid) from public, anon;
grant execute on function public.cancel_listing(uuid) to authenticated, service_role;

-- Same exposure, no harm today: refresh_offer_stats only recomputes the true
-- going rate, but anon can call it on any listing and take row locks. Its one
-- legitimate caller is the offers_touch_stats trigger, which runs as definer.
revoke all on function public.refresh_offer_stats(uuid) from public, anon, authenticated;

-- Same audit, same class: three more definer functions the live catalog lets
-- the public call. Each is also fixed by a later migration that ships with the
-- new client (202611050003, 202611100011); these lines are the subset that is
-- safe on today's production, so they go out now.

-- accept_offer and advance_deal in the live catalog have the same NULL-unsafe
-- party checks (`<> auth.uid()`, `not (v_is_buyer or v_is_seller)`) and the
-- same default PUBLIC EXECUTE. Replayed on the catalog export: anon accepted a
-- third user's offer (opening both people's contact details to each other) and
-- walked another pair's deal to confirmed (bumping both reputations and
-- marking the listing sold). A signed-in caller always has a sub, so taking
-- EXECUTE away from anon closes the NULL path without touching the bodies the
-- live client depends on; 202611050001 replaces the bodies later.
do $$
begin
  if to_regprocedure('public.accept_offer(uuid)') is not null then
    revoke all on function public.accept_offer(uuid) from public, anon;
    grant execute on function public.accept_offer(uuid) to authenticated, service_role;
  end if;
  if to_regprocedure('public.advance_deal(uuid,text)') is not null then
    revoke all on function public.advance_deal(uuid, text) from public, anon;
    grant execute on function public.advance_deal(uuid, text) to authenticated, service_role;
  end if;
end $$;

-- purge_test_listing deletes a fixture listing and its deals. Its only caller
-- check is the JWT email claim ending in @example.edu, which a sign-up
-- asserts itself, confirmed or not. Only the service key should run it.
do $$
begin
  if to_regprocedure('public.purge_test_listing(uuid)') is not null then
    revoke all on function public.purge_test_listing(uuid) from public, anon, authenticated;
    grant execute on function public.purge_test_listing(uuid) to service_role;
  end if;
end $$;

-- reset_completed_deals rewrites the public "completed handoffs" count with no
-- caller check at all.
do $$
begin
  if to_regprocedure('public.reset_completed_deals(jsonb)') is not null then
    revoke all on function public.reset_completed_deals(jsonb) from public, anon, authenticated;
    grant execute on function public.reset_completed_deals(jsonb) to service_role;
  end if;
end $$;

-- register_ticket_code had the same NULL-unsafe owner check as cancel_listing:
-- anon could attach a code hash to anyone's listing, and a seller could
-- attach one to a listing that is no longer for sale. The body is otherwise
-- the dashboard original: duplicates are recorded in code_collisions and
-- reported back without saying whose listing holds the code.
create or replace function public.register_ticket_code(p_listing_id uuid, p_code_hash text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  l listings;
  v_existing uuid;
  v_same boolean;
begin
  if v_uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  if p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'code hash must be 64 hex characters' using errcode = '22023';
  end if;
  select * into l from listings where id = p_listing_id for update;
  if l.id is null then
    raise exception 'listing not found';
  end if;
  if l.user_id is distinct from v_uid then
    raise exception 'not your listing' using errcode = '42501';
  end if;
  if l.type <> 'sell' or l.status <> 'active' then
    raise exception 'codes can only be added to an active sell listing' using errcode = '22023';
  end if;
  if exists (select 1 from ticket_codes where listing_id = p_listing_id) then
    raise exception 'this listing already has a code' using errcode = '23505';
  end if;

  begin
    insert into ticket_codes (listing_id, code_hash) values (p_listing_id, p_code_hash);
    return jsonb_build_object('ok', true);
  exception when unique_violation then
    select tl.id, (tl.user_id = v_uid)
      into v_existing, v_same
      from ticket_codes tc
      join listings tl on tl.id = tc.listing_id
     where tc.code_hash = p_code_hash and tc.is_live
     limit 1;
    insert into code_collisions (code_hash, attempted_by, existing_listing_id, same_seller)
    values (p_code_hash, v_uid, v_existing, coalesce(v_same, false));
    return jsonb_build_object('ok', false, 'same_seller', coalesce(v_same, false));
  end;
end;
$$;
revoke all on function public.register_ticket_code(uuid, text) from public, anon;
grant execute on function public.register_ticket_code(uuid, text) to authenticated, service_role;

-- Rows the honest client could never have written: a hash that is not
-- sha256 hex, or a code on an ask listing. And a live code on a cancelled
-- listing can only have been planted after the cancel, because
-- sync_ticket_code_liveness clears it at cancel time; release it.
delete from public.ticket_codes tc
 using public.listings l
 where l.id = tc.listing_id
   and (tc.code_hash !~ '^[0-9a-f]{64}$' or l.type <> 'sell');
update public.ticket_codes tc set is_live = false
  from public.listings l
 where l.id = tc.listing_id and l.status = 'cancelled' and tc.is_live;

commit;
