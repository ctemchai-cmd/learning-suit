-- project_assets RLS (SEC-02 asset rules) and storage.objects policies at the SQL level (SEC-03 subset).
-- The Storage API performs these same INSERT/SELECT/DELETE statements on storage.objects as the
-- caller's role; HTTP-level checks (download, public URL) live in tests/integration.
--   A   = 11111111-1111-4111-8111-111111111111   B   = 22222222-2222-4222-8222-222222222222
--   PA1 = a1111111-0000-4000-8000-000000000001   PA2 = a1111111-0000-4000-8000-000000000002 (tombstoned later)
--   PB1 = b2222222-0000-4000-8000-000000000001
--   Xn  = d0000000-0000-4000-8000-00000000000n   XB  = db000000-0000-4000-8000-000000000001
begin;
create extension if not exists pgtap with schema extensions;
select plan(45);

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'pgtap-assets-a@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'pgtap-assets-b@example.test');

-- Supabase Storage refuses direct SQL deletes on storage.objects unless this GUC is set; the Storage
-- API sets it (under the caller's role) before issuing its DELETE, so RLS remains the deciding check.
set local storage.allow_delete_query to 'true';

create function pg_temp.affected(p_sql text) returns bigint
language plpgsql as $$
declare
  n bigint;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end
$$;

create function pg_temp.id(p_name text) returns uuid
language sql immutable as $$
  select (case p_name
    when 'A' then '11111111-1111-4111-8111-111111111111'
    when 'B' then '22222222-2222-4222-8222-222222222222'
    when 'PA1' then 'a1111111-0000-4000-8000-000000000001'
    when 'PA2' then 'a1111111-0000-4000-8000-000000000002'
    when 'PB1' then 'b2222222-0000-4000-8000-000000000001'
    when 'XB' then 'db000000-0000-4000-8000-000000000001'
    else 'd0000000-0000-4000-8000-00000000000' || substr(p_name, 2, 1)  -- X1..X9
  end)::uuid
$$;

-- `<owner>/<project>/<asset>.<ext>` built from fixture names.
create function pg_temp.path(p_owner text, p_project text, p_asset text, p_ext text default 'png') returns text
language sql immutable as $$
  select pg_temp.id(p_owner)::text || '/' || pg_temp.id(p_project)::text || '/' || pg_temp.id(p_asset)::text || '.' || p_ext
$$;

-- Register asset metadata (pending by default) for `p_project` at `p_path`.
create function pg_temp.register_sql(p_asset text, p_project text, p_path text, p_mime text default 'image/png',
                                     p_state text default 'pending') returns text
language sql immutable as $$
  select format(
    'insert into public.project_assets (id, project_id, storage_path, mime_type, width, height, byte_length, sha256, upload_state) '
    'values (%L, %L, %L, %L, 64, 64, 2048, %L, %L)',
    pg_temp.id(p_asset), pg_temp.id(p_project), p_path, p_mime, repeat('a', 64), p_state)
$$;

create function pg_temp.object_sql(p_bucket text, p_name text, p_owner text) returns text
language sql immutable as $$
  select format('insert into storage.objects (bucket_id, name, owner_id) values (%L, %L, %L)',
                p_bucket, p_name, pg_temp.id(p_owner)::text)
$$;

-- Fixtures (table owner, bypasses RLS).
insert into storage.buckets (id, name, public) values ('ls-pgtap-other-bucket', 'ls-pgtap-other-bucket', true);
insert into public.projects (id, owner_id, title, document, revision, is_ready)
select pg_temp.id(p), pg_temp.id(o), t,
       jsonb_build_object('schemaVersion', 1, 'assets', '{}'::jsonb,
         'slides', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'name', 'Slide',
                                                        'background', '#FFFFFF', 'nodes', '[]'::jsonb))),
       1, true
from (values ('PA1', 'A', 'A lesson'), ('PA2', 'A', 'A doomed lesson'), ('PB1', 'B', 'B lesson')) f(p, o, t);
do $$ begin execute pg_temp.register_sql('XB', 'PB1', pg_temp.path('B', 'PB1', 'XB')); end $$;

-- ===================================================================== user A: metadata
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

select lives_ok(pg_temp.register_sql('X1', 'PA1', pg_temp.path('A', 'PA1', 'X1')),
  'A registers pending metadata with the canonical path');
select throws_ok(pg_temp.register_sql('X9', 'PA1', pg_temp.path('B', 'PA1', 'X9')), '42501', null,
  'SEC-02: a path under another owner''s prefix is rejected');
select throws_ok(pg_temp.register_sql('X8', 'PA1', pg_temp.path('A', 'PA1', 'X8', 'jpg')), '42501', null,
  'SEC-02: a path whose extension does not match the MIME type is rejected');
select throws_ok(pg_temp.register_sql('X7', 'PB1', pg_temp.path('A', 'PB1', 'X7')), '42501', null,
  'SEC-02: A cannot attach metadata to B''s project');
select throws_ok(pg_temp.register_sql('X6', 'PA1', pg_temp.path('A', 'PA1', 'X6'), 'image/png', 'ready'), '42501', null,
  'metadata must be registered as pending (cannot claim ready up front)');
select throws_ok(
  format('update public.project_assets set project_id = %L where id = %L', pg_temp.id('PA2'), pg_temp.id('X1')),
  '42501', null, 'SEC-02: an asset cannot move to another project');
select throws_ok(
  format('update public.project_assets set storage_path = %L where id = %L', pg_temp.path('A', 'PA1', 'X5'), pg_temp.id('X1')),
  '42501', null, 'SEC-02: an asset path cannot change');
select throws_ok(
  format('update public.project_assets set sha256 = %L, width = 1 where id = %L', repeat('b', 64), pg_temp.id('X1')),
  '42501', null, 'asset metadata (sha256/dimensions) is immutable for clients');
select ok(
  exists(select 1 from public.project_assets where id = pg_temp.id('X1') and upload_state = 'pending'),
  'A can read the own asset metadata');

-- ===================================================================== user A: storage objects
select lives_ok(pg_temp.object_sql('project-assets', pg_temp.path('A', 'PA1', 'X1'), 'A'),
  'A can upload (insert the object row) for a pending own asset');
select is(
  (select count(*) from storage.objects where bucket_id = 'project-assets'),
  1::bigint,
  'A sees exactly the own object');
select throws_ok(pg_temp.object_sql('project-assets', pg_temp.path('A', 'PA1', 'X4'), 'A'), '42501', null,
  'objects without registered metadata cannot be uploaded');
select throws_ok(pg_temp.object_sql('project-assets', pg_temp.path('B', 'PB1', 'XB'), 'A'), '42501', null,
  'A cannot upload into B''s prefix even for B''s pending asset');
select throws_ok(pg_temp.object_sql('ls-pgtap-other-bucket', pg_temp.path('A', 'PA1', 'X1'), 'A'), '42501', null,
  'project-assets policies do not grant anything in other buckets');
select is(
  pg_temp.affected(format($$update storage.objects set metadata = '{"size":1}' where name = %L$$, pg_temp.path('A', 'PA1', 'X1'))),
  0::bigint,
  'objects cannot be updated/overwritten (no UPDATE policy)');
select is(
  pg_temp.affected(format($$update public.project_assets set upload_state = 'ready' where id = %L$$, pg_temp.id('X1'))),
  1::bigint,
  'A marks the uploaded asset ready');
select lives_ok(pg_temp.register_sql('X2', 'PA1', pg_temp.path('A', 'PA1', 'X2')), 'A registers a second asset');
select is(
  pg_temp.affected(format($$update public.project_assets set upload_state = 'ready' where id = %L$$, pg_temp.id('X2'))),
  1::bigint,
  'A marks the second asset ready without uploading');
select throws_ok(pg_temp.object_sql('project-assets', pg_temp.path('A', 'PA1', 'X2'), 'A'), '42501', null,
  'uploads are only accepted while the metadata row is pending');
select throws_ok(
  format($$update public.project_assets set upload_state = 'pending' where id = %L$$, pg_temp.id('X1')),
  '23514', null,
  'a ready asset can never return to pending (its bytes stay immutable)');
select lives_ok(pg_temp.register_sql('X3', 'PA1', pg_temp.path('A', 'PA1', 'X3')), 'A registers a third pending asset');

-- ===================================================================== user B
set local request.jwt.claims to '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';

select is_empty(
  format('select * from public.project_assets where project_id = %L', pg_temp.id('PA1')),
  'SEC-01: B cannot read A''s asset metadata');
select is(
  pg_temp.affected(format($$update public.project_assets set upload_state = 'pending' where id = %L$$, pg_temp.id('X1'))),
  0::bigint,
  'B cannot update A''s asset metadata');
select is(
  pg_temp.affected(format('delete from public.project_assets where id = %L', pg_temp.id('X1'))),
  0::bigint,
  'B cannot delete A''s asset metadata');
select is_empty(
  format($$select * from storage.objects where bucket_id = 'project-assets' and name like %L$$, pg_temp.id('A')::text || '/%'),
  'SEC-03: B cannot see A''s stored objects');
select throws_ok(pg_temp.object_sql('project-assets', pg_temp.path('A', 'PA1', 'X3'), 'B'), '42501', null,
  'SEC-03: B cannot upload into A''s pending asset path');
select is(
  pg_temp.affected(format('delete from storage.objects where name = %L', pg_temp.path('A', 'PA1', 'X1'))),
  0::bigint,
  'SEC-03: B cannot delete A''s object');
select throws_ok(pg_temp.register_sql('X5', 'PA1', pg_temp.path('A', 'PA1', 'X5')), '42501', null,
  'SEC-02: B cannot register metadata in A''s project using A''s prefix');
select throws_ok(pg_temp.register_sql('X5', 'PA1', pg_temp.path('B', 'PA1', 'X5')), '42501', null,
  'SEC-02: B cannot register metadata in A''s project using B''s prefix');

-- ===================================================================== anon
set local role anon;
set local request.jwt.claims to '{"role":"anon"}';

select throws_ok($$select * from public.project_assets$$, '42501', null, 'anon cannot read asset metadata');
select is_empty($$select * from storage.objects where bucket_id = 'project-assets'$$,
  'SEC-03: anon sees no project-assets objects');
select throws_ok(pg_temp.object_sql('project-assets', pg_temp.path('A', 'PA1', 'X3'), 'A'), '42501', null,
  'SEC-03: anon cannot upload objects');
select is(
  pg_temp.affected($$delete from storage.objects where bucket_id = 'project-assets'$$),
  0::bigint,
  'SEC-03: anon cannot delete objects');

-- ===================================================================== A: tombstoned project cleanup
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

select lives_ok(pg_temp.register_sql('X4', 'PA2', pg_temp.path('A', 'PA2', 'X4')), 'A registers an asset in PA2');
select lives_ok(pg_temp.object_sql('project-assets', pg_temp.path('A', 'PA2', 'X4'), 'A'), 'A uploads the PA2 asset');
select lives_ok(pg_temp.register_sql('X5', 'PA2', pg_temp.path('A', 'PA2', 'X5')), 'A registers a never-uploaded asset in PA2');
select is(
  pg_temp.affected(format($$update public.projects set deleted_at = now(), revision = revision + 1 where id = %L$$, pg_temp.id('PA2'))),
  1::bigint,
  'A tombstones PA2');
select throws_ok(pg_temp.register_sql('X6', 'PA2', pg_temp.path('A', 'PA2', 'X6')), '42501', null,
  'no new metadata can be registered in a tombstoned project');
select throws_ok(pg_temp.object_sql('project-assets', pg_temp.path('A', 'PA2', 'X5'), 'A'), '42501', null,
  'no uploads into a tombstoned project, even for pending metadata');
select is(
  (select count(*) from storage.objects where name = pg_temp.path('A', 'PA2', 'X4')),
  1::bigint,
  'the owner can still see objects of a tombstoned project (cleanup)');
select is(
  pg_temp.affected(format('delete from storage.objects where name = %L', pg_temp.path('A', 'PA2', 'X4'))),
  1::bigint,
  'the owner can delete objects of a tombstoned project');
select is(
  pg_temp.affected(format('delete from public.project_assets where project_id = %L', pg_temp.id('PA2'))),
  2::bigint,
  'the owner can delete metadata of a tombstoned project');

-- ===================================================================== verification (table owner)
reset role;

select throws_ok(
  format('update public.project_assets set sha256 = %L where id = %L', repeat('c', 64), pg_temp.id('X1')),
  '23514', null,
  'immutability trigger blocks metadata changes even for privileged roles');
select ok(
  exists(select 1 from storage.objects where name = pg_temp.path('A', 'PA1', 'X1')),
  'A''s object survived B/anon delete attempts');
select is(
  (select upload_state from public.project_assets where id = pg_temp.id('X1')),
  'ready',
  'A''s metadata survived B''s update attempt');

select * from finish();
rollback;
