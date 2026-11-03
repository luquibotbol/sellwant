-- SellWant — does this database actually enforce its own rules?
--
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f docs/handoff/verify.sql
--
-- Run it after schema.sql + seed.sql (+ any newer file in
-- sellwant/supabase/migrations/). It signs in as each role the way PostgREST
-- does -- SET ROLE plus the jwt claim -- and tries things that must fail, then
-- things that must work. Exits non-zero if any case disagrees.
--
-- Why this exists instead of "read the policies": RLS FILTERS, it does not
-- throw. A blocked UPDATE or DELETE returns success having changed nothing, so
-- a test that only looks for an error passes on a hole. Cases marked [rows]
-- count affected rows, and treat zero as "blocked".
--
-- Every case runs in a subtransaction that is always rolled back, so this
-- leaves your data exactly as it found it. Depends on the ids in seed.sql.

create or replace function pg_temp.try(r text, uid text, stmt text)
returns text language plpgsql as $f$
begin
  begin
    perform set_config('request.jwt.claim.sub', coalesce(uid, ''), true);
    perform set_config('request.jwt.claims',
      case when uid is null then '{}' else json_build_object('sub', uid, 'role', r)::text end, true);
    execute 'set local role ' || quote_ident(r);
    execute stmt;
    raise exception using message = '__allowed__';   -- forces the rollback
  exception when others then
    if sqlerrm = '__allowed__' then return 'allowed'; end if;
    return 'blocked';
  end;
end $f$;

create temp table cases (n serial, label text, want text, role text, uid text, stmt text);

\set maya    '11111111-1111-4111-8111-111111111111'
\set deshawn '22222222-2222-4222-8222-222222222222'

-- A [rows] statement is wrapped so that "changed 0 rows" raises.
insert into cases (label, want, role, uid, stmt) values

-- ---- the going rate: the one number strangers are asked to trust
('seller cannot UPDATE best_offer_cents on a listing',            'blocked', 'authenticated', :'deshawn',
 $s$ update listings set best_offer_cents = 99999 where id = 'aaaa0001-0000-4000-8000-000000000001' $s$),
('seller cannot INSERT a listing with a forged best_offer_cents', 'blocked', 'authenticated', :'deshawn',
 $s$ insert into listings (user_id,type,title,price_cents,best_offer_cents)
     values ('22222222-2222-4222-8222-222222222222','sell','x',1000,999999) $s$),
('seller cannot INSERT a listing with a forged offer_count',      'blocked', 'authenticated', :'deshawn',
 $s$ insert into listings (user_id,type,title,price_cents,offer_count)
     values ('22222222-2222-4222-8222-222222222222','sell','x',1000,42) $s$),
('seller CAN insert an ordinary listing',                         'allowed', 'authenticated', :'deshawn',
 $s$ insert into listings (user_id,type,title,price_cents,platform)
     values ('22222222-2222-4222-8222-222222222222','sell','ok',1000,'bubbl') $s$),
('poster cannot open a bare offer on their own listing',          'blocked', 'authenticated', :'maya',
 $s$ insert into offers (listing_id,from_user,amount_cents)
     values ('aaaa0003-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111',100) $s$),
('listing owner cannot rewrite the amount on a buyer''s offer',   'blocked', 'authenticated', :'deshawn',
 $s$ update offers set amount_cents = 1 where id = 'bbbb0001-0000-4000-8000-000000000001' $s$),
('a buyer cannot rewrite the amount on their own offer',          'blocked', 'authenticated', :'maya',
 $s$ update offers set amount_cents = 1 where id = 'bbbb0001-0000-4000-8000-000000000001' $s$),

-- ---- the person
('nobody can award themselves completed_deals',                   'blocked', 'authenticated', :'maya',
 $s$ update profiles set completed_deals = 99 where id = '11111111-1111-4111-8111-111111111111' $s$),
('nobody can flip their own is_suspended',                        'blocked', 'authenticated', :'maya',
 $s$ update profiles set is_suspended = false where id = '11111111-1111-4111-8111-111111111111' $s$),
('[rows] cannot edit another person''s listing',                  'blocked', 'authenticated', :'maya',
 $s$ do $d$ declare n int; begin
       update listings set title = 'hijacked' where id = 'aaaa0001-0000-4000-8000-000000000001';
       get diagnostics n = row_count; if n = 0 then raise exception 'filtered'; end if;
     end $d$ $s$),
('[rows] anon cannot read contact details',                       'blocked', 'anon', null,
 $s$ do $d$ begin if (select count(*) from contact_details) > 0 then return; end if;
       raise exception 'invisible'; end $d$ $s$),

-- ---- the deal: lock_ins has no UPDATE policy, advance_deal is the only door
('[rows] a party cannot UPDATE lock_ins directly',                'blocked', 'authenticated', :'maya',
 $s$ do $d$ declare n int; begin
       update lock_ins set state = 'confirmed' where id = 'cccc0001-0000-4000-8000-000000000001';
       get diagnostics n = row_count; if n = 0 then raise exception 'filtered'; end if;
     end $d$ $s$),
('[rows] a listing with a deal cannot be DELETEd',                'blocked', 'authenticated', :'deshawn',
 $s$ do $d$ declare n int; begin
       delete from listings where id = 'aaaa0002-0000-4000-8000-000000000002';
       get diagnostics n = row_count; if n = 0 then raise exception 'filtered'; end if;
     end $d$ $s$),
('seller cannot mark a deal paid',                                'blocked', 'authenticated', :'deshawn',
 $s$ select advance_deal('cccc0001-0000-4000-8000-000000000001','paid') $s$),
('buyer cannot confirm before paying',                            'blocked', 'authenticated', :'maya',
 $s$ select advance_deal('cccc0001-0000-4000-8000-000000000001','confirmed') $s$),
('buyer CAN mark paid, then confirm; both sides get credit',      'allowed', 'authenticated', :'maya',
 $s$ do $d$ begin
       perform advance_deal('cccc0001-0000-4000-8000-000000000001','paid');
       perform advance_deal('cccc0001-0000-4000-8000-000000000001','confirmed');
       if (select completed_deals from profiles where id = '11111111-1111-4111-8111-111111111111') <> 1
       or (select completed_deals from profiles where id = '22222222-2222-4222-8222-222222222222') <> 1
       or (select status from listings where id = 'aaaa0002-0000-4000-8000-000000000002') <> 'sold'
       then raise exception 'wrong end state'; end if;
     end $d$ $s$),
('a stranger cannot advance someone else''s deal',                'blocked', 'authenticated', '33333333-3333-4333-8333-333333333333',
 $s$ select advance_deal('cccc0001-0000-4000-8000-000000000001','cancelled') $s$),
('a listing''s owner CAN accept an offer on it',                  'allowed', 'authenticated', :'deshawn',
 $s$ select accept_offer('bbbb0001-0000-4000-8000-000000000001') $s$),
('someone else cannot accept an offer on that listing',           'blocked', 'authenticated', :'maya',
 $s$ select accept_offer('bbbb0001-0000-4000-8000-000000000001') $s$),

-- ---- the QR hashes: no client reads or writes them, ever
('a client cannot write ticket_codes directly',                   'blocked', 'authenticated', :'deshawn',
 $s$ insert into ticket_codes (listing_id, code_hash)
     values ('aaaa0001-0000-4000-8000-000000000001','deadbeef') $s$),

-- ---- impressions and the admin surface
('anon cannot write page_views directly (no backdating)',         'blocked', 'anon', null,
 $s$ insert into page_views (path,visit_id,day) values ('/x','forged1', current_date - 400) $s$),
('anon CAN record a view through the RPC',                        'allowed', 'anon', null,
 $s$ select record_view('/feed','verify-1',null) $s$),
('anon cannot read admin stats',                                  'blocked', 'anon', null,
 $s$ select admin_stats() $s$),
('a non-admin cannot read admin stats',                           'blocked', 'authenticated', :'deshawn',
 $s$ select admin_stats() $s$),
('an admin CAN read admin stats',                                 'allowed', 'authenticated', :'maya',
 $s$ select admin_stats() $s$);

select n, case when pg_temp.try(role, uid, stmt) = want then 'PASS' else 'FAIL' end as result,
       label, want as expected,
       pg_temp.try(role, uid, stmt) as got
into temp results
from cases order by n;

\pset pager off
select n, result, label, case when result = 'FAIL' then 'expected '||expected||', got '||got else '' end as detail
from results order by n;

select count(*) filter (where result = 'PASS') as passed,
       count(*) filter (where result = 'FAIL') as failed
from results;

do $d$ begin
  if exists (select 1 from results where result = 'FAIL') then
    raise exception 'verify.sql: % case(s) failed', (select count(*) from results where result = 'FAIL');
  end if;
end $d$;
