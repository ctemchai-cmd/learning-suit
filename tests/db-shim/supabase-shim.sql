-- Supabase compatibility shim for PLAIN PostgreSQL (local harness only).
--
-- This is NOT Supabase. It reproduces only the pieces of a Supabase database
-- that supabase/migrations/*.sql and supabase/tests/database/*.test.sql rely
-- on, so the SQL, RLS and RPC semantics can be exercised on a stock
-- PostgreSQL 16 cluster when Docker / the Supabase CLI are unavailable:
--
--   * API roles anon / authenticated / service_role (+ authenticator) with the
--     schema USAGE grants and the public-schema DEFAULT PRIVILEGES Supabase
--     ships (new tables/functions/sequences in public are granted to the API
--     roles, which is why the migration must `revoke all` explicitly).
--   * `extensions` schema (pgTAP is installed there by the harness).
--   * `auth` schema: a reduced auth.users table and auth.uid() / auth.role() /
--     auth.jwt() reading `request.jwt.claims` exactly like Supabase does.
--   * `storage` schema: buckets/objects tables with the columns the Storage
--     API uses, RLS enabled, ALL granted to the API roles (policies decide),
--     plus storage.foldername()/filename()/extension() and the direct-delete protection trigger
--     (Storage migration 0055) that the Storage API bypasses with storage.allow_delete_query.
--
-- The real Storage API (upload/download HTTP, bucket MIME/size enforcement)
-- and PostgREST/GoTrue are NOT emulated; tests/integration covers those
-- against a real local Supabase stack.

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit;
  end if;
end
$$;

grant anon, authenticated, service_role to authenticator;

-- ---------------------------------------------------------------------------
-- public schema grants (mirrors supabase/postgres initial schema)
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- extensions schema
-- ---------------------------------------------------------------------------
create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- auth schema
-- ---------------------------------------------------------------------------
create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create table if not exists auth.users (
  instance_id uuid,
  id uuid primary key,
  aud varchar(255),
  role varchar(255),
  email varchar(255),
  encrypted_password varchar(255),
  email_confirmed_at timestamptz,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  is_sso_user boolean not null default false,
  is_anonymous boolean not null default false
);
create unique index if not exists users_email_partial_key on auth.users (email) where (is_sso_user = false);
-- Supabase does not grant auth.users to the API roles.

create or replace function auth.uid() returns uuid
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create or replace function auth.role() returns text
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

create or replace function auth.jwt() returns jsonb
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

grant execute on function auth.uid(), auth.role(), auth.jwt() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- storage schema
-- ---------------------------------------------------------------------------
create schema if not exists storage;
grant usage on schema storage to anon, authenticated, service_role;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  owner uuid,
  owner_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  public boolean default false,
  avif_autodetection boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  type text not null default 'STANDARD'
);
create unique index if not exists bname on storage.buckets using btree (name);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  owner_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_accessed_at timestamptz default now(),
  metadata jsonb,
  path_tokens text[] generated always as (string_to_array(name, '/')) stored,
  version text,
  user_metadata jsonb,
  archived_at timestamptz,
  is_delete_marker boolean not null default false,
  is_versioned boolean not null default false
);
-- Storage migrations 0066/0067: one current (non-archived) object per (bucket_id, name).
create unique index if not exists idx_objects_current_version
  on storage.objects (bucket_id, name collate "C") where archived_at is null;

-- Storage migration 0055-prevent-direct-deletes: SQL deletes are refused unless the caller sets
-- storage.allow_delete_query (the Storage API does, as the requesting user's role, before its DELETE).
create or replace function storage.protect_delete() returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('storage.allow_delete_query', true), 'false') != 'true' then
    raise exception 'Direct deletion from storage tables is not allowed. Use the Storage API instead.'
      using hint = 'This prevents accidental data loss from orphaned objects.', errcode = '42501';
  end if;
  return null;
end
$$;
create trigger protect_buckets_delete before delete on storage.buckets
  for each statement execute function storage.protect_delete();
create trigger protect_objects_delete before delete on storage.objects
  for each statement execute function storage.protect_delete();

alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;

grant all on table storage.buckets to anon, authenticated, service_role;
grant all on table storage.objects to anon, authenticated, service_role;

create or replace function storage.foldername(name text) returns text[]
language plpgsql immutable
as $$
declare
  _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end
$$;

create or replace function storage.filename(name text) returns text
language plpgsql immutable
as $$
declare
  _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[array_length(_parts, 1)];
end
$$;

create or replace function storage.extension(name text) returns text
language plpgsql immutable
as $$
declare
  _parts text[];
  _filename text;
begin
  select string_to_array(name, '/') into _parts;
  select _parts[array_length(_parts, 1)] into _filename;
  return reverse(split_part(reverse(_filename), '.', 1));
end
$$;

grant execute on function storage.foldername(text), storage.filename(text), storage.extension(text)
  to anon, authenticated, service_role;
