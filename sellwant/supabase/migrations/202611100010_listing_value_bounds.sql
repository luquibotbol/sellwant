-- Keep listings and profiles inside what the rest of the system can show.
--
-- 1. event_date. Postgres stores dates from 4713 BC to 5874897 AD and renders
--    years past 9999 as `10000-01-01` and BC dates as `0044-03-15 BC`. The
--    public listings API validates every row it returns, so one listing whose
--    owner set such a date (a legal PATCH under the column grant) made
--    /api/listings.json answer 503 for every visitor. The Worker now skips a
--    row like that instead of failing the page; this stops the row existing.
--
-- 2. profile_picture. Listing photos are pinned to our own storage bucket
--    because an arbitrary image URL rendered to other users is "a tracking
--    pixel at best" (20260819_listing_photos.sql). Avatars had no such rule:
--    any user could point theirs at a server they control, and every
--    signed-in viewer of an offer board, profile or deal fetched it. The
--    allowed shapes are our avatars bucket and Google's avatar host, which
--    handle_new_user copies from Google sign-in. A trigger rather than a
--    CHECK, because handle_new_user also inserts this column from sign-up
--    metadata: an unexpected value there must be dropped, not fail sign-up.

begin;

alter table public.listings drop constraint if exists listings_event_date_range;
alter table public.listings
  add constraint listings_event_date_range
  check (event_date is null or event_date between date '0001-01-01' and date '9999-12-31') not valid;

-- Validate existing rows, but never let an old out-of-range row block the
-- migration: NOT VALID already enforces the rule for every new write.
do $$
begin
  alter table public.listings validate constraint listings_event_date_range;
exception when check_violation then
  raise notice 'listings_event_date_range left NOT VALID: existing rows fall outside it';
end $$;

create or replace function public.profile_picture_ok(url text)
returns boolean language sql immutable as $$
  -- Pinned to this project: any other Supabase project's public bucket is
  -- one an attacker can create and read the access logs of. Loopback is the
  -- local development stack. Google's avatar host is Google's, not a host a
  -- user can watch.
  select url is null
      or url ~ '^https://gguzeafbwsqkhggmcjjl\.supabase\.co/storage/v1/object/public/avatars/'
      or url ~ '^http://127\.0\.0\.1:[0-9]{1,5}/storage/v1/object/public/avatars/'
      or url ~ '^https://lh[0-9]\.googleusercontent\.com/';
$$;

create or replace function public.profiles_picture_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if not public.profile_picture_ok(new.profile_picture) then
    if tg_op = 'INSERT' then
      new.profile_picture := null;
    else
      raise exception 'profile picture must be uploaded to SellWant' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_picture_guard on public.profiles;
create trigger profiles_picture_guard
  before insert or update of profile_picture on public.profiles
  for each row execute function public.profiles_picture_guard();

-- Existing off-site avatars stop rendering to other people.
update public.profiles set profile_picture = null
 where not public.profile_picture_ok(profile_picture);

commit;
