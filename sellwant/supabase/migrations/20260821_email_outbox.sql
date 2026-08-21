-- Notifications. Nothing has ever told anyone anything.
--
-- An offer arrives and the only way the poster learns about it is by reopening
-- the app. On a marketplace where the ticket stops being worth anything the
-- moment the party starts, that silence is how a deal that both sides wanted
-- fails to happen.
--
-- The delivery path is an outbox rather than a webhook. `pg_net` fires and
-- forgets: one 500 from the mail provider and the email is gone, with nothing
-- left behind to say it ever existed. A row is a thing you can query when
-- somebody says "I was never told", and a thing a retry can pick back up. The
-- Worker drains it on a cron.
--
-- Nothing here can make an offer fail. The trigger swallows every error for
-- the same reason `record_view` does: a person acting on this site must never
-- be shown a failure that belongs to our bookkeeping.

-- ------------------------------------------------------------------ prefs

-- Cascade is right here, unusually. The downstream row is the user's OWN
-- preference and belongs to nobody else -- unlike lock_ins or reports, where
-- a cascade destroys the counterparty's record of a trade they were part of.
create table if not exists public.email_prefs (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  offer_received boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.email_prefs enable row level security;

-- Your own row, and only ever your own. There is no admin read: what somebody
-- has chosen not to hear about is not a founder metric.
drop policy if exists email_prefs_own on public.email_prefs;
create policy email_prefs_own on public.email_prefs
for select to authenticated using (profile_id = auth.uid());

drop policy if exists email_prefs_own_update on public.email_prefs;
create policy email_prefs_own_update on public.email_prefs
for update to authenticated
using (profile_id = auth.uid())
-- Both clauses, deliberately. An UPDATE policy with no WITH CHECK reuses its
-- USING clause, which is how a seller once came to be able to rewrite the
-- amount on a buyer's offer.
with check (profile_id = auth.uid());

revoke all on public.email_prefs from anon, authenticated;
-- Column-level, so nobody can backdate updated_at. Note this makes the table
-- non-insertable through PostgREST -- see 20260820_page_views_rpc.sql, where
-- exactly that silently broke every write. Deliberate: rows are created by
-- set_email_pref below, never by a client INSERT.
grant select on public.email_prefs to authenticated;
grant update (offer_received) on public.email_prefs to authenticated;

-- ----------------------------------------------------------------- outbox

create table if not exists public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  -- Snapshotted at enqueue time, not looked up at send time. The address that
  -- was verified when the offer landed is the address this is about; a later
  -- change should not silently redirect an old notification.
  to_email text not null,
  to_profile uuid references public.profiles(id) on delete set null,
  -- SET NULL rather than CASCADE: a deleted listing does not unmake the fact
  -- that we owed somebody an email about it.
  listing_id uuid references public.listings(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  -- Not now(). A listing that catches fire produces one offer a minute, and a
  -- person who gets eight emails in ten minutes unsubscribes from all of them.
  -- The drain collapses everything still sitting here into one message.
  send_after timestamptz not null default (now() + interval '5 minutes'),
  claimed_at timestamptz,
  sent_at timestamptz,
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  constraint email_outbox_kind check (kind in ('offer_received'))
);

-- The drain's query, and only it. Partial on sent_at because a sent row is
-- never read again by anything on the hot path, and this table grows with
-- traffic rather than with users.
create index if not exists email_outbox_pending_idx
  on public.email_outbox (send_after)
  where sent_at is null;

alter table public.email_outbox enable row level security;

-- No policies at all, on purpose. Every row is somebody's email address next
-- to what they were offered. RLS is enabled so that a future grant made by
-- accident still fails closed, and the grants below leave anon and
-- authenticated with nothing. Only the Worker's secret key reaches this, and
-- only through the three functions below.
revoke all on public.email_outbox from anon, authenticated;

-- ---------------------------------------------------------------- enqueue

/**
 * Queue the "you have an offer" email.
 *
 * SECURITY DEFINER because the verified address lives in auth.users, which no
 * client role can read -- and it is the right address to use. contact_details
 * .email is optional, user-entered and never confirmed, so half of it is
 * blank and the rest is unproven.
 */
create or replace function public.enqueue_offer_email() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_listing listings%rowtype;
  v_recipient uuid;
  v_email text;
begin
  select * into v_listing from listings where id = new.listing_id;
  if not found then return new; end if;

  -- Who actually hears about this.
  --
  -- Usually the poster. But a poster is allowed to counter an offer on their
  -- own listing -- that is the whole point of 20260818, countering is how a
  -- seller negotiates -- and mailing them about their own action would be
  -- both useless and the fastest possible route to an unsubscribe. A counter
  -- goes to the person it answers.
  if new.from_user = v_listing.user_id then
    select o.from_user into v_recipient from offers o where o.id = new.parent_offer_id;
  else
    v_recipient := v_listing.user_id;
  end if;

  if v_recipient is null or v_recipient = new.from_user then return new; end if;

  -- Absent row means opted in. Writing a row per user at signup would be a
  -- migration over auth.users and a second thing to keep in step.
  if exists (
    select 1 from email_prefs p
    where p.profile_id = v_recipient and p.offer_received is false
  ) then
    return new;
  end if;

  -- Unconfirmed addresses are skipped rather than queued and bounced: with
  -- DMARC at p=reject, mail to an address that never proved it exists is a
  -- deliverability cost paid for nothing.
  select u.email into v_email
  from auth.users u
  where u.id = v_recipient and u.email_confirmed_at is not null;
  if v_email is null then return new; end if;

  insert into email_outbox (kind, to_email, to_profile, listing_id, payload)
  values (
    'offer_received', v_email, v_recipient, v_listing.id,
    jsonb_build_object(
      'listing_title', v_listing.title,
      'listing_type', v_listing.type,
      'amount_cents', new.amount_cents,
      'message', new.message,
      'is_counter', new.parent_offer_id is not null
    )
  );
  return new;
exception
  -- An offer must never fail because we could not queue an email about it.
  when others then return new;
end;
$$;

drop trigger if exists offers_enqueue_email on public.offers;
create trigger offers_enqueue_email after insert on public.offers
for each row execute function public.enqueue_offer_email();

-- ------------------------------------------------------------------ drain

/**
 * Hand the Worker a batch to send, collapsed to one message per person per
 * listing.
 *
 * Two cron runs overlap the moment one of them is slow, so the claim has to be
 * atomic: FOR UPDATE SKIP LOCKED is what stops both of them picking up the
 * same row and sending it twice. `attempts` is incremented here rather than on
 * success, so a row that kills the sender every time stops after five tries
 * instead of retrying until the end of time.
 *
 * A claim older than five minutes is considered abandoned -- the Worker died
 * mid-send -- and becomes eligible again. The Resend idempotency key is what
 * makes that safe to repeat.
 */
create or replace function public.claim_email_batch(p_limit int default 20)
returns table (
  id uuid,
  kind text,
  to_email text,
  to_profile uuid,
  listing_id uuid,
  payload jsonb,
  collapsed int
)
language plpgsql security definer set search_path = public as $$
-- RETURNS TABLE makes `id`, `kind`, `to_email` and the rest into variables as
-- well as columns, and plpgsql compiles lazily -- so an unqualified reference
-- to one of them would not fail at CREATE time, or at deploy time, but the
-- first time the cron actually ran. Every reference below is qualified; this
-- says what to do if one ever stops being, instead of leaving it to be found
-- in production.
#variable_conflict use_column
begin
  return query
  with due as (
    select o.id, o.kind, o.to_email, o.to_profile, o.listing_id, o.payload, o.created_at
    from email_outbox o
    where o.sent_at is null
      and o.attempts < 5
      and o.send_after <= now()
      and (o.claimed_at is null or o.claimed_at < now() - interval '5 minutes')
    order by o.send_after
    limit greatest(p_limit, 1)
    for update skip locked
  ),
  grouped as (
    -- The newest offer is the one worth showing: it is the current state of
    -- the negotiation, and the older ones are already history by the time
    -- anyone opens this.
    select d.to_email, d.kind, d.listing_id,
           (array_agg(d.id order by d.created_at desc))[1] as keep_id,
           count(*)::int as collapsed
    from due d
    group by d.to_email, d.kind, d.listing_id
  ),
  claimed as (
    update email_outbox o
       set claimed_at = now(), attempts = o.attempts + 1
     where o.id in (select g.keep_id from grouped g)
    returning o.id
  ),
  superseded as (
    -- Retired, not sent. They were folded into the keeper's count, and
    -- leaving them pending would mail the same person again next minute.
    update email_outbox o
       set sent_at = now(), last_error = 'collapsed'
     where o.id in (select d.id from due d)
       and o.id not in (select g.keep_id from grouped g)
    returning o.id
  )
  select o.id, o.kind, o.to_email, o.to_profile, o.listing_id, o.payload, g.collapsed
  from grouped g
  join email_outbox o on o.id = g.keep_id
  -- Forces both data-modifying CTEs to run: an unreferenced one still
  -- executes, but relying on that is relying on a detail nobody should have
  -- to know to read this.
  where (select count(*) from claimed) >= 0
    and (select count(*) from superseded) >= 0;
end;
$$;

create or replace function public.mark_email_sent(p_id uuid) returns void
language sql security definer set search_path = public as $$
  update email_outbox set sent_at = now(), last_error = null where id = p_id;
$$;

/**
 * Release a claim so the next run can try again. `attempts` is not touched --
 * it was already spent at claim time, which is what bounds the retries.
 */
create or replace function public.mark_email_failed(p_id uuid, p_error text)
returns void
language sql security definer set search_path = public as $$
  update email_outbox
     set claimed_at = null, last_error = left(coalesce(p_error, 'unknown'), 500)
   where id = p_id;
$$;

-- ------------------------------------------------------------- unsubscribe

/**
 * Turn one kind of email off (or back on) for one person.
 *
 * Called by the Worker on behalf of somebody who clicked unsubscribe, so it
 * takes the profile id directly rather than reading auth.uid(). What proves
 * they are that person is the HMAC in the link, checked in the Worker before
 * this is ever called -- deliberately not a stored token, because the only
 * table it could sit on is readable by every signed-in account.
 */
create or replace function public.set_email_pref(
  p_profile uuid, p_kind text, p_on boolean
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_kind <> 'offer_received' then return; end if;
  insert into email_prefs (profile_id, offer_received, updated_at)
  values (p_profile, p_on, now())
  on conflict (profile_id) do update
    set offer_received = excluded.offer_received, updated_at = now();
end;
$$;

-- Nothing in this file is callable by a browser. The enqueue trigger runs as
-- part of an INSERT nobody calls directly; the rest is the Worker's, holding
-- the secret key.
revoke all on function public.claim_email_batch(int) from public, anon, authenticated;
revoke all on function public.mark_email_sent(uuid) from public, anon, authenticated;
revoke all on function public.mark_email_failed(uuid, text) from public, anon, authenticated;
revoke all on function public.set_email_pref(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.claim_email_batch(int) to service_role;
grant execute on function public.mark_email_sent(uuid) to service_role;
grant execute on function public.mark_email_failed(uuid, text) to service_role;
grant execute on function public.set_email_pref(uuid, text, boolean) to service_role;
