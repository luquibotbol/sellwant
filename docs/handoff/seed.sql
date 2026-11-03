-- SellWant — development seed
--
-- Fake data for a LOCAL or private dev database. Run it after schema.sql, as
-- the `postgres` role. It contains no production data and no real person.
--
-- It writes directly into auth.users, which is only acceptable on a database
-- you own outright -- never against a shared or production project. If that
-- insert fails (GoTrue's columns move between versions), create the two users
-- in Studio -> Authentication -> Add user instead, then replace the two UUIDs
-- below with theirs and run the rest.
--
-- Both accounts:  password  devpass123
--   maya@example.edu     — buyer, and an admin so /admin is visible
--   deshawn@example.edu  — seller

begin;

-- ======================================================== two accounts

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change,
  email_change_token_new, email_change_token_current,
  phone_change, phone_change_token, reauthentication_token
) values
(
  '11111111-1111-4111-8111-111111111111',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'maya@example.edu',
  extensions.crypt('devpass123', extensions.gen_salt('bf')),
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"Maya Alvarez"}'::jsonb,
  '', '', '', '', '', '', '', ''
),
(
  '22222222-2222-4222-8222-222222222222',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'deshawn@example.edu',
  extensions.crypt('devpass123', extensions.gen_salt('bf')),
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"DeShawn Carter"}'::jsonb,
  '', '', '', '', '', '', '', ''
)
on conflict (id) do nothing;

-- Password sign-in needs a matching identity row in recent GoTrue versions.
insert into auth.identities (
  id, user_id, identity_data, provider, provider_id,
  last_sign_in_at, created_at, updated_at
) values
(
  gen_random_uuid(), '11111111-1111-4111-8111-111111111111',
  '{"sub":"11111111-1111-4111-8111-111111111111","email":"maya@example.edu","email_verified":true}'::jsonb,
  'email', '11111111-1111-4111-8111-111111111111', now(), now(), now()
),
(
  gen_random_uuid(), '22222222-2222-4222-8222-222222222222',
  '{"sub":"22222222-2222-4222-8222-222222222222","email":"deshawn@example.edu","email_verified":true}'::jsonb,
  'email', '22222222-2222-4222-8222-222222222222', now(), now(), now()
)
on conflict do nothing;

-- profiles and contact_details already exist: handle_new_user() made them on
-- the inserts above. Fill in what onboarding would have collected.
update public.profiles
   set onboarded_at = now(), instagram = 'maya.alv'
 where id = '11111111-1111-4111-8111-111111111111';

update public.profiles
   set onboarded_at = now(), instagram = 'dcarter'
 where id = '22222222-2222-4222-8222-222222222222';

update public.contact_details
   set phone = '+15125550101',
       accepted_payments = '[{"kind":"venmo","value":"@maya-alvarez"}]'::jsonb
 where profile_id = '11111111-1111-4111-8111-111111111111';

update public.contact_details
   set phone = '+15125550102',
       accepted_payments = '[{"kind":"zelle","value":"deshawn@example.edu"},
                             {"kind":"paypal","value":"dcarter"}]'::jsonb
 where profile_id = '22222222-2222-4222-8222-222222222222';

-- Maya can see /admin.
insert into public.admins (id, note)
values ('11111111-1111-4111-8111-111111111111', 'dev seed')
on conflict (id) do nothing;

-- ========================================================= the market

-- Prices are cents. `type` is the whole product: sell = I have one,
-- ask = I want one.
insert into public.listings
  (id, user_id, type, title, description, price_cents, location, event_date, category_id, status)
values
  ('aaaa0001-0000-4000-8000-000000000001',
   '22222222-2222-4222-8222-222222222222', 'sell',
   'Adam Port at Concourse', 'Hard ticket, meeting at the door. Can scan in together.',
   11000, 'Austin', (current_date + 9), 2, 'active'),

  ('aaaa0002-0000-4000-8000-000000000002',
   '22222222-2222-4222-8222-222222222222', 'sell',
   'Spring formal — one spot', 'Transferable, no date set yet.',
   4500, 'Dallas', null, 5, 'active'),

  ('aaaa0003-0000-4000-8000-000000000003',
   '11111111-1111-4111-8111-111111111111', 'ask',
   'Looking for 1 ticket to ñuna', 'Will pay cash on the spot, can meet anywhere downtown.',
   1400, 'Austin', (current_date + 2), 1, 'active'),

  ('aaaa0004-0000-4000-8000-000000000004',
   '11111111-1111-4111-8111-111111111111', 'ask',
   'Need 2 for the Saturday game', 'Together if possible.',
   6000, 'Houston', (current_date + 16), 3, 'active')
on conflict (id) do nothing;

-- Offers. The triggers derive the going rate from these: highest offer on a
-- sell, lowest on an ask, the poster's own counter excluded. Nothing below
-- writes best_offer_cents or offer_count by hand -- check them afterwards and
-- you are reading real derived values.
insert into public.offers (id, listing_id, from_user, amount_cents, message)
values
  ('bbbb0001-0000-4000-8000-000000000001',
   'aaaa0001-0000-4000-8000-000000000001',
   '11111111-1111-4111-8111-111111111111', 9000, 'Can do 90 tonight.'),

  ('bbbb0002-0000-4000-8000-000000000002',
   'aaaa0003-0000-4000-8000-000000000003',
   '22222222-2222-4222-8222-222222222222', 1600, 'I have a spare, 16?'),

  ('bbbb0003-0000-4000-8000-000000000003',
   'aaaa0004-0000-4000-8000-000000000004',
   '22222222-2222-4222-8222-222222222222', 7000, 'Two together, 70 for the pair.')
on conflict (id) do nothing;

-- A deal mid-handoff, on listing 2. Inserting into lock_ins fires the trigger
-- that locks the listing and declines the other offers -- the same thing
-- accept_offer() does, which cannot run here because it needs auth.uid().
--
-- Deal states record what someone SAID, never what the platform verified.
insert into public.lock_ins (id, listing_id, buyer_id, seller_id, locked_price_cents, state)
values
  ('cccc0001-0000-4000-8000-000000000001',
   'aaaa0002-0000-4000-8000-000000000002',
   '11111111-1111-4111-8111-111111111111',
   '22222222-2222-4222-8222-222222222222',
   4500, 'pending_payment')
on conflict (id) do nothing;

-- ===================================================== some traffic

-- So the admin charts have a shape. One row = one tab seeing one path on one
-- day, which is what the unique constraint enforces.
insert into public.page_views (path, visit_id, listing_id, day)
select
  p.path,
  'seed' || lpad((d * 10 + p.n)::text, 6, '0'),
  p.listing_id,
  (current_date - d)
from generate_series(0, 20) as d,
     (values
       ('/feed',  1, null::uuid),
       ('/',      2, null::uuid),
       ('/feed',  3, null::uuid),
       ('/event/aaaa0001-0000-4000-8000-000000000001', 4, 'aaaa0001-0000-4000-8000-000000000001'::uuid),
       ('/event/aaaa0003-0000-4000-8000-000000000003', 5, 'aaaa0003-0000-4000-8000-000000000003'::uuid)
     ) as p(path, n, listing_id)
where (d + p.n) % 3 <> 0
on conflict (visit_id, path, day) do nothing;

commit;

-- What you should see afterwards:
--
--   select title, type, price_cents, best_offer_cents, offer_count, status
--     from listings order by created_at;
--
-- 'Adam Port at Concourse'      sell  11000  9000  1  active
-- 'Spring formal — one spot'    sell   4500  null  0  locked   <- deal attached
-- 'Looking for 1 ticket …'      ask    1400  1600  1  active
-- 'Need 2 for the Saturday game'ask    6000  7000  1  active
