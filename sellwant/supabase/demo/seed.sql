-- SellWant hackathon demo seed. Synthetic people and events only.
--
-- For the isolated demo project ONLY (never production): it writes auth.users
-- directly. scripts/demo-database-sql.ts appends this to the schema and
-- migrations and substitutes __DEMO_PASSWORD__; the password never enters git.
--
--   buyer@demo.sellwant.com   Jordan Reyes  -- wants tickets
--   seller@demo.sellwant.com  Sam Okafor    -- PAYPAL_DEMO_SELLER_ID, mapped to
--                                              the sandbox merchant
--   judge@demo.sellwant.com   Judge         -- a clean account to explore with

begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change,
  email_change_token_new, email_change_token_current,
  phone_change, phone_change_token, reauthentication_token
)
select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', u.email,
       extensions.crypt('__DEMO_PASSWORD__', extensions.gen_salt('bf')),
       now(), now(), now(),
       '{"provider":"email","providers":["email"]}'::jsonb,
       jsonb_build_object('full_name', u.full_name),
       '', '', '', '', '', '', '', ''
from (values
  ('d0000001-0000-4000-8000-000000000001'::uuid, 'buyer@demo.sellwant.com',  'Jordan Reyes'),
  ('d0000002-0000-4000-8000-000000000002'::uuid, 'seller@demo.sellwant.com', 'Sam Okafor'),
  ('d0000003-0000-4000-8000-000000000003'::uuid, 'judge@demo.sellwant.com',  'Judge')
) as u(id, email, full_name)
on conflict (id) do nothing;

insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id,
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       'email', u.id::text, now(), now(), now()
from auth.users u
where u.id in ('d0000001-0000-4000-8000-000000000001', 'd0000002-0000-4000-8000-000000000002',
               'd0000003-0000-4000-8000-000000000003')
  and not exists (select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email');

-- handle_new_user() created profiles and contact_details; finish onboarding.
update public.profiles set onboarded_at = now()
 where id in ('d0000001-0000-4000-8000-000000000001', 'd0000002-0000-4000-8000-000000000002',
              'd0000003-0000-4000-8000-000000000003');
update public.profiles set instagram = 'jordan.reyes' where id = 'd0000001-0000-4000-8000-000000000001';
update public.profiles set instagram = 'sam.okafor'   where id = 'd0000002-0000-4000-8000-000000000002';

update public.contact_details set phone = '+15125550111',
       accepted_payments = '[{"kind":"paypal","value":"jordan-reyes-demo"}]'::jsonb
 where profile_id = 'd0000001-0000-4000-8000-000000000001';
update public.contact_details set phone = '+15125550122',
       accepted_payments = '[{"kind":"paypal","value":"sam-okafor-demo"}]'::jsonb
 where profile_id = 'd0000002-0000-4000-8000-000000000002';

-- The judge account can open /admin.
insert into public.admins (id, note)
values ('d0000003-0000-4000-8000-000000000003', 'hackathon judge')
on conflict (id) do nothing;

insert into public.listings (id, user_id, type, title, description, price_cents, location, event_date, category_id, status)
select l.id, l.user_id, l.type, l.title, l.description, l.price_cents, 'Austin',
       current_date + l.days, (select c.id from public.categories c where c.name = l.category), 'active'
from (values
  ('e0000001-0000-4000-8000-000000000001'::uuid, 'd0000002-0000-4000-8000-000000000002'::uuid, 'sell',
   'Sunday GA wristband — Zilker music festival', 'One wristband, never registered. Meet at the gate and we scan in together.', 9500, 12, 'Concerts'),
  ('e0000002-0000-4000-8000-000000000002'::uuid, 'd0000002-0000-4000-8000-000000000002'::uuid, 'sell',
   'Student ticket — Saturday home game', 'Student section, transferable in the app. Can meet on campus.', 6000, 5, 'Sports'),
  ('e0000003-0000-4000-8000-000000000003'::uuid, 'd0000002-0000-4000-8000-000000000002'::uuid, 'sell',
   'Floor GA — electronic show at the arena', 'Mobile ticket. Hand off at the box office before doors.', 8500, 20, 'Concerts'),
  ('e0000004-0000-4000-8000-000000000004'::uuid, 'd0000001-0000-4000-8000-000000000001'::uuid, 'ask',
   'Need 1 for the Friday DJ set downtown', 'Paying up to my posted price, can meet anywhere on 6th.', 7000, 8, 'Parties'),
  ('e0000005-0000-4000-8000-000000000005'::uuid, 'd0000001-0000-4000-8000-000000000001'::uuid, 'ask',
   'Looking for 2 to the spring formal', 'Together if possible.', 5000, 16, 'Formals')
) as l(id, user_id, type, title, description, price_cents, days, category)
on conflict (id) do nothing;

commit;
