-- Page impressions.
--
-- What this deliberately does not store: no IP, no cookie, no user id, no
-- user agent, nothing that survives a reload. A row is a path, optionally the
-- listing it was, a random id that lives in one browser tab, and a date. The
-- privacy policy says exactly this, and it has to stay true.
--
-- The unique constraint is the interesting part. Without it an impression is
-- "any time anything hit the endpoint", which counts a person refreshing five
-- times as five people and lets anyone inflate a listing by holding down F5.
-- With it, a row is one tab seeing one path on one day, which is both the
-- number that answers "how many people saw this" and a floor under how much
-- casual noise a single visitor can add.

create table if not exists public.page_views (
  id bigserial primary key,
  path text not null,
  -- SET NULL, not CASCADE. Deleting a listing should not erase the record
  -- that people looked at it -- the same reasoning that keeps a deal alive
  -- when one side leaves.
  listing_id uuid references public.listings(id) on delete set null,
  visit_id text not null,
  day date not null default ((now() at time zone 'utc')::date),
  created_at timestamptz not null default now(),
  constraint page_views_path_len check (char_length(path) between 1 and 200),
  constraint page_views_visit_len check (char_length(visit_id) between 4 and 64),
  constraint page_views_once_per_tab_per_day unique (visit_id, path, day)
);

-- The two questions this table exists to answer, and the shape each needs.
create index if not exists page_views_day_idx on public.page_views (day desc);
create index if not exists page_views_listing_idx
  on public.page_views (listing_id, day desc) where listing_id is not null;

alter table public.page_views enable row level security;

-- Written by the worker with the anon key, which is public by definition, so
-- this is genuinely open. The unique constraint is what bounds it; the columns
-- are chosen so that a forged row reveals and costs nothing beyond a count.
drop policy if exists page_views_insert on public.page_views;
create policy page_views_insert on public.page_views
for insert to anon, authenticated with check (true);

-- Reading is the privileged half: these are the founders' numbers.
drop policy if exists page_views_admin_read on public.page_views;
create policy page_views_admin_read on public.page_views
for select to authenticated using (is_admin());

revoke all on public.page_views from anon, authenticated;
grant insert (path, listing_id, visit_id) on public.page_views to anon, authenticated;
grant select on public.page_views to authenticated;
grant usage, select on sequence public.page_views_id_seq to anon, authenticated;

/**
 * Traffic for the dashboard.
 *
 * Aggregated in Postgres rather than by pulling rows to the client, because
 * unlike signups this table grows with traffic rather than with users -- the
 * one place on this screen where the row count is not naturally small.
 */
create or replace function public.admin_view_stats(p_days int default 30)
returns json
language sql stable security definer set search_path = public as $$
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
$$;

revoke all on function public.admin_view_stats(int) from public, anon;
grant execute on function public.admin_view_stats(int) to authenticated;
