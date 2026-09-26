-- reserve_project / save_project / mark_project_deleted contracts (plan05 §5, §7):
-- SEC-04 (ownership + no existence leak), SEC-05 (asset references, deleted project, fake-ready asset),
-- PST-07 (same-mutation retry, stale retry after another save), PST-09 (same expected revision twice).
-- Truly parallel variants of PST-07/PST-09 run in scripts/db-test-local.mjs and tests/integration.
--   A   = 11111111-1111-4111-8111-111111111111   B  = 22222222-2222-4222-8222-222222222222
--   PA1 = a1111111-0000-4000-8000-000000000001   PA2 = a1111111-0000-4000-8000-000000000002
--   PB1 = b2222222-0000-4000-8000-000000000001   NX  = f0000000-0000-4000-8000-0000000000ff (never exists)
--   Sn  = c0000000-0000-4000-8000-00000000000n   Mn  = e0000000-0000-4000-8000-0000000000nn
--   Xn  = d0000000-0000-4000-8000-00000000000n   N1  = 90000000-0000-4000-8000-000000000001
begin;
create extension if not exists pgtap with schema extensions;
select plan(74);

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'pgtap-rpc-a@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'pgtap-rpc-b@example.test');

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
  select (case
    when p_name = 'A' then '11111111-1111-4111-8111-111111111111'
    when p_name = 'B' then '22222222-2222-4222-8222-222222222222'
    when p_name = 'PA1' then 'a1111111-0000-4000-8000-000000000001'
    when p_name = 'PA2' then 'a1111111-0000-4000-8000-000000000002'
    when p_name = 'PB1' then 'b2222222-0000-4000-8000-000000000001'
    when p_name = 'NX' then 'f0000000-0000-4000-8000-0000000000ff'
    when p_name = 'N1' then '90000000-0000-4000-8000-000000000001'
    when p_name like 'S_' then 'c0000000-0000-4000-8000-00000000000' || substr(p_name, 2)
    when p_name like 'X_' then 'd0000000-0000-4000-8000-00000000000' || substr(p_name, 2)
    when p_name like 'M_' then 'e0000000-0000-4000-8000-00000000000' || substr(p_name, 2)
    when p_name like 'M__' then 'e0000000-0000-4000-8000-0000000000' || substr(p_name, 2)
  end)::uuid
$$;

create function pg_temp.path(p_owner text, p_project text, p_asset text) returns text
language sql immutable as $$
  select pg_temp.id(p_owner)::text || '/' || pg_temp.id(p_project)::text || '/' || pg_temp.id(p_asset)::text || '.png'
$$;

create function pg_temp.doc(p_slide text, p_nodes jsonb default '[]'::jsonb, p_assets jsonb default '{}'::jsonb)
returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'schemaVersion', 1,
    'slides', jsonb_build_array(jsonb_build_object(
      'id', pg_temp.id(p_slide), 'name', 'Slide', 'background', '#FFFFFF', 'nodes', p_nodes)),
    'assets', p_assets)
$$;

create function pg_temp.image(p_asset text) returns jsonb
language sql stable as $$
  select jsonb_build_array(jsonb_build_object(
    'id', pg_temp.id('N1'), 'type', 'image', 'x', 0, 'y', 0, 'rotation', 0, 'opacity', 1, 'locked', false,
    'assetId', pg_temp.id(p_asset), 'width', 64, 'height', 64))
$$;

-- document.assets entry `{ "<asset id>": AssetReference }` matching the fixture metadata.
create function pg_temp.assets(p_asset text, p_path text, p_sha text default repeat('a', 64)) returns jsonb
language sql stable as $$
  select jsonb_build_object(pg_temp.id(p_asset)::text, jsonb_build_object(
    'id', pg_temp.id(p_asset), 'mimeType', 'image/png', 'width', 64, 'height', 64,
    'byteLength', 2048, 'sha256', p_sha, 'storagePath', p_path))
$$;

create function pg_temp.register_sql(p_asset text, p_project text) returns text
language sql immutable as $$
  select format(
    'insert into public.project_assets (id, project_id, storage_path, mime_type, width, height, byte_length, sha256) '
    'values (%L, %L, %L, ''image/png'', 64, 64, 2048, %L)',
    pg_temp.id(p_asset), pg_temp.id(p_project), pg_temp.path('A', p_project, p_asset), repeat('a', 64))
$$;

create function pg_temp.upload_sql(p_asset text, p_project text) returns text
language sql immutable as $$
  select format('insert into storage.objects (bucket_id, name, owner_id) values (''project-assets'', %L, %L)',
                pg_temp.path('A', p_project, p_asset), pg_temp.id('A')::text)
$$;

create function pg_temp.ready_sql(p_asset text) returns text
language sql immutable as $$
  select format($f$update public.project_assets set upload_state = 'ready' where id = %L$f$, pg_temp.id(p_asset))
$$;

create function pg_temp.saved(p_revision integer, p_mutation text) returns jsonb
language sql stable as $$
  select jsonb_build_object('status', 'saved', 'revision', p_revision, 'mutationId', pg_temp.id(p_mutation))
$$;

-- ===================================================================== A: reservation
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

select is(public.reserve_project(pg_temp.id('PA1'), 'Lesson', pg_temp.id('S1')),
  '{"status":"reserved","revision":0}'::jsonb,
  'reserve_project creates a reservation');
select ok(
  exists(select 1 from public.projects
         where id = pg_temp.id('PA1') and owner_id = pg_temp.id('A') and revision = 0 and not is_ready
           and deleted_at is null and last_mutation_id is null
           and jsonb_array_length(document -> 'slides') = 1
           and document -> 'slides' -> 0 ->> 'id' = pg_temp.id('S1')::text
           and document -> 'slides' -> 0 -> 'nodes' = '[]'::jsonb
           and document -> 'assets' = '{}'::jsonb),
  'reservation: owner = caller, revision 0, not ready, one empty slide, no assets');
select is(public.reserve_project(pg_temp.id('PA1'), 'Other title', pg_temp.id('S2')) ->> 'status', 'existing',
  'reserve_project on an own id returns existing');
select is(public.reserve_project(pg_temp.id('PA1'), 'Other title', pg_temp.id('S2')) #>> '{record,title}', 'Lesson',
  'an existing reservation is never overwritten');
select is_empty($$select id from public.projects where is_ready and deleted_at is null$$,
  'the dashboard query (ready and not deleted) does not list reservations');
select is(public.reserve_project(pg_temp.id('PA2'), '  untrimmed', pg_temp.id('S2')) ->> 'reason', 'invalid_title',
  'reserve_project rejects untrimmed titles as validation');

-- ===================================================================== B: SEC-04
set local request.jwt.claims to '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';

select is(public.reserve_project(pg_temp.id('PA1'), 'Mine now', pg_temp.id('S2')), '{"status":"unavailable"}'::jsonb,
  'SEC-04: B cannot reserve (or read through reserve) A''s project id');
select is(public.save_project(pg_temp.id('PA1'), 0, pg_temp.id('M90'), 'B', pg_temp.doc('S1')), '{"status":"unavailable"}'::jsonb,
  'SEC-04: B saving A''s project is unavailable');
select is(public.save_project(pg_temp.id('PA1'), 0, pg_temp.id('M90'), 'B', pg_temp.doc('S1')),
          public.save_project(pg_temp.id('NX'), 0, pg_temp.id('M90'), 'B', pg_temp.doc('S1')),
  'SEC-04: result for A''s project equals the result for a nonexistent id (no existence leak)');
select is(public.mark_project_deleted(pg_temp.id('PA1'), 0, pg_temp.id('M91')), '{"status":"unavailable"}'::jsonb,
  'SEC-04: B cannot tombstone A''s project');
select is(public.mark_project_deleted(pg_temp.id('PA1'), 0, pg_temp.id('M91')),
          public.mark_project_deleted(pg_temp.id('NX'), 0, pg_temp.id('M91')),
  'SEC-04: delete result for A''s project equals a nonexistent id');
select is_empty(format('select 1 from public.projects where id = %L', pg_temp.id('PA1')),
  'B still cannot see A''s row');

-- ===================================================================== anon
set local role anon;
set local request.jwt.claims to '{"role":"anon"}';

select throws_ok(format($$select public.save_project(%L, 0, %L, 'anon', '{}'::jsonb)$$, pg_temp.id('PA1'), pg_temp.id('M92')),
  '42501', null, 'SEC-04: anon cannot execute save_project');
select throws_ok(format($$select public.reserve_project(%L, 'anon', %L)$$, pg_temp.id('NX'), pg_temp.id('S1')),
  '42501', null, 'SEC-04: anon cannot execute reserve_project');
select throws_ok(format($$select public.mark_project_deleted(%L, 0, %L)$$, pg_temp.id('PA1'), pg_temp.id('M92')),
  '42501', null, 'SEC-04: anon cannot execute mark_project_deleted');

reset role;
select ok(
  exists(select 1 from public.projects
         where id = pg_temp.id('PA1') and revision = 0 and title = 'Lesson' and deleted_at is null),
  'A''s reservation is untouched by B and anon');

-- ===================================================================== A: saves, PST-07 and PST-09
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

select is(public.save_project(pg_temp.id('PA1'), 0, pg_temp.id('M1'), 'Lesson', pg_temp.doc('S1')) - 'updatedAt',
  pg_temp.saved(1, 'M1'), 'the first save publishes revision 1');
select ok(
  exists(select 1 from public.projects
         where id = pg_temp.id('PA1') and revision = 1 and is_ready and last_mutation_id = pg_temp.id('M1')),
  'the project is ready at revision 1');
select ok(
  (public.save_project(pg_temp.id('PA1'), 0, pg_temp.id('M1'), 'Lesson', pg_temp.doc('S1')) ->> 'updatedAt') is not null,
  'saved results carry the server updatedAt');
select is(public.save_project(pg_temp.id('PA1'), 0, pg_temp.id('M1'), 'Lesson', pg_temp.doc('S1')) - 'updatedAt',
  pg_temp.saved(1, 'M1'), 'PST-07: retrying the same mutation replays saved');
select is((select revision from public.projects where id = pg_temp.id('PA1')), 1,
  'PST-07: the retry did not increment the revision');
select is(public.save_project(pg_temp.id('PA1'), 1, pg_temp.id('M2'), 'Lesson v2', pg_temp.doc('S1')) - 'updatedAt',
  pg_temp.saved(2, 'M2'), 'another writer saves revision 2');
select is(public.save_project(pg_temp.id('PA1'), 0, pg_temp.id('M1'), 'Lesson', pg_temp.doc('S1')),
  '{"status":"conflict","currentRevision":2}'::jsonb,
  'PST-07: the old retry conflicts once another save happened');
select is(public.save_project(pg_temp.id('PA1'), 2, pg_temp.id('M3'), 'Device 1', pg_temp.doc('S1')) ->> 'status', 'saved',
  'PST-09: the first of two saves on revision 2 wins');
select is(public.save_project(pg_temp.id('PA1'), 2, pg_temp.id('M4'), 'Device 2', pg_temp.doc('S2')),
  '{"status":"conflict","currentRevision":3}'::jsonb,
  'PST-09: the second save on revision 2 conflicts');
select ok(
  exists(select 1 from public.projects
         where id = pg_temp.id('PA1') and revision = 3 and title = 'Device 1'
           and last_mutation_id = pg_temp.id('M3') and document -> 'slides' -> 0 ->> 'id' = pg_temp.id('S1')::text),
  'PST-09: the losing save did not overwrite anything');

-- ===================================================================== validation (never SQL errors)
select is(public.save_project(pg_temp.id('PA1'), 3, pg_temp.id('M5'), ' padded', pg_temp.doc('S1')) ->> 'reason',
  'invalid_title', 'untrimmed title is a validation result');
select is(public.save_project(pg_temp.id('PA1'), 3, pg_temp.id('M5'), repeat('ก', 121), pg_temp.doc('S1')) ->> 'reason',
  'invalid_title', 'titles over 120 code points are rejected');
select is(public.save_project(pg_temp.id('PA1'), 3, pg_temp.id('M5'), 'T', '[]'::jsonb),
  '{"status":"error","code":"validation","retryable":false,"reason":"document_not_object"}'::jsonb,
  'a non-object document is a validation error with the documented shape');
select is(public.save_project(pg_temp.id('PA1'), 3, pg_temp.id('M5'), 'T', pg_temp.doc('S1') || '{"schemaVersion":2}') ->> 'reason',
  'unsupported_schema_version', 'unknown schemaVersion is rejected');
select is(public.save_project(pg_temp.id('PA1'), 3, pg_temp.id('M5'), 'T', pg_temp.doc('S1') || '{"schemaVersion":"1"}') ->> 'reason',
  'unsupported_schema_version', 'a string schemaVersion is rejected');
select is(public.save_project(pg_temp.id('PA1'), 3, pg_temp.id('M5'), 'T', pg_temp.doc('S1') || '{"extra":true}') ->> 'reason',
  'unknown_document_key', 'unknown top-level document keys are rejected');
select is(public.save_project(pg_temp.id('PA1'), 3, pg_temp.id('M5'), 'T', pg_temp.doc('S1') || '{"slides":[]}') ->> 'reason',
  'slide_count', 'zero slides are rejected');
select is(
  public.save_project(pg_temp.id('PA1'), 3, pg_temp.id('M5'), 'T',
    jsonb_build_object('schemaVersion', 1, 'assets', '{}'::jsonb, 'slides',
      (select jsonb_agg(jsonb_build_object('id', gen_random_uuid(), 'name', 'S', 'background', '#FFFFFF', 'nodes', '[]'::jsonb))
       from generate_series(1, 101)))) ->> 'reason',
  'slide_count', '101 slides are rejected');
select is(public.save_project(pg_temp.id('PA1'), 3, pg_temp.id('M5'), 'T', pg_temp.doc('S1') || '{"slides":{"a":1}}') ->> 'reason',
  'slides_not_array', 'slides must be an array');
select is(public.save_project(pg_temp.id('PA1'), 3, pg_temp.id('M5'), 'T', pg_temp.doc('S1') || '{"slides":[42]}') ->> 'reason',
  'invalid_slide', 'a non-object slide is rejected before iteration');
select is(public.save_project(pg_temp.id('PA1'), 3, pg_temp.id('M5'), 'T',
    pg_temp.doc('S1') || jsonb_build_object('slides', jsonb_build_array(jsonb_build_object('id', 'x', 'nodes', '{"a":1}'::jsonb)))) ->> 'reason',
  'invalid_slide', 'slide.nodes must be an array');
select is(public.save_project(pg_temp.id('PA1'), 3, pg_temp.id('M5'), 'T', pg_temp.doc('S1', '["oops"]'::jsonb)) ->> 'reason',
  'invalid_node', 'a non-object node is rejected');
select is(public.save_project(pg_temp.id('PA1'), 3, pg_temp.id('M5'), 'T', pg_temp.doc('S1') || '{"assets":[]}') ->> 'reason',
  'assets_not_object', 'assets must be an object');
select is(public.save_project(pg_temp.id('PA1'), 3, pg_temp.id('M5'), 'T', pg_temp.doc('S1', '[]'::jsonb, '{"not-a-uuid":{}}'::jsonb)) ->> 'reason',
  'invalid_asset_entry', 'asset keys must be UUIDs with full metadata');
select is(public.save_project(pg_temp.id('PA1'), 3, pg_temp.id('M5'), 'T', pg_temp.doc('S1', pg_temp.image('X1'))) ->> 'reason',
  'image_asset_missing', 'an image node must reference an entry of document.assets');
select is(public.save_project(pg_temp.id('PA1'), 3, pg_temp.id('M5'), 'T',
    pg_temp.doc('S1', '[{"id":"n","type":"image","assetId":42}]'::jsonb)) ->> 'reason',
  'image_asset_missing', 'a non-string assetId is rejected without casting');
select is(public.save_project(pg_temp.id('PA1'), 3, pg_temp.id('M5'), 'T',
    pg_temp.doc('S1', jsonb_build_array(jsonb_build_object('id', 'big', 'type', 'text', 'text', repeat('x', 16777216))))) - 'reason',
  '{"status":"error","code":"quota","retryable":false}'::jsonb,
  'a document over 16 MiB is a quota error');
select is(public.save_project(pg_temp.id('PA1'), 3, null, 'T', pg_temp.doc('S1')) ->> 'reason',
  'invalid_request', 'a missing mutation id is rejected');
select ok(
  exists(select 1 from public.projects where id = pg_temp.id('PA1') and revision = 3 and title = 'Device 1'),
  'validation failures left the row untouched');

-- ===================================================================== assets: positive control + SEC-05
select lives_ok(pg_temp.register_sql('X1', 'PA1'), 'A registers asset X1 in PA1');
select lives_ok(pg_temp.upload_sql('X1', 'PA1'), 'A uploads X1 bytes (object row)');
select is(pg_temp.affected(pg_temp.ready_sql('X1')), 1::bigint, 'A marks X1 ready');
select is(
  public.save_project(pg_temp.id('PA1'), 3, pg_temp.id('M6'), 'With image',
    pg_temp.doc('S1', pg_temp.image('X1'), pg_temp.assets('X1', pg_temp.path('A', 'PA1', 'X1')))) - 'updatedAt',
  pg_temp.saved(4, 'M6'),
  'a document referencing a ready, uploaded asset of the same project saves');
select is(
  public.save_project(pg_temp.id('PA1'), 4, pg_temp.id('M7'), 'T',
    pg_temp.doc('S1', pg_temp.image('X1'), pg_temp.assets('X1', pg_temp.path('A', 'PA1', 'X1'), repeat('b', 64)))) ->> 'reason',
  'asset_not_ready', 'metadata that differs from project_assets (sha256) is rejected');
select is(public.reserve_project(pg_temp.id('PA2'), 'Second', pg_temp.id('S2')) ->> 'status', 'reserved',
  'A reserves a second project');
select is(
  public.save_project(pg_temp.id('PA2'), 0, pg_temp.id('M8'), 'Second',
    pg_temp.doc('S2', pg_temp.image('X1'), pg_temp.assets('X1', pg_temp.path('A', 'PA1', 'X1')))) ->> 'reason',
  'asset_not_ready', 'SEC-05: a document cannot reference another project''s asset/path');
select is(
  public.save_project(pg_temp.id('PA2'), 0, pg_temp.id('M8'), 'Second',
    pg_temp.doc('S2', pg_temp.image('X1'), pg_temp.assets('X1', pg_temp.path('A', 'PA2', 'X1')))) ->> 'reason',
  'asset_not_ready', 'SEC-05: re-pathing a foreign asset id into this project is rejected');
select lives_ok(pg_temp.register_sql('X2', 'PA2'), 'A registers asset X2 in PA2');
select is(pg_temp.affected(pg_temp.ready_sql('X2')), 1::bigint, 'A marks X2 ready without uploading bytes');
select is(
  public.save_project(pg_temp.id('PA2'), 0, pg_temp.id('M8'), 'Second',
    pg_temp.doc('S2', pg_temp.image('X2'), pg_temp.assets('X2', pg_temp.path('A', 'PA2', 'X2')))) ->> 'reason',
  'asset_not_ready', 'SEC-05: a fake-ready asset without a stored object is rejected');
select lives_ok(pg_temp.register_sql('X3', 'PA2'), 'A registers asset X3 in PA2');
select lives_ok(pg_temp.upload_sql('X3', 'PA2'), 'A uploads X3 but never marks it ready');
select is(
  public.save_project(pg_temp.id('PA2'), 0, pg_temp.id('M8'), 'Second',
    pg_temp.doc('S2', pg_temp.image('X3'), pg_temp.assets('X3', pg_temp.path('A', 'PA2', 'X3')))) ->> 'reason',
  'asset_not_ready', 'a pending (not yet ready) asset is rejected');
select is((select revision from public.projects where id = pg_temp.id('PA2')), 0,
  'rejected saves left PA2 unpublished at revision 0');

set local request.jwt.claims to '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select is(public.reserve_project(pg_temp.id('PB1'), 'B lesson', pg_temp.id('S1')) ->> 'status', 'reserved',
  'B reserves an own project');
select is(
  public.save_project(pg_temp.id('PB1'), 0, pg_temp.id('M9'), 'B lesson',
    pg_temp.doc('S1', pg_temp.image('X1'), pg_temp.assets('X1', pg_temp.path('A', 'PA1', 'X1')))) ->> 'reason',
  'asset_not_ready', 'SEC-05: B cannot publish a reference to A''s asset');

-- ===================================================================== A: tombstone (mark_project_deleted)
set local request.jwt.claims to '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

select is(public.mark_project_deleted(pg_temp.id('PA1'), 3, pg_temp.id('M10')),
  '{"status":"conflict","currentRevision":4}'::jsonb,
  'a tombstone on a stale revision conflicts');
select is(public.mark_project_deleted(pg_temp.id('PA1'), 4, pg_temp.id('M10')) - 'updatedAt',
  pg_temp.saved(5, 'M10'), 'the tombstone is accepted and advances the revision');
select is(public.mark_project_deleted(pg_temp.id('PA1'), 4, pg_temp.id('M10')) - 'updatedAt',
  pg_temp.saved(5, 'M10'), 'retrying the same delete mutation replays saved');
select is((select revision from public.projects where id = pg_temp.id('PA1')), 5,
  'the delete retry did not increment the revision again');
select is(public.mark_project_deleted(pg_temp.id('PA1'), 5, pg_temp.id('M11')), '{"status":"unavailable"}'::jsonb,
  'a different delete mutation on a tombstone is unavailable');
select is(public.save_project(pg_temp.id('PA1'), 5, pg_temp.id('M12'), 'Revive', pg_temp.doc('S1')), '{"status":"unavailable"}'::jsonb,
  'SEC-05: saving a deleted project is unavailable');
select is(public.save_project(pg_temp.id('PA1'), 5, pg_temp.id('M10'), 'Revive', pg_temp.doc('S1')), '{"status":"unavailable"}'::jsonb,
  'even the tombstone''s own mutation id cannot save into a deleted project');
select is(public.reserve_project(pg_temp.id('PA1'), 'Again', pg_temp.id('S1')), '{"status":"unavailable"}'::jsonb,
  'reserve_project does not resurrect an own tombstone');
select ok(
  exists(select 1 from public.projects where id = pg_temp.id('PA1') and deleted_at is not null),
  'the owner can still read the tombstone (inspectLifecycle)');
select is(
  pg_temp.affected(format('delete from storage.objects where bucket_id = %L and name = %L', 'project-assets', pg_temp.path('A', 'PA1', 'X1'))),
  1::bigint,
  'the owner removes objects of the tombstoned project');
select is(pg_temp.affected(format('delete from public.projects where id = %L', pg_temp.id('PA1'))), 1::bigint,
  'the owner hard-deletes the tombstoned project');
select is_empty(format('select 1 from public.project_assets where project_id = %L', pg_temp.id('PA1')),
  'asset metadata of the purged project cascaded away');

select * from finish();
rollback;
