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

commit;
