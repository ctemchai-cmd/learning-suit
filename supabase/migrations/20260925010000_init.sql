-- Learning Suit — cloud schema, grants, RLS, private bucket and save/reserve/delete RPCs.
-- Spec: docs/plan/05-persistence-security-and-export.md §3–§5, §7;
--       docs/adr/0003-local-drafts-and-cloud-saving.md, docs/adr/0004-authentication-and-data-access.md.
--
-- RPC result contract (jsonb, camelCase so it maps 1:1 onto src/services/persistence/repository.ts):
--
--   save_project / mark_project_deleted  -> SaveResult
--     {"status":"saved","revision":<int>,"mutationId":"<uuid>","updatedAt":"<timestamptz ISO>"}
--     {"status":"conflict","currentRevision":<int>}
--     {"status":"unavailable"}                      -- missing / deleted / not owned: indistinguishable
--     {"status":"error","code":"validation"|"quota"|"auth","retryable":false,"reason":"<machine reason>"}
--
--   reserve_project -> ReservationResult
--     {"status":"reserved","revision":0}
--     {"status":"existing","record":{"id","ownerId","title","document","revision","lastMutationId",
--                                    "isReady","createdAt","updatedAt","deletedAt"}}
--     {"status":"unavailable"}                      -- other owner's id, or own tombstone
--     {"status":"error","code":"validation"|"auth","retryable":false,"reason":"<machine reason>"}
--
-- Transport-level failures (permission denied for anon, JWT expired, network, serialization
-- failures) surface as PostgREST errors and are classified by the adapter, not encoded here.

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

create table public.projects (
  id uuid primary key,
  owner_id uuid not null references auth.users (id) on delete restrict,
  title text not null
    constraint projects_title_length check (char_length(btrim(title)) between 1 and 120 and char_length(title) <= 120),
  document jsonb not null,
  revision integer not null default 0 constraint projects_revision_nonnegative check (revision >= 0),
  last_mutation_id uuid,
  is_ready boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint projects_document_object check (jsonb_typeof(document) = 'object'),
  constraint projects_document_schema_version check ((document ->> 'schemaVersion') is not distinct from '1'),
  constraint projects_document_slides_array check (jsonb_typeof(document -> 'slides') is not distinct from 'array'),
  constraint projects_document_assets_object check (jsonb_typeof(document -> 'assets') is not distinct from 'object'),
  constraint projects_document_size check (octet_length(document::text) <= 16777216)
);

create index projects_owner_updated_idx on public.projects (owner_id, updated_at desc);

comment on table public.projects is
  'One row per lesson. is_ready=false is an upload reservation (never listed); deleted_at is a cleanup tombstone.';

create table public.project_assets (
  id uuid primary key,
  project_id uuid not null references public.projects (id) on delete cascade,
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('image/png', 'image/jpeg', 'image/webp')),
  width integer not null check (width between 1 and 8192),
  height integer not null check (height between 1 and 8192),
  byte_length integer not null check (byte_length between 1 and 10485760),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  upload_state text not null default 'pending' check (upload_state in ('pending', 'ready')),
  created_at timestamptz not null default now(),
  check (width::bigint * height::bigint <= 16777216),
  -- Structural canonical form `<owner-uuid>/<project_id>/<id>.<ext(mime_type)>`; the INSERT policy
  -- additionally pins the owner segment to auth.uid() of the parent owner.
  constraint project_assets_storage_path_canonical check (
    split_part(storage_path, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and storage_path = split_part(storage_path, '/', 1) || '/' || project_id::text || '/' || id::text || '.'
      || case mime_type when 'image/png' then 'png' when 'image/jpeg' then 'jpg' when 'image/webp' then 'webp' end
  )
);

create index project_assets_project_idx on public.project_assets (project_id);

comment on table public.project_assets is
  'Immutable attachment metadata. Only upload_state (pending -> ready) may change after insert.';

-- ---------------------------------------------------------------------------
-- 2. Server-side timestamps, immutable fields and CAS invariants
-- ---------------------------------------------------------------------------

create function public.projects_before_write() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  if new.id is distinct from old.id
     or new.owner_id is distinct from old.owner_id
     or new.created_at is distinct from old.created_at then
    raise exception using errcode = '23514', message = 'projects: id, owner_id and created_at are immutable';
  end if;
  if old.deleted_at is not null then
    raise exception using errcode = '23514', message = 'projects: a tombstoned project cannot be modified';
  end if;
  if new.revision <> old.revision and new.revision <> old.revision + 1 then
    raise exception using errcode = '23514', message = 'projects: revision may only advance by one';
  end if;
  if old.is_ready and not new.is_ready then
    raise exception using errcode = '23514', message = 'projects: is_ready cannot be cleared';
  end if;
  if new.revision = old.revision and (
       new.title is distinct from old.title
       or new.last_mutation_id is distinct from old.last_mutation_id
       or new.is_ready is distinct from old.is_ready
       or new.deleted_at is distinct from old.deleted_at
       or new.document is distinct from old.document) then
    raise exception using errcode = '23514', message = 'projects: content and lifecycle changes must advance revision';
  end if;

  new.updated_at := now();
  return new;
end
$$;

create trigger projects_before_write
  before insert or update on public.projects
  for each row execute function public.projects_before_write();

create function public.project_assets_before_write() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    return new;
  end if;

  if (new.id, new.project_id, new.storage_path, new.mime_type, new.width, new.height,
      new.byte_length, new.sha256, new.created_at)
     is distinct from
     (old.id, old.project_id, old.storage_path, old.mime_type, old.width, old.height,
      old.byte_length, old.sha256, old.created_at) then
    raise exception using errcode = '23514', message = 'project_assets: metadata is immutable; only upload_state may change';
  end if;
  -- Ready bytes are immutable: never allow ready -> pending (which would re-open the upload policy).
  if old.upload_state = 'ready' and new.upload_state is distinct from 'ready' then
    raise exception using errcode = '23514', message = 'project_assets: a ready asset cannot return to pending';
  end if;
  return new;
end
$$;

create trigger project_assets_before_write
  before insert or update on public.project_assets
  for each row execute function public.project_assets_before_write();

-- ---------------------------------------------------------------------------
-- 3. Grants (Supabase default privileges grant everything in public to the API roles)
-- ---------------------------------------------------------------------------

revoke all on table public.projects from public, anon, authenticated;
revoke all on table public.project_assets from public, anon, authenticated;

grant select, insert, delete on table public.projects to authenticated;
grant update (title, document, revision, last_mutation_id, is_ready, deleted_at) on table public.projects to authenticated;

grant select, insert, delete on table public.project_assets to authenticated;
grant update (upload_state) on table public.project_assets to authenticated;

revoke execute on function public.projects_before_write() from public, anon, authenticated;
revoke execute on function public.project_assets_before_write() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Row Level Security
-- ---------------------------------------------------------------------------

alter table public.projects enable row level security;
alter table public.project_assets enable row level security;

create policy projects_select_own on public.projects
  for select to authenticated
  using (owner_id = (select auth.uid()));

create policy projects_insert_own_reservation on public.projects
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and revision = 0
    and is_ready = false
    and deleted_at is null
    and last_mutation_id is null
  );

create policy projects_update_own on public.projects
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy projects_delete_own_tombstone on public.projects
  for delete to authenticated
  using (owner_id = (select auth.uid()) and deleted_at is not null);

create policy project_assets_select_own on public.project_assets
  for select to authenticated
  using (exists (
    select 1 from public.projects p
    where p.id = project_id and p.owner_id = (select auth.uid())
  ));

create policy project_assets_insert_own on public.project_assets
  for insert to authenticated
  with check (
    upload_state = 'pending'
    and exists (
      select 1 from public.projects p
      where p.id = project_id and p.owner_id = (select auth.uid()) and p.deleted_at is null
    )
    and storage_path = (select auth.uid())::text || '/' || project_id::text || '/' || id::text || '.'
      || case mime_type when 'image/png' then 'png' when 'image/jpeg' then 'jpg' when 'image/webp' then 'webp' end
  );

create policy project_assets_update_own on public.project_assets
  for update to authenticated
  using (exists (
    select 1 from public.projects p
    where p.id = project_id and p.owner_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.projects p
    where p.id = project_id and p.owner_id = (select auth.uid())
  ));

create policy project_assets_delete_own on public.project_assets
  for delete to authenticated
  using (exists (
    select 1 from public.projects p
    where p.id = project_id and p.owner_id = (select auth.uid())
  ));

-- ---------------------------------------------------------------------------
-- 5. Private bucket + storage.objects policies
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('project-assets', 'project-assets', false, 10485760, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- SELECT / DELETE: owner of the parent project via the metadata row whose storage_path = name.
-- Allowed while tombstoned so cleanup can finish. No UPDATE policy: objects are immutable
-- (no upsert / overwrite / move).
create policy project_assets_objects_select_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'project-assets'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1
      from public.project_assets a
      join public.projects p on p.id = a.project_id
      where a.storage_path = objects.name
        and p.owner_id = (select auth.uid())
    )
  );

create policy project_assets_objects_insert_pending on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'project-assets'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1
      from public.project_assets a
      join public.projects p on p.id = a.project_id
      where a.storage_path = objects.name
        and a.upload_state = 'pending'
        and p.owner_id = (select auth.uid())
        and p.deleted_at is null
    )
  );

create policy project_assets_objects_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'project-assets'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1
      from public.project_assets a
      join public.projects p on p.id = a.project_id
      where a.storage_path = objects.name
        and p.owner_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- 6. RPCs (SECURITY INVOKER: every statement below runs under the caller's grants + RLS)
-- ---------------------------------------------------------------------------

-- reserve_project: create an owner reservation (revision 0, is_ready=false, one empty valid slide,
-- no assets). Never overwrites an existing row: an own live row is returned as `existing`, anything
-- else (other owner, own tombstone) is `unavailable`.
create function public.reserve_project(p_id uuid, p_title text, p_initial_slide_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.projects%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('status', 'error', 'code', 'auth', 'retryable', false, 'reason', 'not_authenticated');
  end if;
  if p_id is null or p_initial_slide_id is null then
    return jsonb_build_object('status', 'error', 'code', 'validation', 'retryable', false, 'reason', 'invalid_id');
  end if;
  if p_title is null or char_length(p_title) not between 1 and 120 or p_title ~ '^\s' or p_title ~ '\s$' then
    return jsonb_build_object('status', 'error', 'code', 'validation', 'retryable', false, 'reason', 'invalid_title');
  end if;

  select * into v_row
  from public.projects p
  where p.id = p_id and p.owner_id = v_uid
  for update;

  if not found then
    begin
      insert into public.projects (id, owner_id, title, document)
      values (
        p_id,
        v_uid,
        p_title,
        jsonb_build_object(
          'schemaVersion', 1,
          'slides', jsonb_build_array(jsonb_build_object(
            'id', p_initial_slide_id::text,
            'name', 'สไลด์ 1',
            'background', '#FFFFFF',
            'nodes', '[]'::jsonb
          )),
          'assets', '{}'::jsonb
        )
      );
      return jsonb_build_object('status', 'reserved', 'revision', 0);
    exception when unique_violation then
      -- Either another owner's row (invisible through RLS) or our own concurrent reservation
      -- that committed while we were inserting. Re-read under the new snapshot.
      select * into v_row
      from public.projects p
      where p.id = p_id and p.owner_id = v_uid
      for update;
      if not found then
        return jsonb_build_object('status', 'unavailable');
      end if;
    end;
  end if;

  if v_row.deleted_at is not null then
    return jsonb_build_object('status', 'unavailable');
  end if;

  return jsonb_build_object(
    'status', 'existing',
    'record', jsonb_build_object(
      'id', v_row.id,
      'ownerId', v_row.owner_id,
      'title', v_row.title,
      'document', v_row.document,
      'revision', v_row.revision,
      'lastMutationId', v_row.last_mutation_id,
      'isReady', v_row.is_ready,
      'createdAt', v_row.created_at,
      'updatedAt', v_row.updated_at,
      'deletedAt', v_row.deleted_at
    )
  );
end
$$;

-- save_project: atomic compare-and-set of the whole document (plan05 §5 "RPC contract").
-- Order: lock row -> unavailable -> mutation-id replay -> revision conflict -> validate -> update.
create function public.save_project(
  p_project_id uuid,
  p_expected_revision integer,
  p_mutation_id uuid,
  p_title text,
  p_document jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.projects%rowtype;
  v_slide_count integer;
  v_asset_ids uuid[];
  v_revision integer;
  v_updated_at timestamptz;
begin
  if v_uid is null then
    return jsonb_build_object('status', 'error', 'code', 'auth', 'retryable', false, 'reason', 'not_authenticated');
  end if;
  if p_project_id is null then
    return jsonb_build_object('status', 'unavailable');
  end if;
  if p_mutation_id is null or p_expected_revision is null or p_expected_revision < 0 then
    return jsonb_build_object('status', 'error', 'code', 'validation', 'retryable', false, 'reason', 'invalid_request');
  end if;

  -- 1. Lock the caller-visible row first (projects before assets, always).
  select * into v_row
  from public.projects p
  where p.id = p_project_id and p.owner_id = v_uid
  for update;

  -- 2. Missing, other owner's and tombstoned rows look identical.
  if not found or v_row.deleted_at is not null then
    return jsonb_build_object('status', 'unavailable');
  end if;

  -- 3. Idempotent replay of the most recent accepted mutation (no second increment).
  if v_row.last_mutation_id = p_mutation_id then
    return jsonb_build_object(
      'status', 'saved', 'revision', v_row.revision,
      'mutationId', v_row.last_mutation_id, 'updatedAt', v_row.updated_at);
  end if;

  -- 4. Compare-and-set on revision.
  if v_row.revision <> p_expected_revision then
    return jsonb_build_object('status', 'conflict', 'currentRevision', v_row.revision);
  end if;

  -- 5. Validation. JSON types are checked before any cast/iteration so malformed payloads
  --    become validation results instead of SQL errors.
  if p_title is null or char_length(p_title) not between 1 and 120 or p_title ~ '^\s' or p_title ~ '\s$' then
    return jsonb_build_object('status', 'error', 'code', 'validation', 'retryable', false, 'reason', 'invalid_title');
  end if;
  if p_document is null or jsonb_typeof(p_document) <> 'object' then
    return jsonb_build_object('status', 'error', 'code', 'validation', 'retryable', false, 'reason', 'document_not_object');
  end if;
  if octet_length(p_document::text) > 16777216 then
    return jsonb_build_object('status', 'error', 'code', 'quota', 'retryable', false, 'reason', 'document_too_large');
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_document) k
    where k not in ('schemaVersion', 'slides', 'assets')
  ) then
    return jsonb_build_object('status', 'error', 'code', 'validation', 'retryable', false, 'reason', 'unknown_document_key');
  end if;
  if jsonb_typeof(p_document -> 'schemaVersion') is distinct from 'number'
     or (p_document ->> 'schemaVersion') is distinct from '1' then
    return jsonb_build_object('status', 'error', 'code', 'validation', 'retryable', false, 'reason', 'unsupported_schema_version');
  end if;
  if jsonb_typeof(p_document -> 'slides') is distinct from 'array' then
    return jsonb_build_object('status', 'error', 'code', 'validation', 'retryable', false, 'reason', 'slides_not_array');
  end if;
  if jsonb_typeof(p_document -> 'assets') is distinct from 'object' then
    return jsonb_build_object('status', 'error', 'code', 'validation', 'retryable', false, 'reason', 'assets_not_object');
  end if;
  v_slide_count := jsonb_array_length(p_document -> 'slides');
  if v_slide_count < 1 or v_slide_count > 100 then
    return jsonb_build_object('status', 'error', 'code', 'validation', 'retryable', false, 'reason', 'slide_count');
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_document -> 'slides') s(v)
    where jsonb_typeof(s.v) is distinct from 'object'
       or jsonb_typeof(s.v -> 'id') is distinct from 'string'
       or jsonb_typeof(s.v -> 'nodes') is distinct from 'array'
  ) then
    return jsonb_build_object('status', 'error', 'code', 'validation', 'retryable', false, 'reason', 'invalid_slide');
  end if;
  -- Safe to iterate nodes now: every slide is an object with a `nodes` array.
  if exists (
    select 1
    from jsonb_array_elements(p_document -> 'slides') s(v)
    cross join lateral jsonb_array_elements(s.v -> 'nodes') n(v)
    where jsonb_typeof(n.v) is distinct from 'object'
       or jsonb_typeof(n.v -> 'type') is distinct from 'string'
  ) then
    return jsonb_build_object('status', 'error', 'code', 'validation', 'retryable', false, 'reason', 'invalid_node');
  end if;
  if exists (
    select 1 from jsonb_each(p_document -> 'assets') a(k, v)
    where a.k !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or jsonb_typeof(a.v) is distinct from 'object'
       or jsonb_typeof(a.v -> 'id') is distinct from 'string'
       or (a.v ->> 'id') is distinct from a.k
       or jsonb_typeof(a.v -> 'mimeType') is distinct from 'string'
       or jsonb_typeof(a.v -> 'width') is distinct from 'number'
       or jsonb_typeof(a.v -> 'height') is distinct from 'number'
       or jsonb_typeof(a.v -> 'byteLength') is distinct from 'number'
       or jsonb_typeof(a.v -> 'sha256') is distinct from 'string'
       or jsonb_typeof(a.v -> 'storagePath') is distinct from 'string'
  ) then
    return jsonb_build_object('status', 'error', 'code', 'validation', 'retryable', false, 'reason', 'invalid_asset_entry');
  end if;
  -- Safe: every asset entry is an object now.
  if exists (
    select 1
    from jsonb_each(p_document -> 'assets') a(k, v)
    cross join lateral jsonb_object_keys(a.v) key
    where key not in ('id', 'mimeType', 'width', 'height', 'byteLength', 'sha256', 'storagePath')
  ) then
    return jsonb_build_object('status', 'error', 'code', 'validation', 'retryable', false, 'reason', 'invalid_asset_entry');
  end if;
  -- Every image node must reference an entry of document.assets.
  if exists (
    select 1
    from jsonb_array_elements(p_document -> 'slides') s(v)
    cross join lateral jsonb_array_elements(s.v -> 'nodes') n(v)
    where n.v ->> 'type' = 'image'
      and (jsonb_typeof(n.v -> 'assetId') is distinct from 'string'
           or not ((p_document -> 'assets') ? (n.v ->> 'assetId')))
  ) then
    return jsonb_build_object('status', 'error', 'code', 'validation', 'retryable', false, 'reason', 'image_asset_missing');
  end if;

  -- Every published asset must be a ready metadata row of THIS project with identical metadata and
  -- an uploaded object in the private bucket. Rows are share-locked after the project row.
  v_asset_ids := array(
    select a.k::uuid from jsonb_each(p_document -> 'assets') a(k, v) order by 1
  );
  if cardinality(v_asset_ids) > 0 then
    perform 1
    from public.project_assets pa
    where pa.id = any (v_asset_ids)
    order by pa.id
    for share;

    if exists (
      select 1
      from jsonb_each(p_document -> 'assets') a(k, v)
      where not exists (
        select 1
        from public.project_assets pa
        where pa.id = a.k::uuid
          and pa.project_id = p_project_id
          and pa.upload_state = 'ready'
          and pa.storage_path = a.v ->> 'storagePath'
          and pa.mime_type = a.v ->> 'mimeType'
          and to_jsonb(pa.width) = a.v -> 'width'
          and to_jsonb(pa.height) = a.v -> 'height'
          and to_jsonb(pa.byte_length) = a.v -> 'byteLength'
          and pa.sha256 = a.v ->> 'sha256'
          and exists (
            select 1 from storage.objects o
            where o.bucket_id = 'project-assets' and o.name = pa.storage_path
          )
      )
    ) then
      return jsonb_build_object('status', 'error', 'code', 'validation', 'retryable', false, 'reason', 'asset_not_ready');
    end if;
  end if;

  -- 6. Commit the new revision.
  begin
    update public.projects p
    set title = p_title,
        document = p_document,
        revision = p.revision + 1,
        last_mutation_id = p_mutation_id,
        is_ready = true
    where p.id = p_project_id
    returning p.revision, p.updated_at into v_revision, v_updated_at;
  exception
    when check_violation or not_null_violation then
      return jsonb_build_object('status', 'error', 'code', 'validation', 'retryable', false, 'reason', 'constraint');
    when program_limit_exceeded then
      return jsonb_build_object('status', 'error', 'code', 'quota', 'retryable', false, 'reason', 'program_limit');
  end;

  return jsonb_build_object(
    'status', 'saved', 'revision', v_revision,
    'mutationId', p_mutation_id, 'updatedAt', v_updated_at);
end
$$;

-- mark_project_deleted: revision-checked tombstone (plan05 §5 last paragraph, §7 step 3).
-- A retry with the mutation that created the tombstone replays `saved` before the revision check.
create function public.mark_project_deleted(
  p_project_id uuid,
  p_expected_revision integer,
  p_mutation_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.projects%rowtype;
  v_revision integer;
  v_updated_at timestamptz;
begin
  if v_uid is null then
    return jsonb_build_object('status', 'error', 'code', 'auth', 'retryable', false, 'reason', 'not_authenticated');
  end if;
  if p_project_id is null then
    return jsonb_build_object('status', 'unavailable');
  end if;
  if p_mutation_id is null or p_expected_revision is null or p_expected_revision < 0 then
    return jsonb_build_object('status', 'error', 'code', 'validation', 'retryable', false, 'reason', 'invalid_request');
  end if;

  select * into v_row
  from public.projects p
  where p.id = p_project_id and p.owner_id = v_uid
  for update;

  if not found then
    return jsonb_build_object('status', 'unavailable');
  end if;

  if v_row.deleted_at is not null then
    if v_row.last_mutation_id = p_mutation_id then
      return jsonb_build_object(
        'status', 'saved', 'revision', v_row.revision,
        'mutationId', v_row.last_mutation_id, 'updatedAt', v_row.updated_at);
    end if;
    return jsonb_build_object('status', 'unavailable');
  end if;

  if v_row.revision <> p_expected_revision then
    return jsonb_build_object('status', 'conflict', 'currentRevision', v_row.revision);
  end if;

  update public.projects p
  set deleted_at = now(),
      revision = p.revision + 1,
      last_mutation_id = p_mutation_id
  where p.id = p_project_id
  returning p.revision, p.updated_at into v_revision, v_updated_at;

  return jsonb_build_object(
    'status', 'saved', 'revision', v_revision,
    'mutationId', p_mutation_id, 'updatedAt', v_updated_at);
end
$$;

revoke execute on function public.reserve_project(uuid, text, uuid) from public, anon;
revoke execute on function public.save_project(uuid, integer, uuid, text, jsonb) from public, anon;
revoke execute on function public.mark_project_deleted(uuid, integer, uuid) from public, anon;
grant execute on function public.reserve_project(uuid, text, uuid) to authenticated;
grant execute on function public.save_project(uuid, integer, uuid, text, jsonb) to authenticated;
grant execute on function public.mark_project_deleted(uuid, integer, uuid) to authenticated;
