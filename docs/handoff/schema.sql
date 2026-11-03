-- SellWant — schema export
--
-- Generated 2026-11-04 from the live production project by reading
-- pg_catalog, not by replaying the migrations: only six migrations are in the
-- repo, the rest of the schema was built in the dashboard, so this file is the
-- only complete description of it.
--
-- Includes: tables, constraints, indexes, every function (accept_offer and
-- advance_deal among them), triggers, RLS policies, the grant layer, and the
-- two storage buckets with their policies.
--
-- Excludes: data, auth/storage internals that Supabase creates for you, and
-- every secret. Run it against a fresh Supabase project (local or hosted) as
-- the `postgres` role; see README.md in this folder. Pair it with seed.sql for
-- something to look at.
--
-- Two things to know before reading:
--
-- 1. RLS is the real gate. Several table-level grants are permissive leftovers
--    from Supabase's default `grant all to anon, authenticated` which RLS then
--    neutralises -- ticket_codes and code_collisions, for instance, are
--    readable by grant and unreadable in practice because RLS is enabled and
--    they have no policy at all. Read the policies, not the grants.
-- 2. RLS filters, it does not throw. A blocked write comes back 200 with an
--    empty body, and a DELETE that deleted nothing looks identical to one that
--    worked. Never conclude a boundary holds by reading this file: sign in and
--    try the thing that must fail.

begin;

create extension if not exists pg_trgm;

-- ============================================================== tables

-- Public identity. One row per auth.users row, created by a trigger on signup.
create table public.profiles (
  id               uuid not null,
  full_name        text not null default '',
  profile_picture  text,
  completed_deals  integer not null default 0,
  is_suspended     boolean not null default false,
  created_at       timestamptz not null default now(),
  instagram        text,
  onboarded_at     timestamptz
);

-- Private contact. Visible to the owner, and to a counterparty in a live deal.
create table public.contact_details (
  profile_id        uuid not null,
  phone             text,
  email             text,
  accepted_payments jsonb not null default '[]'::jsonb,
  updated_at        timestamptz not null default now()
);

create table public.categories (
  id        serial not null,
  name      text not null,
  image_url text
);

-- `type` is the whole product: 'sell' = I have a ticket, 'ask' = I want one.
-- best_offer_cents and offer_count are derived -- maintained by triggers from
-- the offers table, never meant to be written by a client.
create table public.listings (
  id               uuid not null default gen_random_uuid(),
  user_id          uuid not null,
  category_id      integer,
  type             text not null,
  title            text not null,
  description      text,
  price_cents      integer not null,
  image_urls       text[] not null default '{}'::text[],
  tags             text[] not null default '{}'::text[],
  location         text,
  event_date       date,
  platform         text,
  status           text not null default 'active',
  created_at       timestamptz not null default now(),
  best_offer_cents integer,
  offer_count      integer not null default 0
);

-- An offer's amount is immutable once made (trigger). A new price is a new
-- offer that supersedes the old one (also a trigger).
create table public.offers (
  id              uuid not null default gen_random_uuid(),
  listing_id      uuid not null,
  from_user       uuid not null,
  amount_cents    integer not null,
  message         text,
  status          text not null default 'open',
  parent_offer_id uuid,
  created_at      timestamptz not null default now()
);

-- Deals. State is advanced ONLY through advance_deal(); there is deliberately
-- no UPDATE policy, so role and sequence rules cannot be bypassed by a client.
create table public.lock_ins (
  id                 uuid not null default gen_random_uuid(),
  listing_id         uuid not null,
  buyer_id           uuid not null,
  seller_id          uuid not null,
  locked_price_cents integer not null,
  state              text not null default 'pending_payment',
  locked_at          timestamptz not null default now(),
  cancelled_by       uuid,
  cancelled_at       timestamptz,
  cancelled_from     text,
  paid_at            timestamptz,
  confirmed_at       timestamptz
);

-- sha256(normalised QR payload). Enough to catch the same ticket listed twice,
-- never enough to redeem one. No client can read this table at all.
create table public.ticket_codes (
  id           uuid not null default gen_random_uuid(),
  listing_id   uuid,
  code_hash    text not null,
  storage_path text,
  is_live      boolean not null default true,
  created_at   timestamptz not null default now(),
  lock_in_id   uuid
);

-- Audit trail of a code offered twice, and whether it was the same seller
-- (an honest mistake) or a different one (the scam).
create table public.code_collisions (
  id                  uuid not null default gen_random_uuid(),
  code_hash           text not null,
  attempted_by        uuid not null,
  existing_listing_id uuid,
  same_seller         boolean not null,
  created_at          timestamptz not null default now()
);

-- Private, free-text reports. No public read path by design -- a public
-- accusation against a named private individual is defamation per se, and a
-- structured category list would forfeit Section 230 protection.
create table public.reports (
  id          uuid not null default gen_random_uuid(),
  reporter_id uuid not null,
  subject_id  uuid not null,
  listing_id  uuid,
  lock_in_id  uuid,
  body        text not null,
  created_at  timestamptz not null default now(),
  reviewed_at timestamptz,
  outcome     text
);

create table public.admins (
  id         uuid not null,
  note       text,
  created_at timestamptz not null default now()
);

-- Page impressions. No IP, no cookie, no user id, no user agent, nothing that
-- survives a reload: a row is a path, optionally the listing it was, a random
-- id that lives in one browser tab, and a date. The privacy policy says
-- exactly this, and it has to stay true.
--
-- The unique constraint is the load-bearing part. Without it an impression is
-- "any time anything hit the endpoint", which counts one person refreshing
-- five times as five people. With it, a row is one tab seeing one path on one
-- day.
create table public.page_views (
  id         bigserial not null,
  path       text not null,
  listing_id uuid,
  visit_id   text not null,
  day        date not null default ((now() at time zone 'utc')::date),
  created_at timestamptz not null default now()
);

-- ========================================================= constraints

alter table admins add constraint admins_pkey PRIMARY KEY (id);
alter table admins add constraint admins_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table categories add constraint categories_pkey PRIMARY KEY (id);
alter table categories add constraint categories_name_key UNIQUE (name);

alter table profiles add constraint profiles_pkey PRIMARY KEY (id);
alter table profiles add constraint profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table contact_details add constraint contact_details_pkey PRIMARY KEY (profile_id);
alter table contact_details add constraint contact_details_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;

alter table listings add constraint listings_pkey PRIMARY KEY (id);
alter table listings add constraint listings_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table listings add constraint listings_category_id_fkey FOREIGN KEY (category_id) REFERENCES categories(id);
alter table listings add constraint listings_type_check CHECK ((type = ANY (ARRAY['ask'::text, 'sell'::text])));
alter table listings add constraint listings_status_check CHECK ((status = ANY (ARRAY['active'::text, 'locked'::text, 'sold'::text, 'cancelled'::text])));
alter table listings add constraint listings_price_cents_check CHECK ((price_cents > 0));
alter table listings add constraint listings_platform_check CHECK ((platform = 'bubbl'::text));
-- (listings_image_urls_bounded is added after the functions, below -- it calls one.)

alter table offers add constraint offers_pkey PRIMARY KEY (id);
alter table offers add constraint offers_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE;
alter table offers add constraint offers_from_user_fkey FOREIGN KEY (from_user) REFERENCES profiles(id);
alter table offers add constraint offers_parent_offer_id_fkey FOREIGN KEY (parent_offer_id) REFERENCES offers(id) ON DELETE SET NULL;
alter table offers add constraint offers_amount_cents_check CHECK ((amount_cents > 0));
alter table offers add constraint offers_status_check CHECK ((status = ANY (ARRAY['open'::text, 'withdrawn'::text, 'accepted'::text, 'declined'::text])));

alter table lock_ins add constraint lock_ins_pkey PRIMARY KEY (id);
alter table lock_ins add constraint lock_ins_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE;
alter table lock_ins add constraint lock_ins_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table lock_ins add constraint lock_ins_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table lock_ins add constraint lock_ins_cancelled_by_fkey FOREIGN KEY (cancelled_by) REFERENCES profiles(id);
alter table lock_ins add constraint buyer_is_not_seller CHECK ((buyer_id <> seller_id));
alter table lock_ins add constraint lock_ins_locked_price_cents_check CHECK ((locked_price_cents > 0));
alter table lock_ins add constraint lock_ins_state_check CHECK ((state = ANY (ARRAY['pending_payment'::text, 'paid'::text, 'code_released'::text, 'confirmed'::text, 'cancelled'::text])));

alter table ticket_codes add constraint ticket_codes_pkey PRIMARY KEY (id);
alter table ticket_codes add constraint ticket_codes_listing_id_key UNIQUE (listing_id);
alter table ticket_codes add constraint ticket_codes_lock_in_id_key UNIQUE (lock_in_id);
alter table ticket_codes add constraint ticket_codes_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE;
alter table ticket_codes add constraint ticket_codes_lock_in_id_fkey FOREIGN KEY (lock_in_id) REFERENCES lock_ins(id) ON DELETE CASCADE;
alter table ticket_codes add constraint ticket_code_has_one_anchor CHECK ((num_nonnulls(listing_id, lock_in_id) = 1));

alter table code_collisions add constraint code_collisions_pkey PRIMARY KEY (id);
alter table code_collisions add constraint code_collisions_attempted_by_fkey FOREIGN KEY (attempted_by) REFERENCES profiles(id) ON DELETE CASCADE;
alter table code_collisions add constraint code_collisions_existing_listing_id_fkey FOREIGN KEY (existing_listing_id) REFERENCES listings(id) ON DELETE SET NULL;

alter table reports add constraint reports_pkey PRIMARY KEY (id);
alter table reports add constraint reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table reports add constraint reports_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table reports add constraint reports_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE SET NULL;
alter table reports add constraint reports_lock_in_id_fkey FOREIGN KEY (lock_in_id) REFERENCES lock_ins(id) ON DELETE SET NULL;
alter table reports add constraint report_not_self CHECK ((reporter_id <> subject_id));
alter table reports add constraint reports_body_check CHECK ((length(btrim(body)) >= 10));
alter table reports add constraint reports_outcome_check CHECK ((outcome = ANY (ARRAY['no_action'::text, 'warned'::text, 'suspended'::text])));

alter table page_views add constraint page_views_pkey PRIMARY KEY (id);
alter table page_views add constraint page_views_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE SET NULL;
alter table page_views add constraint page_views_path_len CHECK (((char_length(path) >= 1) AND (char_length(path) <= 200)));
alter table page_views add constraint page_views_visit_len CHECK (((char_length(visit_id) >= 4) AND (char_length(visit_id) <= 64)));
alter table page_views add constraint page_views_once_per_tab_per_day UNIQUE (visit_id, path, day);

-- ============================================================= indexes

-- Search is trigram, per column: the feed matches title OR description OR
-- location with ILIKE, and a single expression index on a concatenation would
-- never be used by that query.
CREATE INDEX listings_title_trgm_idx ON public.listings USING gin (title gin_trgm_ops);
CREATE INDEX listings_description_trgm_idx ON public.listings USING gin (description gin_trgm_ops);
CREATE INDEX listings_location_trgm_idx ON public.listings USING gin (location gin_trgm_ops);
CREATE INDEX listings_status_idx ON public.listings USING btree (status, type);
CREATE INDEX listings_event_date_idx ON public.listings USING btree (event_date);
CREATE INDEX listings_active_event_date_idx ON public.listings USING btree (status, event_date) WHERE (status = 'active'::text);

CREATE INDEX offers_listing_idx ON public.offers USING btree (listing_id, status, amount_cents);
-- One live offer per person per listing: a new price supersedes, never stacks.
CREATE UNIQUE INDEX offers_one_open_per_person ON public.offers USING btree (listing_id, from_user) WHERE (status = 'open'::text);

-- One live deal per listing, enforced in the index rather than in the RPC.
CREATE UNIQUE INDEX lock_ins_one_open_per_listing_idx ON public.lock_ins USING btree (listing_id) WHERE (state <> 'cancelled'::text);
CREATE INDEX lock_ins_parties_idx ON public.lock_ins USING btree (buyer_id, seller_id);
CREATE INDEX lock_ins_parties_rev_idx ON public.lock_ins USING btree (seller_id, buyer_id);

-- The same code may be registered again once the listing is cancelled.
CREATE UNIQUE INDEX ticket_codes_live_hash_idx ON public.ticket_codes USING btree (code_hash) WHERE is_live;

CREATE INDEX reports_reporter_idx ON public.reports USING btree (reporter_id, created_at DESC);
CREATE INDEX reports_subject_idx ON public.reports USING btree (subject_id, created_at DESC);

CREATE INDEX page_views_day_idx ON public.page_views USING btree (day DESC);
CREATE INDEX page_views_listing_idx ON public.page_views USING btree (listing_id, day DESC) WHERE (listing_id IS NOT NULL);

-- ===========================================================================
-- Functions
--
-- Everything with a RULE attached to it is a function, not a policy. A policy
-- can only say yes or no to a whole statement; a sequence ("mark paid before
-- confirmed"), a role ("only the buyer may"), or a derived counter needs code.
-- All of these are SECURITY DEFINER, so grants on the tables do not apply to
-- what happens inside them.
-- ===========================================================================

-- ----------------------------------------------------------- helpers

CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from admins where id = auth.uid());
$function$;

-- Defaults to TRUE for an unknown caller: a missing profile row must not read
-- as "in good standing".
CREATE OR REPLACE FUNCTION public.is_suspended()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((select is_suspended from profiles where id = auth.uid()), true);
$function$;

-- Used by the contact_details policy: your phone number becomes visible to
-- exactly one person, and only once you have a deal together.
CREATE OR REPLACE FUNCTION public.shares_lock_in(other uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from lock_ins l
    where (l.buyer_id = auth.uid() and l.seller_id = other)
       or (l.seller_id = auth.uid() and l.buyer_id = other)
  );
$function$;

-- Reads offers from inside a policy on offers, so it must be SECURITY
-- DEFINER: a policy that queries its own table recurses (42P17) otherwise.
CREATE OR REPLACE FUNCTION public.offer_parent_ok(p_parent uuid, p_listing uuid, p_from uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from offers o
    where o.id = p_parent
      and o.listing_id = p_listing
      -- Countering yourself would rebuild the same fake ladder one row deeper.
      and o.from_user <> p_from
  );
$function$;

-- Three is the product limit, and each entry must live in our own bucket --
-- otherwise image_urls is an arbitrary-URL field that renders wherever a
-- listing renders, which is a tracking pixel at best.
--
-- The predicate lives in a function because a CHECK constraint may not contain
-- a subquery, and checking every element of an array needs one. Wrapping it in
-- an IMMUTABLE function is the supported way round that.
CREATE OR REPLACE FUNCTION public.listing_image_urls_ok(urls text[])
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select urls is null
      or (
        coalesce(array_length(urls, 1), 0) <= 3
        and not exists (
          select 1 from unnest(urls) as u
          where u !~ '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/listing-photos/'
        )
      );
$function$;

alter table public.listings
  add constraint listings_image_urls_bounded check (public.listing_image_urls_ok(image_urls));

-- ------------------------------------------------- signup and profiles

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_name   text;
  v_avatar text;
begin
  v_name := coalesce(
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'name',
    ''
  );
  -- nullif so an empty string does not masquerade as a photo.
  v_avatar := nullif(coalesce(
    new.raw_user_meta_data->>'avatar_url',
    new.raw_user_meta_data->>'picture',
    ''
  ), '');

  insert into profiles (id, full_name, profile_picture)
  values (new.id, v_name, v_avatar);

  insert into contact_details (profile_id, email, phone)
  values (new.id, new.email, new.phone);

  return new;
end;
$function$;

-- --------------------------------------------------- the offer board

-- The going rate: highest offer on a sell listing, lowest on an ask. The
-- poster's own counter is excluded -- it is their asking price, not evidence
-- of demand, and including it was a real bug.
CREATE OR REPLACE FUNCTION public.refresh_offer_stats(p_listing uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_type  text;
  v_owner uuid;
begin
  select type, user_id into v_type, v_owner
  from listings where id = p_listing;

  update listings l
  set offer_count = (
        select count(*) from offers o
        where o.listing_id = p_listing
          and o.status = 'open'
          and o.from_user <> v_owner
      ),
      best_offer_cents = (
        select case when v_type = 'sell' then max(o.amount_cents)
                    else min(o.amount_cents) end
        from offers o
        where o.listing_id = p_listing
          and o.status = 'open'
          and o.from_user <> v_owner
      )
  where l.id = p_listing;
end;
$function$;

CREATE OR REPLACE FUNCTION public.offers_touch_stats()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform refresh_offer_stats(coalesce(new.listing_id, old.listing_id));
  return coalesce(new, old);
end;
$function$;

-- A new price from the same person replaces their old one.
CREATE OR REPLACE FUNCTION public.offers_supersede_previous()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update offers
     set status = 'withdrawn'
   where listing_id = new.listing_id
     and from_user  = new.from_user
     and status     = 'open';
  return new;
end;
$function$;

-- The amount is the claim a stranger relies on. Once made, it cannot be
-- edited -- not by the author, not by the listing's owner.
CREATE OR REPLACE FUNCTION public.offers_freeze_amount()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if new.amount_cents <> old.amount_cents or new.from_user <> old.from_user then
    raise exception 'offer amount and author are immutable';
  end if;
  return new;
end;
$function$;

-- --------------------------------------------------------- the deal

-- Creates the deal. Which side is buyer depends on the listing type: on an
-- 'ask' the poster is the buyer and the offerer is the seller.
CREATE OR REPLACE FUNCTION public.accept_offer(p_offer_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_offer   offers%rowtype;
  v_listing listings%rowtype;
  v_lock_in uuid;
begin
  select * into v_offer from offers where id = p_offer_id;
  if not found then raise exception 'offer not found'; end if;
  if v_offer.status <> 'open' then raise exception 'offer is no longer open'; end if;

  select * into v_listing from listings where id = v_offer.listing_id for update;
  if v_listing.user_id <> auth.uid() then raise exception 'not your listing'; end if;
  if v_listing.status <> 'active' then raise exception 'listing is no longer active'; end if;

  if exists (select 1 from lock_ins where listing_id = v_listing.id) then
    raise exception 'this listing already has a deal in progress';
  end if;

  insert into lock_ins (listing_id, buyer_id, seller_id, locked_price_cents)
  values (
    v_listing.id,
    case when v_listing.type = 'sell' then v_offer.from_user else v_listing.user_id end,
    case when v_listing.type = 'sell' then v_listing.user_id else v_offer.from_user end,
    v_offer.amount_cents
  )
  returning id into v_lock_in;

  -- The insert trigger declines the others and locks the listing; this one
  -- offer is the exception.
  update offers set status = 'accepted' where id = p_offer_id;

  return v_lock_in;
end;
$function$;

CREATE OR REPLACE FUNCTION public.lock_in_locks_listing()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update listings set status = 'locked'
   where id = new.listing_id and status = 'active';

  -- A live deal ends the haggle.
  update offers set status = 'declined'
   where listing_id = new.listing_id and status = 'open';

  return new;
end;
$function$;

-- The only way a deal's state ever changes. lock_ins has no UPDATE policy, so
-- this function is the entire surface: it checks the caller is a party, that
-- the role is right for the transition, and that the sequence is respected.
--
-- The states record what someone SAID, never what SellWant verified -- money
-- moves off-platform and we never see it.
CREATE OR REPLACE FUNCTION public.advance_deal(p_lock_in_id uuid, p_to text)
 RETURNS lock_ins
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  d        lock_ins%rowtype;
  v_is_buyer  boolean;
  v_is_seller boolean;
begin
  -- FOR UPDATE: serialises concurrent cancel/confirm on the same deal.
  select * into d from lock_ins where id = p_lock_in_id for update;
  if not found then raise exception 'deal not found'; end if;

  v_is_buyer  := d.buyer_id  = auth.uid();
  v_is_seller := d.seller_id = auth.uid();
  if not (v_is_buyer or v_is_seller) then
    raise exception 'not your deal';
  end if;

  -- Idempotent no-op rather than an error.
  if d.state = p_to then return d; end if;

  if d.state in ('confirmed','cancelled') then
    raise exception 'this deal is already %', d.state;
  end if;

  if p_to = 'paid' then
    if not v_is_buyer then raise exception 'only the buyer can mark a deal paid'; end if;
    if d.state <> 'pending_payment' then raise exception 'cannot mark paid from %', d.state; end if;
    update lock_ins set state = 'paid', paid_at = now() where id = d.id returning * into d;

  elsif p_to = 'confirmed' then
    if not v_is_buyer then raise exception 'only the buyer can confirm a deal'; end if;
    if d.state <> 'paid' then raise exception 'mark the deal paid first'; end if;
    update lock_ins set state = 'confirmed', confirmed_at = now() where id = d.id returning * into d;

  elsif p_to = 'cancelled' then
    update lock_ins
       set state = 'cancelled',
           cancelled_by = auth.uid(),
           cancelled_at = now(),
           cancelled_from = d.state
     where id = d.id returning * into d;

  else
    raise exception 'unknown target state %', p_to;
  end if;

  return d;
end;
$function$;

CREATE OR REPLACE FUNCTION public.deal_settled()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.state = 'confirmed' and old.state <> 'confirmed' then
    update profiles set completed_deals = completed_deals + 1
     where id in (new.buyer_id, new.seller_id);
    update listings set status = 'sold' where id = new.listing_id;

  elsif new.state = 'cancelled' and old.state <> 'cancelled' then
    -- Back on the market. sync_ticket_code_liveness only frees the QR on a
    -- cancelled LISTING, so the registered code stays live throughout and the
    -- seller does not collide with themselves on relist.
    update listings set status = 'active'
     where id = new.listing_id and status = 'locked';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_listing(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v listings;
begin
  select * into v from listings where id = p_id for update;
  if v.id is null then
    raise exception 'no such listing';
  end if;
  if v.user_id <> auth.uid() then
    raise exception 'not your listing';
  end if;
  -- A locked listing is mid-handoff. Pulling it from under the other person
  -- is the deal screen's job to cancel, not this one's.
  if v.status <> 'active' then
    raise exception 'this listing is % and cannot be taken down here', v.status;
  end if;
  update listings set status = 'cancelled' where id = p_id;
end;
$function$;

-- ----------------------------------------------------- ticket codes

-- Registers sha256(normalised payload) and reports a collision without ever
-- exposing whose listing it clashed with.
CREATE OR REPLACE FUNCTION public.register_ticket_code(p_listing_id uuid, p_code_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_owner    uuid;
  v_existing uuid;
  v_same     boolean;
begin
  select user_id into v_owner from listings where id = p_listing_id;
  if v_owner is null then
    raise exception 'listing not found';
  end if;
  if v_owner <> auth.uid() then
    raise exception 'not your listing';
  end if;

  begin
    insert into ticket_codes (listing_id, code_hash) values (p_listing_id, p_code_hash);
    return jsonb_build_object('ok', true);
  exception when unique_violation then
    -- Someone is already offering this exact code. Tell the caller whether it
    -- was themselves (an honest mistake) or another seller (the scam).
    select l.id, (l.user_id = auth.uid())
      into v_existing, v_same
      from ticket_codes tc
      join listings l on l.id = tc.listing_id
     where tc.code_hash = p_code_hash and tc.is_live
     limit 1;

    insert into code_collisions (code_hash, attempted_by, existing_listing_id, same_seller)
    values (p_code_hash, auth.uid(), v_existing, coalesce(v_same, false));

    return jsonb_build_object('ok', false, 'same_seller', coalesce(v_same, false));
  end;
end;
$function$;

CREATE OR REPLACE FUNCTION public.sync_ticket_code_liveness()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.status = 'cancelled' then
    update public.ticket_codes set is_live = false where listing_id = new.id;
  end if;
  return new;
end;
$function$;

-- ------------------------------------------------------- impressions

-- Never throws. A beacon has nobody listening to the response, and a view
-- that fails to count must not be visible to the person being counted.
CREATE OR REPLACE FUNCTION public.record_view(p_path text, p_visit_id text, p_listing_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_listing uuid;
begin
  if p_path is null or p_path !~ '^/' or char_length(p_path) > 200 then
    return;
  end if;
  if p_visit_id is null or char_length(p_visit_id) not between 4 and 64 then
    return;
  end if;

  -- A deleted or invented listing does not invalidate the view, it just stops
  -- being associated: the row still counts as traffic on that path.
  select id into v_listing from listings where id = p_listing_id;

  insert into page_views (path, visit_id, listing_id)
  values (p_path, p_visit_id, v_listing)
  on conflict (visit_id, path, day) do nothing;
exception
  when others then
    return;
end;
$function$;

-- Aggregated in Postgres rather than by pulling rows to the client, because
-- unlike signups this table grows with traffic rather than with users.
CREATE OR REPLACE FUNCTION public.admin_view_stats(p_days int default 30)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with span as (
    select generate_series(
      ((now() at time zone 'utc')::date - (greatest(p_days, 1) - 1)),
      ((now() at time zone 'utc')::date),
      interval '1 day'
    )::date as day
  ),
  per_day as (
    select s.day,
           count(v.id) filter (where v.path in ('/', '/feed')) as feed,
           count(v.id) filter (where v.listing_id is not null) as listings,
           count(v.id) as total
    from span s
    left join page_views v on v.day = s.day
    group by s.day
  ),
  top as (
    select v.listing_id, l.title, count(*) as views
    from page_views v
    join listings l on l.id = v.listing_id
    where v.listing_id is not null
      and v.day > ((now() at time zone 'utc')::date - greatest(p_days, 1))
    group by v.listing_id, l.title
    order by count(*) desc
    limit 10
  )
  select case
    when not is_admin() then null
    else json_build_object(
      'daily', (select coalesce(json_agg(json_build_object(
                  'day', day, 'feed', feed, 'listings', listings, 'total', total
                ) order by day), '[]'::json) from per_day),
      'top_listings', (select coalesce(json_agg(json_build_object(
                  'id', listing_id, 'title', title, 'views', views
                ) order by views desc), '[]'::json) from top)
    )
  end;
$function$;

-- ------------------------------------------------------------ admin

CREATE OR REPLACE FUNCTION public.admin_stats()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v jsonb;
begin
  if not is_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'generated_at', now(),

    'users', (
      select jsonb_build_object(
        'total',        count(*),
        'last_7d',      count(*) filter (where u.created_at > now() - interval '7 days'),
        'last_24h',     count(*) filter (where u.created_at > now() - interval '24 hours'),
        'confirmed',    count(*) filter (where u.email_confirmed_at is not null),
        -- Which door people came in by, now that there are two.
        'via_google',   count(*) filter (where exists (
                          select 1 from auth.identities i
                          where i.user_id = u.id and i.provider = 'google')),
        'active_7d',    count(*) filter (where u.last_sign_in_at > now() - interval '7 days')
      ) from auth.users u
    ),

    -- Where people stop. Each step counts distinct people who reached it, so
    -- the drop between two numbers is the thing worth fixing.
    'funnel', (
      select jsonb_build_object(
        'signed_up',  (select count(*) from auth.users),
        'onboarded',  (select count(*) from profiles where onboarded_at is not null),
        'posted',     (select count(distinct user_id) from listings),
        'offered',    (select count(distinct from_user) from offers),
        'in_a_deal',  (select count(distinct id) from (
                        select buyer_id as id from lock_ins
                        union select seller_id from lock_ins) x),
        'confirmed',  (select count(distinct id) from (
                        select buyer_id as id from lock_ins where state = 'confirmed'
                        union select seller_id from lock_ins where state = 'confirmed') y)
      )
    ),

    'listings', (
      select jsonb_build_object(
        'total',     count(*),
        'active',    count(*) filter (where status = 'active'),
        'locked',    count(*) filter (where status = 'locked'),
        'sold',      count(*) filter (where status = 'sold'),
        'cancelled', count(*) filter (where status = 'cancelled'),
        'for_sale',  count(*) filter (where type = 'sell'),
        'wanted',    count(*) filter (where type = 'ask'),
        'last_7d',   count(*) filter (where created_at > now() - interval '7 days')
      ) from listings
    ),

    'offers', (
      select jsonb_build_object(
        'total',     count(*),
        'open',      count(*) filter (where status = 'open'),
        'accepted',  count(*) filter (where status = 'accepted'),
        'declined',  count(*) filter (where status = 'declined'),
        'withdrawn', count(*) filter (where status = 'withdrawn'),
        'last_7d',   count(*) filter (where created_at > now() - interval '7 days')
      ) from offers
    ),

    'deals', (
      select jsonb_build_object(
        'total',      count(*),
        'in_progress',count(*) filter (where state in ('pending_payment','paid')),
        'confirmed',  count(*) filter (where state = 'confirmed'),
        'cancelled',  count(*) filter (where state = 'cancelled'),
        -- Cancelled out of `paid` is the shape a scam takes; out of
        -- pending_payment it is usually a flake. Worth separating.
        'cancelled_after_paying',
                      count(*) filter (where state = 'cancelled' and cancelled_from = 'paid'),
        -- Not revenue: money never moves through SellWant. This is the size of
        -- the market being cleared.
        'value_confirmed_cents',
                      coalesce(sum(locked_price_cents) filter (where state = 'confirmed'), 0)
      ) from lock_ins
    ),

    'safety', (
      select jsonb_build_object(
        'reports_total',    (select count(*) from reports),
        'reports_open',     (select count(*) from reports where reviewed_at is null),
        'suspended',        (select count(*) from profiles where is_suspended),
        -- The closest thing to a fraud signal the product has: the same ticket
        -- code offered twice.
        'duplicate_codes',  (select count(*) from code_collisions),
        'duplicate_codes_other_seller',
                            (select count(*) from code_collisions where not same_seller)
      )
    )
  ) into v;

  return v;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_reports(p_include_reviewed boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v jsonb;
begin
  if not is_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(r order by r.created_at desc), '[]'::jsonb) into v
  from (
    select jsonb_build_object(
      'id',            rp.id,
      'body',          rp.body,
      'created_at',    rp.created_at,
      'reviewed_at',   rp.reviewed_at,
      'outcome',       rp.outcome,
      'reporter_id',   rp.reporter_id,
      'reporter_name', rep.full_name,
      'subject_id',    rp.subject_id,
      'subject_name',  sub.full_name,
      'subject_suspended', sub.is_suspended,
      'subject_deals', sub.completed_deals,
      'listing_id',    rp.listing_id,
      'listing_title', l.title
    ) as r, rp.created_at
    from reports rp
    left join profiles rep on rep.id = rp.reporter_id
    left join profiles sub on sub.id = rp.subject_id
    left join listings l   on l.id  = rp.listing_id
    where p_include_reviewed or rp.reviewed_at is null
    limit 200
  ) r;

  return v;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_review_report(p_id uuid, p_outcome text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not is_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  update reports
     set reviewed_at = now(),
         outcome     = nullif(btrim(p_outcome), '')
   where id = p_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_suspended(p_user uuid, p_suspended boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not is_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if p_suspended and exists (select 1 from admins where id = p_user) then
    raise exception 'refusing to suspend an admin';
  end if;
  update profiles set is_suspended = p_suspended where id = p_user;
end;
$function$;

-- ------------------------------------------- test-fixture housekeeping
-- Only meaningful against a database whose fixtures use @example.edu. Harmless
-- to keep; delete it if your dev database has no fixture accounts.

CREATE OR REPLACE FUNCTION public.purge_test_listing(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  owner_email text;
begin
  select u.email into owner_email
  from listings l join auth.users u on u.id = l.user_id
  where l.id = p_id;

  if owner_email is null then
    return; -- already gone
  end if;

  -- The whole safety of this function is these two checks: the owner must be
  -- a fixture account, and so must the caller. Without the second, execute is
  -- granted to `authenticated`, so any signed-in stranger could read a
  -- fixture id off the public feed and delete it.
  if owner_email not like '%@example.edu' then
    raise exception 'purge_test_listing only removes fixture data (owner: %)', owner_email;
  end if;

  if coalesce(auth.jwt() ->> 'email', '') not like '%@example.edu' then
    raise exception 'purge_test_listing may only be called by a fixture account';
  end if;

  delete from lock_ins where listing_id = p_id;
  delete from listings where id = p_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.reset_completed_deals(p_counts jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare k text; v int;
begin
  for k, v in select key, value::int from jsonb_each_text(p_counts) loop
    update profiles p
       set completed_deals = v
     where p.id = k::uuid
       and exists (
         select 1 from auth.users u
          where u.id = p.id and u.email like '%@example.edu'
       );
  end loop;
end;
$function$;

-- ============================================================ triggers

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

CREATE TRIGGER listings_status_sync_code AFTER UPDATE OF status ON public.listings
  FOR EACH ROW EXECUTE FUNCTION sync_ticket_code_liveness();

CREATE TRIGGER offers_supersede BEFORE INSERT ON public.offers
  FOR EACH ROW EXECUTE FUNCTION offers_supersede_previous();

CREATE TRIGGER offers_immutable BEFORE UPDATE ON public.offers
  FOR EACH ROW EXECUTE FUNCTION offers_freeze_amount();

CREATE TRIGGER offers_stats AFTER INSERT OR DELETE OR UPDATE ON public.offers
  FOR EACH ROW EXECUTE FUNCTION offers_touch_stats();

CREATE TRIGGER lock_in_locks_listing_trg AFTER INSERT ON public.lock_ins
  FOR EACH ROW EXECUTE FUNCTION lock_in_locks_listing();

CREATE TRIGGER deal_settled_trg AFTER UPDATE OF state ON public.lock_ins
  FOR EACH ROW EXECUTE FUNCTION deal_settled();

-- ================================================================= RLS

alter table public.profiles        enable row level security;
alter table public.contact_details enable row level security;
alter table public.categories      enable row level security;
alter table public.listings        enable row level security;
alter table public.offers          enable row level security;
alter table public.lock_ins        enable row level security;
alter table public.ticket_codes    enable row level security;
alter table public.code_collisions enable row level security;
alter table public.reports         enable row level security;
alter table public.admins          enable row level security;
alter table public.page_views      enable row level security;

-- ticket_codes and code_collisions have RLS enabled and NO policies. That is
-- deliberate: enabled + no policy = nobody but a SECURITY DEFINER function
-- can touch them. The QR hashes are never readable by a client.

-- Identity is visible to signed-in people only; the feed is readable by
-- anyone, but only its active rows.
create policy profiles_select on public.profiles
  for select to authenticated using (true);
create policy profiles_update_own on public.profiles
  for update to authenticated using ((id = auth.uid())) with check ((id = auth.uid()));
-- No INSERT policy: profiles are created by the signup trigger, never by a client.

create policy contact_select on public.contact_details
  for select to authenticated
  using (((profile_id = auth.uid()) OR shares_lock_in(profile_id)));
create policy contact_insert on public.contact_details
  for insert to authenticated with check ((profile_id = auth.uid()));
create policy contact_update on public.contact_details
  for update to authenticated using ((profile_id = auth.uid())) with check ((profile_id = auth.uid()));

create policy categories_select on public.categories
  for select to authenticated using (true);
create policy categories_select_anon on public.categories
  for select to anon using (true);

create policy listings_select on public.listings
  for select to authenticated using (true);
create policy listings_select_anon on public.listings
  for select to anon using ((status = 'active'::text));
create policy listings_insert_own on public.listings
  for insert to authenticated with check (((user_id = auth.uid()) AND (NOT is_suspended())));
create policy listings_update_own on public.listings
  for update to authenticated
  using (((user_id = auth.uid()) AND (status = 'active'::text)))
  with check (((user_id = auth.uid()) AND (status = 'active'::text)));
-- A listing with a deal attached can never be deleted, only taken down.
create policy listings_delete_own on public.listings
  for delete to authenticated
  using (((user_id = auth.uid()) AND (NOT (EXISTS ( SELECT 1
     FROM lock_ins k
    WHERE (k.listing_id = listings.id))))));

create policy offers_select on public.offers
  for select to authenticated using (true);
create policy offers_select_anon on public.offers
  for select to anon
  using ((EXISTS ( SELECT 1 FROM listings l
    WHERE ((l.id = offers.listing_id) AND (l.status = 'active'::text)))));
-- The poster may counter a real offer, but may not open one on their own
-- listing: that is how you manufacture demand on the one number strangers
-- are asked to trust.
create policy offers_insert on public.offers
  for insert to authenticated
  with check (((from_user = auth.uid()) AND (NOT is_suspended()) AND (EXISTS ( SELECT 1
     FROM listings l
    WHERE ((l.id = offers.listing_id) AND (l.status = 'active'::text)))) AND ((from_user <> ( SELECT l.user_id
     FROM listings l
    WHERE (l.id = offers.listing_id))) OR ((parent_offer_id IS NOT NULL) AND offer_parent_ok(parent_offer_id, listing_id, from_user)))));
create policy offers_update_own on public.offers
  for update to authenticated using ((from_user = auth.uid())) with check ((from_user = auth.uid()));
create policy offers_update_listing_owner on public.offers
  for update to authenticated
  using ((EXISTS ( SELECT 1 FROM listings l
    WHERE ((l.id = offers.listing_id) AND (l.user_id = auth.uid())))))
  with check ((EXISTS ( SELECT 1 FROM listings l
    WHERE ((l.id = offers.listing_id) AND (l.user_id = auth.uid())))));

create policy lock_ins_select_parties on public.lock_ins
  for select to authenticated using (((buyer_id = auth.uid()) OR (seller_id = auth.uid())));
-- Who may be buyer and who may be seller depends on the listing type.
create policy lock_ins_insert on public.lock_ins
  for insert to authenticated
  with check (((NOT is_suspended()) AND (EXISTS ( SELECT 1
     FROM listings l
    WHERE ((l.id = lock_ins.listing_id) AND (l.status = 'active'::text) AND (((l.type = 'sell'::text) AND (l.user_id = lock_ins.seller_id) AND (lock_ins.buyer_id = auth.uid())) OR ((l.type = 'ask'::text) AND (l.user_id = lock_ins.buyer_id) AND (lock_ins.seller_id = auth.uid()))))))));
-- NO UPDATE POLICY. advance_deal() is the only way state changes.

create policy reports_insert on public.reports
  for insert to authenticated with check (((reporter_id = auth.uid()) AND (NOT is_suspended())));
create policy reports_select_own on public.reports
  for select to authenticated using ((reporter_id = auth.uid()));
-- Admins read reports through admin_reports(), not through a policy.

create policy admins_select_admin on public.admins
  for select to authenticated using (is_admin());

create policy page_views_insert on public.page_views
  for insert to anon, authenticated with check (true);
create policy page_views_admin_read on public.page_views
  for select to authenticated using (is_admin());

-- ============================================================== grants
--
-- Supabase's default is `grant all on all tables to anon, authenticated` with
-- RLS as the gate. This project then takes columns away, because a policy
-- cannot say "you may edit the title but not the price".

grant usage on schema public to anon, authenticated;
grant all on all tables in schema public to anon, authenticated;
grant all on all sequences in schema public to anon, authenticated;

-- A seller may edit the words and the price. Not status (that is
-- cancel_listing's job), not type, not user_id, and above all not
-- best_offer_cents or offer_count -- those are the going rate, derived from
-- other people's offers.
revoke update on public.listings from anon, authenticated;
grant update (title, description, price_cents, location, event_date,
              image_urls, category_id, tags) on public.listings to authenticated;

-- The app only ever writes status here (decline, withdraw). Changing an amount
-- is an INSERT that supersedes, and accept_offer is a SECURITY DEFINER RPC
-- that grants do not touch.
revoke update on public.offers from anon, authenticated;
grant update (status) on public.offers to authenticated;

-- You may rename yourself, not award yourself completed deals or unsuspend
-- yourself.
revoke update on public.profiles from anon, authenticated;
grant update (full_name, profile_picture, instagram, onboarded_at)
  on public.profiles to authenticated;

-- page_views is written only through record_view(). A table-level INSERT grant
-- would let anyone with the anon key set `day` and backdate a thousand views;
-- a column-level one looks right and breaks PostgREST, which decides whether a
-- table is insertable by the TABLE privilege. So: no client grant at all.
revoke all on public.page_views from anon, authenticated;
revoke all on sequence public.page_views_id_seq from anon, authenticated;
grant select on public.page_views to authenticated;

-- Functions: anon may only record a view.
revoke all on function public.record_view(text, text, uuid) from public;
grant execute on function public.record_view(text, text, uuid) to anon, authenticated;

revoke all on function public.admin_stats() from public, anon;
revoke all on function public.admin_view_stats(int) from public, anon;
revoke all on function public.admin_reports(boolean) from public, anon;
revoke all on function public.admin_review_report(uuid, text) from public, anon;
revoke all on function public.admin_set_suspended(uuid, boolean) from public, anon;
grant execute on function public.admin_stats() to authenticated;
grant execute on function public.admin_view_stats(int) to authenticated;
grant execute on function public.admin_reports(boolean) to authenticated;
grant execute on function public.admin_review_report(uuid, text) to authenticated;
grant execute on function public.admin_set_suspended(uuid, boolean) to authenticated;

-- ============================================================= storage

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 5242880,
        '{image/jpeg,image/png,image/webp,image/heic}')
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('listing-photos', 'listing-photos', true, 5242880,
        '{image/jpeg,image/png,image/webp,image/heic}')
on conflict (id) do nothing;

-- Public read, owner-only write, and the first path segment must be the
-- owner's uid -- which is what makes `listing_image_urls_ok` meaningful.
create policy avatars_read on storage.objects
  for select to public using ((bucket_id = 'avatars'::text));
create policy avatars_write on storage.objects
  for insert to authenticated
  with check (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
create policy avatars_update on storage.objects
  for update to authenticated
  using (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
create policy avatars_delete on storage.objects
  for delete to authenticated
  using (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

create policy "listing photos are readable by anyone" on storage.objects
  for select to public using ((bucket_id = 'listing-photos'::text));
create policy "listing photos are written by their owner" on storage.objects
  for insert to authenticated
  with check (((bucket_id = 'listing-photos'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
create policy "listing photos are replaced by their owner" on storage.objects
  for update to authenticated
  using (((bucket_id = 'listing-photos'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
create policy "listing photos are removed by their owner" on storage.objects
  for delete to authenticated
  using (((bucket_id = 'listing-photos'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

-- =========================================================== categories

insert into public.categories (name) values
  ('Parties'), ('Concerts'), ('Sports'), ('Theater'), ('Formals')
on conflict (name) do nothing;

commit;
