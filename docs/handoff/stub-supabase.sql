-- SellWant — stand-in for the parts of Supabase that schema.sql assumes exist.
--
-- ONLY for running schema.sql on a plain PostgreSQL (14+) with no Supabase
-- around it -- brew install postgresql, a throwaway container, whatever. If you
-- are using `supabase start` or a hosted Supabase project, DO NOT run this:
-- all of it already exists there, and the real versions are not these.
--
-- What it fakes: the anon / authenticated / service_role roles, auth.users,
-- auth.identities, auth.uid() and auth.jwt() (read from the same settings
-- PostgREST sets: request.jwt.claim.sub / request.jwt.claims), and a minimal
-- storage.buckets / storage.objects / storage.foldername().
--
-- What it does NOT fake: GoTrue (sign-in, tokens), PostgREST, or Storage's own
-- API. This is enough to load the schema, run seed.sql, and run verify.sql --
-- which is the point -- but it cannot serve the app. For the app you need a
-- real Supabase.
--
-- Tested on PostgreSQL 14.19. Roles are cluster-wide, hence the guards.

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon')          then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role')  then create role service_role nologin bypassrls; end if;
end $$;
create schema extensions; create extension pgcrypto with schema extensions;
create schema auth;
create table auth.users (
  id uuid primary key, instance_id uuid, aud text, role text, email text, phone text,
  encrypted_password text, email_confirmed_at timestamptz, last_sign_in_at timestamptz,
  created_at timestamptz default now(), updated_at timestamptz default now(),
  raw_app_meta_data jsonb, raw_user_meta_data jsonb,
  confirmation_token text, recovery_token text, email_change text,
  email_change_token_new text, email_change_token_current text,
  phone_change text, phone_change_token text, reauthentication_token text);
create table auth.identities (
  id uuid primary key, user_id uuid references auth.users(id) on delete cascade,
  identity_data jsonb, provider text, provider_id text,
  last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid default gen_random_uuid() primary key, bucket_id text, name text);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as
  $$ select string_to_array(name, '/') $$;
grant usage on schema auth, storage, extensions to anon, authenticated;
grant execute on function auth.uid(), auth.jwt() to anon, authenticated;
grant all on all tables in schema storage to anon, authenticated;
