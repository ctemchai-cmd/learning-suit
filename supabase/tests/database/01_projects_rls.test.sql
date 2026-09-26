-- SEC-01 / SEC-02 for public.projects: owner CRUD, B/anon isolation, forged owners, immutable columns.
--   A  = 11111111-1111-4111-8111-111111111111     B = 22222222-2222-4222-8222-222222222222
--   PA1 = a1111111-0000-4000-8000-000000000001    (A's project used through the file)
begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'pgtap-projects-a@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'pgtap-projects-b@example.test');

-- Number of rows touched by a DML statement, executed with the caller's role (SECURITY INVOKER).
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

create function pg_temp.doc(p_slide uuid) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'schemaVersion', 1,
    'slides', jsonb_build_array(jsonb_build_object('id', p_slide, 'name', 'Slide', 'background', '#FFFFFF', 'nodes', '[]'::jsonb)),
    'assets', '{}'::jsonb)
$$;

-- ===================================================================== user A
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

select lives_ok(
  $$insert into public.projects (id, owner_id, title, document)
    values ('a1111111-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'A lesson',
            pg_temp.doc('c0000000-0000-4000-8000-000000000001'))$$,
  'SEC-01: A can create an own project row');
select results_eq(
  $$select title from public.projects where id = 'a1111111-0000-4000-8000-000000000001'$$,
  $$values ('A lesson'::text)$$,
  'SEC-01: A can read the own project');
select is(
  pg_temp.affected($$update public.projects
                     set title = 'A renamed', revision = revision + 1,
                         last_mutation_id = 'e0000000-0000-4000-8000-000000000001'
                     where id = 'a1111111-0000-4000-8000-000000000001'$$),
  1::bigint,
  'SEC-01: A can update the own project (revision advances by one)');
select is(
  pg_temp.affected($$delete from public.projects where id = 'a1111111-0000-4000-8000-000000000001'$$),
  0::bigint,
  'A cannot hard-delete a live (not tombstoned) project');

select throws_ok(
  $$insert into public.projects (id, owner_id, title, document)
    values ('a1111111-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', 'forged',
            pg_temp.doc('c0000000-0000-4000-8000-000000000002'))$$,
  '42501', null,
  'SEC-02: INSERT with a forged owner_id is rejected');
select throws_ok(
  $$insert into public.projects (id, owner_id, title, document, revision)
    values ('a1111111-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'rev',
            pg_temp.doc('c0000000-0000-4000-8000-000000000003'), 5)$$,
  '42501', null,
  'INSERT must start at revision 0');
select throws_ok(
  $$insert into public.projects (id, owner_id, title, document, is_ready)
    values ('a1111111-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'ready',
            pg_temp.doc('c0000000-0000-4000-8000-000000000003'), true)$$,
  '42501', null,
  'INSERT cannot create a ready (published) project');
select throws_ok(
  $$insert into public.projects (id, owner_id, title, document, deleted_at)
    values ('a1111111-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'dead',
            pg_temp.doc('c0000000-0000-4000-8000-000000000003'), now())$$,
  '42501', null,
  'INSERT cannot create a tombstone');
select throws_ok(
  $$insert into public.projects (id, owner_id, title, document, last_mutation_id)
    values ('a1111111-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'mut',
            pg_temp.doc('c0000000-0000-4000-8000-000000000003'), 'e0000000-0000-4000-8000-000000000009')$$,
  '42501', null,
  'INSERT cannot preset last_mutation_id');
select throws_ok(
  $$update public.projects set owner_id = '22222222-2222-4222-8222-222222222222'
    where id = 'a1111111-0000-4000-8000-000000000001'$$,
  '42501', null,
  'SEC-02: owner_id cannot be updated (no column privilege)');
select throws_ok(
  $$update public.projects set created_at = now() - interval '1 day'
    where id = 'a1111111-0000-4000-8000-000000000001'$$,
  '42501', null,
  'created_at cannot be updated');
select throws_ok(
  $$update public.projects set updated_at = now() - interval '1 day'
    where id = 'a1111111-0000-4000-8000-000000000001'$$,
  '42501', null,
  'updated_at cannot be written by clients');
select throws_ok(
  $$update public.projects set id = 'a1111111-0000-4000-8000-000000000009'
    where id = 'a1111111-0000-4000-8000-000000000001'$$,
  '42501', null,
  'id cannot be updated');
select throws_ok(
  $$update public.projects set revision = revision + 5 where id = 'a1111111-0000-4000-8000-000000000001'$$,
  '23514', null,
  'revision can only advance by one');
select throws_ok(
  $$update public.projects set title = 'silent change' where id = 'a1111111-0000-4000-8000-000000000001'$$,
  '23514', null,
  'content changes without a revision bump are rejected (no silent overwrite)');

select lives_ok(
  $$insert into public.projects (id, owner_id, title, document, created_at, updated_at)
    values ('a1111111-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'timestamps',
            pg_temp.doc('c0000000-0000-4000-8000-000000000004'), '2000-01-01', '2000-01-01')$$,
  'A inserts a row with client-supplied timestamps');
select ok(
  (select created_at = now() and updated_at = now() from public.projects
   where id = 'a1111111-0000-4000-8000-000000000004'),
  'created_at/updated_at come from the server, not the client');

-- ===================================================================== user B
set local request.jwt.claims to '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';

select is_empty(
  $$select * from public.projects where id = 'a1111111-0000-4000-8000-000000000001'$$,
  'SEC-01: B cannot read A''s project');
select is(
  pg_temp.affected($$update public.projects set title = 'B was here', revision = revision + 1
                     where id = 'a1111111-0000-4000-8000-000000000001'$$),
  0::bigint,
  'SEC-01: B cannot update A''s project');
select is(
  pg_temp.affected($$delete from public.projects where id = 'a1111111-0000-4000-8000-000000000001'$$),
  0::bigint,
  'SEC-01: B cannot delete A''s project');
select throws_ok(
  $$insert into public.projects (id, owner_id, title, document)
    values ('b2222222-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'planted',
            pg_temp.doc('c0000000-0000-4000-8000-000000000005'))$$,
  '42501', null,
  'SEC-02: B cannot insert a row owned by A');

-- ===================================================================== anon
set local role anon;
set local request.jwt.claims to '{"role":"anon"}';

select throws_ok($$select * from public.projects$$, '42501', null, 'SEC-01: anon cannot read projects');
select throws_ok(
  $$insert into public.projects (id, owner_id, title, document)
    values ('f0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'anon',
            pg_temp.doc('c0000000-0000-4000-8000-000000000006'))$$,
  '42501', null,
  'SEC-01: anon cannot insert projects');
select throws_ok($$update public.projects set title = 'anon'$$, '42501', null, 'SEC-01: anon cannot update projects');
select throws_ok($$delete from public.projects$$, '42501', null, 'SEC-01: anon cannot delete projects');

-- ===================================================================== verification (table owner)
reset role;

select is(
  (select title from public.projects where id = 'a1111111-0000-4000-8000-000000000001'),
  'A renamed',
  'A''s row is unchanged by B/anon attempts');
select is(
  (select revision from public.projects where id = 'a1111111-0000-4000-8000-000000000001'),
  1,
  'A''s revision advanced exactly once');
select throws_ok(
  $$update public.projects set owner_id = '22222222-2222-4222-8222-222222222222'
    where id = 'a1111111-0000-4000-8000-000000000001'$$,
  '23514', null,
  'immutability trigger blocks owner_id changes even for privileged roles');

-- ===================================================================== A: tombstone, then hard delete
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

select is(
  pg_temp.affected($$update public.projects
                     set deleted_at = now(), revision = revision + 1,
                         last_mutation_id = 'e0000000-0000-4000-8000-000000000002'
                     where id = 'a1111111-0000-4000-8000-000000000001'$$),
  1::bigint,
  'A can tombstone the own project');
select throws_ok(
  $$update public.projects set deleted_at = null, revision = revision + 1
    where id = 'a1111111-0000-4000-8000-000000000001'$$,
  '23514', null,
  'a tombstone cannot be reverted');
select is(
  pg_temp.affected($$delete from public.projects where id = 'a1111111-0000-4000-8000-000000000001'$$),
  1::bigint,
  'SEC-01: A can hard-delete the own tombstoned project');

reset role;
select is(
  (select count(*) from public.projects where id = 'a1111111-0000-4000-8000-000000000001'),
  0::bigint,
  'the tombstoned row is gone after the owner''s delete');

select * from finish();
rollback;
