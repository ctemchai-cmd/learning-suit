-- Structure, grants and policy inventory (plan05 §3–§4, ADR 0004).
begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

select has_table('public', 'projects', 'projects table exists');
select has_table('public', 'project_assets', 'project_assets table exists');
select ok((select relrowsecurity from pg_class where oid = 'public.projects'::regclass), 'RLS is enabled on projects');
select ok((select relrowsecurity from pg_class where oid = 'public.project_assets'::regclass), 'RLS is enabled on project_assets');

-- anon: no table or column privileges at all (Supabase default privileges were revoked).
select ok(not has_table_privilege('anon', 'public.projects', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
  'anon has no table privilege on projects');
select ok(not has_any_column_privilege('anon', 'public.projects', 'SELECT,INSERT,UPDATE,REFERENCES'),
  'anon has no column privilege on projects');
select ok(not has_table_privilege('anon', 'public.project_assets', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
  'anon has no table privilege on project_assets');
select ok(not has_any_column_privilege('anon', 'public.project_assets', 'SELECT,INSERT,UPDATE,REFERENCES'),
  'anon has no column privilege on project_assets');

-- authenticated: SELECT/INSERT/DELETE on the table, UPDATE only on specific columns.
select table_privs_are('public', 'projects', 'authenticated', array['SELECT', 'INSERT', 'DELETE'],
  'authenticated table privileges on projects are SELECT/INSERT/DELETE');
select table_privs_are('public', 'project_assets', 'authenticated', array['SELECT', 'INSERT', 'DELETE'],
  'authenticated table privileges on project_assets are SELECT/INSERT/DELETE');
select is(
  (select array_agg(attname::text order by attname::text)
   from pg_attribute
   where attrelid = 'public.projects'::regclass and attnum > 0 and not attisdropped
     and has_column_privilege('authenticated', attrelid, attnum, 'UPDATE')),
  array['deleted_at', 'document', 'is_ready', 'last_mutation_id', 'revision', 'title'],
  'authenticated may UPDATE only title/document/revision/last_mutation_id/is_ready/deleted_at');
select is(
  (select array_agg(attname::text order by attname::text)
   from pg_attribute
   where attrelid = 'public.project_assets'::regclass and attnum > 0 and not attisdropped
     and has_column_privilege('authenticated', attrelid, attnum, 'UPDATE')),
  array['upload_state'],
  'authenticated may UPDATE only project_assets.upload_state');

-- RPC execute grants.
select ok(not has_function_privilege('anon', 'public.reserve_project(uuid,text,uuid)', 'EXECUTE'),
  'anon cannot execute reserve_project');
select ok(not has_function_privilege('anon', 'public.save_project(uuid,integer,uuid,text,jsonb)', 'EXECUTE'),
  'anon cannot execute save_project');
select ok(not has_function_privilege('anon', 'public.mark_project_deleted(uuid,integer,uuid)', 'EXECUTE'),
  'anon cannot execute mark_project_deleted');
select ok(has_function_privilege('authenticated', 'public.reserve_project(uuid,text,uuid)', 'EXECUTE'),
  'authenticated can execute reserve_project');
select ok(has_function_privilege('authenticated', 'public.save_project(uuid,integer,uuid,text,jsonb)', 'EXECUTE'),
  'authenticated can execute save_project');
select ok(has_function_privilege('authenticated', 'public.mark_project_deleted(uuid,integer,uuid)', 'EXECUTE'),
  'authenticated can execute mark_project_deleted');
select ok(
  (select bool_and(p.proacl is not null
                   and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0))
   from pg_proc p
   where p.oid in ('public.reserve_project(uuid,text,uuid)'::regprocedure,
                   'public.save_project(uuid,integer,uuid,text,jsonb)'::regprocedure,
                   'public.mark_project_deleted(uuid,integer,uuid)'::regprocedure)),
  'no RPC keeps the default PUBLIC execute grant');
select is(
  (select count(*)
   from pg_proc p
   where p.oid in ('public.reserve_project(uuid,text,uuid)'::regprocedure,
                   'public.save_project(uuid,integer,uuid,text,jsonb)'::regprocedure,
                   'public.mark_project_deleted(uuid,integer,uuid)'::regprocedure)
     and not p.prosecdef
     and p.proconfig = array['search_path=""']),
  3::bigint,
  'all RPCs are SECURITY INVOKER with SET search_path = ''''');

-- Private bucket.
select is((select public from storage.buckets where id = 'project-assets'), false, 'project-assets bucket is private');
select is((select file_size_limit from storage.buckets where id = 'project-assets'), 10485760::bigint,
  'project-assets bucket limits objects to 10 MiB');
select is((select allowed_mime_types from storage.buckets where id = 'project-assets'),
  array['image/png', 'image/jpeg', 'image/webp'], 'project-assets bucket allows only PNG/JPEG/WebP');

-- storage.objects policies for the bucket: SELECT, INSERT, DELETE only.
select is(
  (select array_agg(cmd order by cmd) from pg_policies
   where schemaname = 'storage' and tablename = 'objects' and policyname like 'project\_assets\_objects\_%'),
  array['DELETE', 'INSERT', 'SELECT'],
  'project-assets object policies cover SELECT/INSERT/DELETE');
select is(
  (select count(*) from pg_policies
   where schemaname = 'storage' and tablename = 'objects' and cmd in ('UPDATE', 'ALL')
     and (coalesce(qual, '') like '%project-assets%' or coalesce(with_check, '') like '%project-assets%')),
  0::bigint,
  'no UPDATE/ALL policy exists for project-assets objects (immutable bytes, no upsert)');

select has_trigger('public', 'projects', 'projects_before_write', 'projects immutability/updated_at trigger exists');
select has_trigger('public', 'project_assets', 'project_assets_before_write', 'project_assets immutability trigger exists');

select policies_are('public', 'projects',
  array['projects_select_own', 'projects_insert_own_reservation', 'projects_update_own', 'projects_delete_own_tombstone'],
  'projects has exactly the owner policies');
select policies_are('public', 'project_assets',
  array['project_assets_select_own', 'project_assets_insert_own', 'project_assets_update_own', 'project_assets_delete_own'],
  'project_assets has exactly the parent-owner policies');
select is(
  (select count(*) from pg_policies
   where schemaname = 'public' and tablename in ('projects', 'project_assets')
     and roles <> array['authenticated']::name[]),
  0::bigint,
  'every application policy applies to the authenticated role only');

select * from finish();
rollback;
