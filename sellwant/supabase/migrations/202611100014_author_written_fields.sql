-- Fields one user writes and other people's screens or services read.
--
-- Second audit pass. Each of these is a column a user can write freely through
-- PostgREST and that something else trusts the shape of:
--
-- 1. listings.image_urls. listing_image_urls_ok accepted any Supabase project
--    (`[a-z0-9]+\.supabase\.co`) and any path after the bucket prefix, so a
--    listing photo could point at an attacker's project (free to create, with
--    readable access logs) or, through `../` segments, at their edge
--    function. Every visitor to the event page, signed in or not, fetched it.
--    Now: this project's listing-photos bucket, the listing owner's folder,
--    a plain file name.
--
-- 2. listings.created_at. Writable on INSERT (20261104 noted it). The public
--    listings API orders by it and treats it as database-assigned, so one
--    listing dated 10000-01-01 sorted first forever and made
--    /api/listings.json answer 503 for every caller. Now the server sets it.
--
-- 3. reports. The reporter could insert reviewed_at, outcome and a backdated
--    created_at, and point lock_in_id at a deal they are not in: a report
--    that shows as already reviewed ("suspended") against a named user and
--    never reaches the admin queue. Now those columns are server-owned and
--    the references must belong to the reporter and the subject.
--
-- 4. offers.message. Unbounded. One open offer with a ~140 KB message
--    overflowed the watcher's read of the offer page, so every approved watch
--    on that listing failed at the same cursor forever. Now 500 characters,
--    no control characters.
--
-- 5. contact_details.accepted_payments. Any JSON. A counterparty's handle
--    whose value was an object crashed the other person's deal screen (the
--    only place with Cancel and "I've sent the money"). Now an array of at
--    most 10 {kind, value, label?} string objects.
--
-- Existing rows that break a new rule are repaired (cleared or withdrawn)
-- before the constraint is validated, so the migration cannot fail on data.

begin;

-- 1. listing photos ---------------------------------------------------------

alter table public.listings drop constraint if exists listings_image_urls_bounded;
drop function if exists public.listing_image_urls_ok(text[]);

create or replace function public.listing_image_urls_ok(urls text[], owner uuid)
returns boolean language sql immutable as $$
  select urls is null
      or (
        coalesce(array_length(urls, 1), 0) <= 3
        and not exists (
          select 1 from unnest(urls) as u
          where u is null
             or u !~ ('^https://gguzeafbwsqkhggmcjjl\.supabase\.co/storage/v1/object/public/listing-photos/'
                      || owner::text || '/[A-Za-z0-9_-]{1,64}\.(jpg|jpeg|png|webp)$')
        )
      );
$$;

update public.listings set image_urls = '{}'
 where not public.listing_image_urls_ok(image_urls, user_id);

alter table public.listings
  add constraint listings_image_urls_bounded
  check (public.listing_image_urls_ok(image_urls, user_id));

-- 2. created_at is the server's --------------------------------------------

create or replace function public.listings_server_created_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.created_at := now();
  return new;
end;
$$;

drop trigger if exists listings_server_created_at on public.listings;
create trigger listings_server_created_at
  before insert on public.listings
  for each row execute function public.listings_server_created_at();

update public.listings set created_at = now()
 where created_at > now() + interval '1 day' or created_at < timestamptz '2000-01-01';

-- 3. reports are filed, not pre-reviewed ------------------------------------

create or replace function public.reports_insert_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  new.reviewed_at := null;
  new.outcome     := null;
  new.created_at  := now();
  if char_length(coalesce(btrim(new.body), '')) not between 1 and 2000 then
    raise exception 'a report needs a reason of up to 2000 characters' using errcode = '22023';
  end if;
  if v_uid is null then
    return new;  -- service role / maintenance
  end if;
  if new.subject_id = v_uid then
    raise exception 'you cannot report yourself' using errcode = '22023';
  end if;
  if new.lock_in_id is not null and not exists (
       select 1 from lock_ins k
        where k.id = new.lock_in_id
          and v_uid in (k.buyer_id, k.seller_id)
          and new.subject_id in (k.buyer_id, k.seller_id)) then
    raise exception 'that deal is not between you and them' using errcode = '42501';
  end if;
  if new.lock_in_id is not null and new.listing_id is not null and not exists (
       select 1 from lock_ins k where k.id = new.lock_in_id and k.listing_id = new.listing_id) then
    raise exception 'that listing is not the one in the deal' using errcode = '22023';
  end if;
  if new.listing_id is not null and not exists (
       select 1 from listings l where l.id = new.listing_id and l.user_id in (v_uid, new.subject_id)) then
    raise exception 'that listing is not yours or theirs' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.reports_insert_guard() from public, anon, authenticated;

drop trigger if exists reports_insert_guard on public.reports;
create trigger reports_insert_guard
  before insert on public.reports
  for each row execute function public.reports_insert_guard();

-- Reports are filed with INSERT and read back with SELECT; nothing else.
revoke update, delete, truncate, references, trigger on public.reports from anon, authenticated;
revoke insert on public.reports from anon;

-- 4. offer messages ---------------------------------------------------------

update public.offers set status = 'withdrawn'
 where status = 'open' and message is not null
   and (char_length(message) > 500 or message ~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]');

alter table public.offers drop constraint if exists offers_message_bounded;
alter table public.offers
  add constraint offers_message_bounded
  check (message is null or (char_length(message) <= 500
                             and message !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]')) not valid;

-- Closed offers are history; leave their text alone if it is long.
do $$
begin
  alter table public.offers validate constraint offers_message_bounded;
exception when check_violation then
  raise notice 'offers_message_bounded left NOT VALID: closed offers keep longer messages';
end $$;

-- 5. payment handles --------------------------------------------------------

create or replace function public.accepted_payments_ok(p jsonb)
returns boolean language sql immutable as $$
  select jsonb_typeof(p) = 'array'
     and jsonb_array_length(p) <= 10
     and not exists (
       select 1 from jsonb_array_elements(p) as h
        where jsonb_typeof(h) <> 'object'
           or jsonb_typeof(h -> 'kind') is distinct from 'string'
           or jsonb_typeof(h -> 'value') is distinct from 'string'
           or (h ? 'label' and jsonb_typeof(h -> 'label') not in ('string', 'null'))
           or char_length(h ->> 'kind') > 20
           or char_length(h ->> 'value') > 200
           or char_length(coalesce(h ->> 'label', '')) > 40
     );
$$;

update public.contact_details set accepted_payments = '[]'::jsonb
 where not public.accepted_payments_ok(accepted_payments);

alter table public.contact_details drop constraint if exists contact_accepted_payments_shape;
alter table public.contact_details
  add constraint contact_accepted_payments_shape
  check (public.accepted_payments_ok(accepted_payments));

notify pgrst, 'reload schema';
commit;
