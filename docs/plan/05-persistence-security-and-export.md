# 05 — Persistence, security และ export

เอกสารนี้เป็นสัญญาการบันทึก/กู้คืนข้อมูล การเข้าถึง Supabase และการส่งออก อ่าน [data contracts](02-architecture-and-data-contracts.md) ก่อน implement และใช้ [ADR 0003](../adr/0003-local-drafts-and-cloud-saving.md), [0004](../adr/0004-authentication-and-data-access.md), [0006](../adr/0006-export-and-portable-projects.md) ประกอบ

## 1. สิ่งที่เก็บที่ไหน

| ที่เก็บ | ข้อมูล | เป็นข้อมูลหลักหรือ cache |
|---|---|---|
| PostgreSQL `projects.document` JSONB | Drawing info ทั้งโปรเจกต์ รวม Git state | Cloud document |
| PostgreSQL `projects` columns | เจ้าของ ชื่อ revision สถานะ และเวลา | Cloud metadata |
| PostgreSQL `project_assets` | Metadata ของภาพแนบ | Asset ownership/reference |
| Private Storage `project-assets` | Bytes ของภาพที่ผู้ใช้เพิ่ม | Immutable attachment bytes |
| IndexedDB | Local drafts, pending editor recovery, asset blobs, upload/save jobs | งานที่ยังไม่ sync และ local cache |
| IndexedDB session/thumbnail stores | Camera, tool defaults, derived thumbnails | สร้างใหม่ได้ ไม่ต้อง sync |
| PNG/PDF/`.learning-suit` | ไฟล์ download ในเครื่องผู้ใช้ | Export ตามคำสั่ง ไม่เก็บบน server อัตโนมัติ |

**การ Save ไม่สร้างภาพของกระดาน** หากบทเรียนมีแต่เส้น รูปทรง และข้อความ จะไม่มีภาพแนบใน Storage เลย

## 2. Local repository และ account isolation

ใช้ IndexedDB ชื่อ `learning-suit`, version 1 และ object stores ต่อไปนี้:

| Store | Key | Value |
|---|---|---|
| `drafts` | `[ownerId, projectId]` | LocalDraft ตาม contracts |
| `assets` | `[ownerId, projectId, assetId]` | bytes (ArrayBuffer + MIME; WebKit private/ephemeral sessions ปฏิเสธ Blob ใน IndexedDB), AssetReference metadata; สถานะ upload อ่านจาก cloud `project_assets` |
| `sessions` | `[ownerId, projectId]` | activeSlideId, cameras, tool defaults/panel preferences |
| `saveJobs` | `[ownerId, projectId]` | durable in-flight snapshot พร้อม mutationId/expectedRevision/localSequence |
| `deletionJobs` | `[ownerId, projectId]` | mutationId, expectedRevision และ phase ของ tombstone/Storage/metadata cleanup |
| `thumbnails` | `[ownerId, projectId, slideId]` | PNG blob + localSequence สำหรับ invalidation |

หลังจบ document transaction เพิ่ม `localSequence` แล้ว enqueue write แบบเรียงลำดับ เก็บ content + sequence ใน IDB transaction เดียว การเพิ่มภาพใหม่ต้องเก็บ blob สำเร็จก่อน document อ้าง asset หาก IDB write ล้มเหลวคงงานใน memory แต่แสดง local-error และปุ่ม Export สำรอง ไม่อ้างว่าปลอดภัยในเครื่องแล้ว

อย่าคอย `beforeunload` เพื่อเริ่มบันทึกทั้งหมด: local write เกิดระหว่างใช้งาน `beforeunload` ใช้เตือนเฉพาะเมื่อมี memory-only changes หรือ pending IDB write และ browser อนุญาต ไม่อ้างว่ารับประกันป้องกันการปิด tab ได้

### Pending text/Git editor recovery

เมื่อ DOM edit focus เก็บค่าที่พิมพ์แยกเป็น `pendingEdit` ทุก 500ms หลังหยุดพิมพ์ รวม Unicode/IME โดยไม่แก้ cloud document ทุก keystroke ระหว่าง composition ไม่ flush เป็นคำสั่งเอกสาร

- Blur, เปลี่ยนสไลด์/เครื่อง/selection, Save หรือ Export: validate แล้ว flush เป็น document transaction หนึ่งครั้งและล้าง pendingEdit ใน local write เดียวกัน
- Validation ไม่ผ่าน: คง draft/focus และยกเลิก action ที่พึ่งพา ไม่ทำ Add/Commit หรือเปลี่ยนหน้าต่อ
- Escape: ทิ้ง pending edit และคืน before state พร้อมลบ recovery ของ draft นั้น
- Reload: หาก local base/document ยังเป็นฉบับที่ recovery อ้างอยู่ ให้เปิด editor พร้อม draft; ถ้าเลือกโหลด cloud หลัง conflict ให้เตือนว่าการเลือกนั้นทิ้ง pending edit ด้วย
- Cloud autosave รอ active pending edit จบ ข้อความสถานะต้องแยกจาก cloud saved แม้ document ก่อนเริ่มพิมพ์ถูก save แล้ว

### หลายแท็บและสลับบัญชี

ใช้ Web Locks API แบบ exclusive key `learning-suit:<ownerId>:<projectId>` ครอบ writer ตลอดเวลาที่ editor เปิด แท็บที่ถือ lock เท่านั้นแก้ document/IDB/queue ของโปรเจกต์นั้น แท็บอื่นเปิด read-only พร้อมคำแนะนำให้ปิด editor อีกแท็บแล้วกด `เปิดแก้ไข` ใหม่ ไม่มี steal lock อัตโนมัติ

ใช้ BroadcastChannel แจ้ง draft/lock release ให้แท็บอ่านอัปเดต หาก browser ไม่มี Web Locks ให้ปิดการแก้ไขพร้อมข้อความแนะนำ browser ที่รองรับ แทนทำ lock timeout ที่เสี่ยงมี writer สองตัว UI อื่นและ cloud data ยังอ่านได้

แยก local data ตาม ownerId และหยุด queue ก่อน sign out หรือ session identity เปลี่ยน เก็บ unsynced drafts ของบัญชีเดิมแต่ไม่แสดงหรือ upload ด้วยบัญชีใหม่ ให้กลับ login บัญชีเดิมเพื่อกู้ งานที่ผู้ใช้ export เองเท่านั้นที่นำเข้าอีกบัญชีได้

## 3. Cloud schema ที่ต้องสร้างใน M4

โครงร่าง DDL ต่อไปนี้เป็น contract ขั้นต่ำ ต้องสร้าง migration จริงพร้อม policies/functions/tests ตามส่วนถัดไป ห้าม deploy snippet ที่ยังไม่มี RLS

```sql
create table public.projects (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete restrict,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  document jsonb not null,
  revision integer not null default 0 check (revision >= 0),
  last_mutation_id uuid,
  is_ready boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (jsonb_typeof(document) = 'object'),
  check ((document ->> 'schemaVersion') is not distinct from '1'),
  check (jsonb_typeof(document -> 'slides') is not distinct from 'array'),
  check (jsonb_typeof(document -> 'assets') is not distinct from 'object'),
  check (octet_length(document::text) <= 16777216)
);
create index projects_owner_updated_idx
  on public.projects(owner_id, updated_at desc);

create table public.project_assets (
  id uuid primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('image/png','image/jpeg','image/webp')),
  width integer not null check (width between 1 and 8192),
  height integer not null check (height between 1 and 8192),
  byte_length integer not null check (byte_length between 1 and 10485760),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  upload_state text not null default 'pending' check (upload_state in ('pending','ready')),
  created_at timestamptz not null default now(),
  check (width::bigint * height::bigint <= 16777216)
);
create index project_assets_project_idx on public.project_assets(project_id);
```

เพิ่ม trigger ป้องกันเปลี่ยน immutable fields ของ assets หลัง insert (id/project_id/path/metadata) และ projects (id/owner_id/created_at) พร้อม `updated_at` จาก server ทุก update ตัว app ไม่ส่ง timestamp มาใช้ตัดสิน revision

`is_ready=false` คือ reservation สำหรับ initial upload ไม่แสดงบน dashboard เป็นบทเรียนที่บันทึกแล้ว ไม่มี public API สำหรับอ่านโปรเจกต์ของคนอื่น `deleted_at` คือ tombstone เพื่อจบ cleanup ได้แม้ network ขาด

Migration จริง (`supabase/migrations/20260925010000_init.sql`) เพิ่ม hardening แบบ additive: revision เพิ่มได้ครั้งละ 1 และต้องเพิ่มเมื่อเนื้อหา/lifecycle เปลี่ยน, แถวที่ถูก tombstone แก้ไม่ได้, `is_ready` ย้อนเป็น false ไม่ได้, asset ที่ `ready` กลับเป็น `pending` ไม่ได้, storage path ต้อง canonical ด้วย CHECK และ storage policy ตรวจ segment แรกเท่ากับ `auth.uid()` ด้วย

ไม่สร้างตาราง nodes/commits แยกใน v1 Git commits เป็นเนื้อหาการสอนใน document ไม่ใช่ประวัติ cloud save

## 4. Grants, RLS และ Storage policies

### Authentication

ใช้ `@supabase/ssr` browser/server clients และ auth refresh ตาม Next.js integration ของเวอร์ชันที่เลือก (Next 16 ใช้ไฟล์ `src/proxy.ts` แทน middleware เพื่อ refresh cookie เท่านั้น ไม่ใช่ขอบเขตสิทธิ์) ตรวจ validated claims (`getClaims()` หรือ verified server identity API ที่เอกสารของเวอร์ชันกำหนด) ก่อนสร้าง protected shell ไม่เชื่อ `getSession()` อย่างเดียวเพื่อ authorise server routes

Owner account สร้างผ่าน Supabase Dashboard แล้วปิด public signup ตั้ง email/password และ allowed redirect origins เฉพาะ development/preview/production ที่ใช้จริง ไม่เพิ่ม admin credential ในแอปเพื่อสร้างบัญชี

เมื่อ token หมดอายุ save คืน auth error เก็บ draft ไว้ เปิด login dialog แล้วตรวจ user ID เดิมก่อน resume queue หน้า editor ที่เปิดแล้วไม่ reload ทิ้ง memory

### Table policy matrix

เปิด RLS ทั้งสองตาราง `revoke all` จาก anon/authenticated ก่อน grant สิทธิ์ที่จำเป็น อนุญาต authenticated SELECT/INSERT/DELETE และ UPDATE เฉพาะ columns ที่ function ต้องใช้; anon ไม่มีสิทธิ์ตาราง/ฟังก์ชันเหล่านี้

| Table / operation | USING | WITH CHECK |
|---|---|---|
| projects SELECT | `owner_id = (select auth.uid())` | — |
| projects INSERT | — | owner เท่ากับ auth.uid, revision 0, is_ready=false, deleted_at=null, last_mutation_id=null |
| projects UPDATE | owner ตรงผู้ใช้ | owner ยังตรงผู้ใช้ |
| projects DELETE | owner ตรงผู้ใช้ และ deleted_at ไม่ null | — |
| project_assets SELECT | parent project owner ตรงผู้ใช้ | — |
| project_assets INSERT | — | parent owner ตรง, parent ยังไม่ deleted, storage_path canonical ตรงกับ owner/project/asset+mime |
| project_assets UPDATE | parent owner ตรง | parent owner ยังตรง; immutable metadata enforced |
| project_assets DELETE | parent owner ตรง | — |

ใช้ `exists(select 1 from public.projects p where p.id=project_id and p.owner_id=(select auth.uid()))` เป็นรูปแบบ parent ownership จริง ไม่ใช้ข้อมูล owner ที่ client ส่งมาแทน identity และไม่สร้าง policy วนระหว่าง projects↔assets

Projects UPDATE columns ที่ grant: `title,document,revision,last_mutation_id,is_ready,deleted_at`; `updated_at` มาจาก trigger ส่วน Assets UPDATE grant เฉพาะ `upload_state` ทุก function ใช้ `SECURITY INVOKER SET search_path = ''`, fully qualified table names และ `revoke execute ... from public, anon` แล้ว grant ให้ authenticated เท่านั้น

Policies อนุญาต owner อ่าน tombstone/reservation เพื่อ recover/cleanup แต่ application queries กรองเฉพาะ ready+not deleted สำหรับ dashboard/editor ปกติ Save RPC ปฏิเสธ deleted เสมอ Policies ไม่อ้างว่า JSON ทุก node ผ่าน Zod บน server: structural/size/reference checks เป็น DB guard, full model validation ใช้เมื่อโหลด/ส่งออกด้วย

### Private bucket

Bucket ชื่อ`project-assets`, private, allowedMIME/size ตาม contracts ใช้ path:

```text
<owner-uuid>/<project-uuid>/<asset-uuid>.<png|jpg|webp>
```

Storage policies บน `storage.objects` จำกัด bucket_id และ metadata row ที่มี storage_path ตรง name และ parent owner ตรง auth.uid ส่วน SELECT/DELETE อนุญาต owner แม้ project ถูก tombstone เพื่อ cleanup; INSERT ต้อง parent ยังไม่ถูกลบและ asset row เป็น pending; ไม่มี Storage UPDATE/upsert สำหรับ immutable assets

การเปลี่ยนรูปสร้าง asset UUID/path ใหม่ ไม่ overwrite bytes เดิม SignedURL ใช้เฉพาะ session ถ้าจำเป็น; preferred resolver ใช้ authenticated download เป็น Blob/ObjectURL แล้ว revoke เมื่อเลิกใช้ ไม่เก็บ signedURL/dataURL/token ใน document

ยังคง SELECT policy บน projects ที่รองรับ UPDATE และทุกกรณี WITH CHECK ป้องกันการสร้าง/ย้ายแถวข้ามเจ้าของ ต้องทดสอบผ่าน REST/RPC/Storage จริงใน local Supabase ไม่ทดสอบโดยใช้ service_role ซึ่งข้าม RLS

## 5. First save, uploads และ atomic save RPC

### การสร้างโปรเจกต์ใหม่บน cloud

Local Create ใช้ UUID ทันทีและ baseRevision=null แล้ว coordinator ทำดังนี้:

1. `reserve_project(p_id,p_title,p_initial_slide_id)` สร้างแถว owner จาก auth.uid, revision 0,is_ready=false ด้วยเอกสารหนึ่งสไลด์ว่างที่ valid และไม่มี assets ถ้าแถว id เดิมมีอยู่ตรวจ ownership และสถานะก่อนคืน ห้ามใช้ upsert เขียนทับเอกสาร
2. หากพบ reservation ของตนเองให้ resume หากพบ ready row หลัง request ก่อนหน้า timeout ให้ load ตรวจ last_mutation_id และผลเดิม ไม่เริ่ม initial save ซ้ำโดยไม่ตรวจ
3. Register asset metadata ที่ snapshot ใช้งานทั้งหมดเป็น pending ด้วย path canonical ตรวจถ้ามี row เดิม metadata ต้องตรงทุก field
4. Upload bytes ด้วย upsert=false; ถ้า response หายแต่ไฟล์มีอยู่ ให้ download/hash เทียบ sha256 ก่อนถือว่าขั้นนี้สำเร็จ
5. ตั้ง metadata เป็น ready หลังยืนยัน bytes สำเร็จ
6. `save_project` expectedRevision 0 บันทึก content snapshot จริงและ is_ready=true ใน transaction เดียว revision เปลี่ยนเป็น 1 จึงแสดง cloud saved ได้

Reservation และ metadata ที่ค้างไม่ใช่งานที่บันทึกสำเร็จ UI ยังใช้ local draft และ pending badge โครงการที่ยัง is_ready=false ไม่ปรากฏเป็นบทเรียนเปล่าในเครื่องอื่น `LocalDraft.baseRevision` ยังคง null จน publish ครั้งแรกสำเร็จ เพื่อให้ reload ก่อน publish กลับเข้า reserve/resume flow ไม่ตีความ reservation ว่าเป็น project ที่หายไป Save job ของการ publish แรกใช้ expectedRevision 0 โดยไม่เปลี่ยน baseRevision ของ draft ล่วงหน้า

### RPC contract

```text
save_project(
  p_project_id uuid,
  p_expected_revision integer,
  p_mutation_id uuid,
  p_title text,
  p_document jsonb
) -> SaveResult JSON
```

ลำดับภายใน PL/pgSQL:

1. ตรวจว่า authenticated แล้ว SELECT แถวที่ RLS มองเห็น`FOR UPDATE` ตาม project ID
2. ไม่พบ/deleted → `unavailable` เหมือนกันเพื่อไม่เปิดเผยข้อมูลของผู้อื่น
3. ถ้า last_mutation_id ตรง p_mutation_id → คืนผล saved ของแถวเดิม ไม่ increment revision ซ้ำ client ต้อง retry ด้วย payload เดิมเสมอ
4. ถ้า revision ไม่ตรง expected → `conflict` พร้อม currentRevision ไม่แก้ document
5. Validate title, document envelope/size, slides count และ asset references ทุก Image asset ต้องอยู่ใน document assets, metadata ของทุก referenced asset ต้องตรง project_assets ที่ ready+parent ID ตรง และ Storage object มีอยู่; ไม่ยอมให้ document อ้าง path จากอีก project
6. UPDATE title/document, ตั้ง revision=revision+1, last_mutation_id=p_mutation_id และ is_ready=true พร้อม updated_at จาก server แล้วคืน saved

สำหรับ schema/invalidUUID/reference ผิดให้คืน validation error และ rollback ทั้งหมด SQL ต้องล็อก projects ก่อน assets เสมอเพื่อลด deadlock Validate JSON type ก่อน cast/iterate เพื่อให้ invalid payload ถูกจัดประเภทเป็น validation ไม่เป็นข้อผิดพลาดที่รั่ว SQL

`last_mutation_id` ครอบคลุม retry ของ job ล่าสุด ไม่ใช่ global deduplication log หากอีกเครื่อง save ต่อแล้ว last ID เปลี่ยน retry เก่าต้อง conflict และเก็บ draft ไม่อ้างว่า server สามารถจำทุก request ย้อนหลัง

`reserve_project` และ `mark_project_deleted` ใช้ invoker/grants/search_path รูปแบบเดียวกัน โดย mark delete รับ expectedRevision+mutationId และ lock แถวก่อนตรวจเช่นเดียวกับ Save ถ้า tombstone เดิมเกิดจาก mutationId เดียวกัน ให้คืนผลสำเร็จเดิมก่อนตรวจ revision เพื่อให้ retry ได้โดยไม่เพิ่ม revision ซ้ำ; ถ้ามีการแก้ไขก่อน tombstone ต้อง conflict

## 6. Save coordinator และ recovery rules

มีหนึ่ง in-flight job ต่อ project และหนึ่ง writer ต่อ browser installation ด้วย Web Lock โดย job เก็บ immutable content snapshot, mutation UUID, expectedRevision และ localSequence ลง saveJobs ก่อนส่ง network

```text
document transaction
  → local write acknowledged
  → debounce 1500ms / explicit Save
  → finish referenced asset uploads
  → persist immutable save job
  → call atomic RPC
  → update acknowledged revision/sequence in IndexedDB
  → if newer local sequence exists, schedule next save
```

- ระหว่าง request ส่งอยู่ผู้ใช้วาดต่อได้ Document ใหม่ไม่แก้ snapshot ของ job เดิม
- Success: update baseRevision สำหรับ draft ปัจจุบันและ acknowledgedSequence เฉพาะ sequence ที่ส่ง ไม่เขียน snapshot เก่าทับ content ปัจจุบัน
- แสดง cloud saved เมื่อ localSequence เท่ากับ acknowledgedSequence, ไม่มี pendingEdit/upload/local write และ request ล่าสุดสำเร็จเท่านั้น
- Timeout/network: เก็บ job เดิมและ mutationId เดิม ใช้ retry backoff 1, 2, 4, 8 วินาที สูงสุด 30 วินาที; pause เมื่อ offline และ reset หลังสำเร็จ Manual retry ทำทันที ไม่ปล่อย autosave ใหม่แซง job เก่า
- Auth failure: pause จน login เจ้าของเดิม หาก session เปลี่ยนบัญชีหยุด queue ทั้งหมด
- Validation/quota: คง draft หยุด auto retry เฉพาะ payload เดิม แสดงสาเหตุให้แก้ document หรือ export สำรอง
- Conflict: หยุด queue เก็บ local content รวม pendingEdit และแสดงสองทางเลือก ไม่มี last-write-wins/Force overwrite
- Unavailable: ถ้า project หาย/deleted/ไม่มีสิทธิ์ เสนอเก็บ local เป็นสำเนาใหม่ในบัญชีเดิม ไม่สร้างคืน UUID เดิมอัตโนมัติ

### เมื่อเปิดโปรเจกต์ใหม่/หลัง crash

1. อ่าน owner identity, lock และ local draft ก่อน เริ่มแสดงฉบับ local เมื่อมี
2. ถ้ามี durable save job ที่ยังไม่ ack ให้ resolve/retry exact job ก่อนโหลด cloud มาทับ แล้วค่อย reconcile
3. baseRevision=null → ยังไม่เคย publish สำเร็จ ใช้ local ต่อและเข้า reserve/resume flow เมื่อออนไลน์ ไม่ใช้ reservation document มาแทน local
4. สำหรับโปรเจกต์ที่ publish แล้ว นิยาม dirty ว่า localSequence ต่างจาก acknowledgedSequence **หรือมี pendingEdit** ถ้าไม่ dirty ให้ใช้ cloud ล่าสุดเมื่อโหลดและ validate สำเร็จ
5. Dirty และ baseRevision ตรง cloud → ใช้ local แล้ว sync หลัง pending edit flush
6. Dirty และ baseRevision ต่าง cloud → conflict ทันที ห้ามเดาจาก timestamp ว่าฉบับไหนใหม่กว่า
7. Cloud load ล้มเหลว → ใช้ local พร้อม badge offline; ถ้าไม่มี local แสดง retry ไม่สร้างเอกสารว่างมาทับ cloud
8. Cloud schema ไม่รองรับ → คง local เดิมแต่ pause cloud writes พร้อมแจ้ง version ไม่พยายามลด schema โดยทิ้ง fields

การใช้ cloud หลัง conflict เป็นการยอมทิ้ง draft ที่ยังไม่ sync ต้องมี dialog แสดงชื่อและตัวเลือก Export สำรอง การเก็บ local เป็นสำเนาใช้ project/node/slide/asset IDs ใหม่ และคัดลอก bytes เข้าสังกัดใหม่ตาม import remapping

## 7. Asset lifecycle, duplication และ project deletion

ภาพมี metadata และ immutable bytes หนึ่งชุดต่อ asset UUID Duplicate nodes/slides ใน project อ้าง asset เดิมได้ Duplicate project/import ต้องใช้ paths ใหม่ทั้งหมด

การลบ node ไม่ลบ asset bytes ทันทีเพราะ Undo/Redo ยังใช้ Serialization normalizer ตัด asset references ที่ไม่มี node ใช้ออกจาก cloud snapshot/archive แต่ไม่ลบ registry/blobs ของ active session เพราะ history อาจอ้างอยู่ การเทียบ semantic equality ใช้ normalizer เดียวกัน รุ่นแรกไม่ทำ automatic orphan GC ระหว่างแก้เพื่อหลีกเลี่ยงลบ asset ที่ offline client ยังต้องใช้

เมื่อลบ project:

1. Flush local draft, pause การ enqueue save ใหม่ แล้วขอยืนยัน หากมี request in flight ให้ resolve ผลของ job เดิมก่อนเริ่ม tombstone; การ abort HTTP ไม่ได้ยกเลิก transaction ที่ server รับแล้ว
2. บันทึก deletion job ก่อนเริ่ม network ใช้ `inspectLifecycle()` ตรวจ owner row รวม reservation/tombstone แม้ baseRevision=null เพื่อจับกรณี reserve สำเร็จแต่ response หาย หากยืนยันว่าไม่มี cloud row จึงลบ local stores ได้; network error ไม่เท่ากับไม่มีแถว ให้เก็บ job รอ retry
3. ถ้ามี cloud row ใช้ mark_project_deleted แบบ revision checked; conflict ให้โหลดสถานะใหม่ก่อนยืนยันลบอีกครั้ง หากเป็น tombstone ของ owner อยู่แล้วให้ไปขั้น cleanup ได้
4. Tombstone ซ่อนจาก dashboard และทำให้ save ใหม่ถูกปฏิเสธ แต่ owner ยัง cleanup ได้
5. ลบ Storage objects ใน project prefix เป็น batches ผ่าน Storage API โดย list หน้าแรกซ้ำจนหมด เพื่อไม่ข้ามรายการเมื่อข้อมูลเลื่อนหลังลบ จากนั้นลบ asset metadata แล้ว hard delete project row
6. ลบ local stores เมื่อ cloud cleanup เสร็จ; ถ้าขาด network ให้เก็บ deletion job และ resume เมื่อกลับมา อย่ารีเซ็ต tombstone ให้ active อัตโนมัติ

ไม่มี direct SQL delete บน storage.objects เพื่อแทนการลบ bytes จริง ใช้ Storage API ตามสัญญาของ service เสมอ ทั้งการ Save และ cleanup ต้องตรวจ deletion job ก่อน resume เพื่อไม่ฟื้นงานที่ผู้ใช้สั่งลบ

## 8. Bounds-based PNG/PDF export

เริ่มจาก flush pending edit และรอ gesture จบ จากนั้น freeze เอกสาร snapshot และ selection ในขณะกด Export ไม่ขยับ camera/selection จริง Renderer ของ export ใช้ nodeviews ชุดเดียวกับ editor แต่ไม่ cull offscreen nodes และไม่ render transient layer

รอ font และ referenced assets ทั้งหมดก่อน หากขาดภาพให้แสดงชื่อ/asset ID และหยุด ไม่แทนภาพว่างจนผู้ใช้เข้าใจว่าครบ Snapshot ที่เป็นอิสระทำให้ผู้ใช้วาดต่อได้ระหว่าง export โดยไม่เปลี่ยนไฟล์ที่กำลังสร้าง มี Cancel และ progress สำหรับ PDF/archive

### Bounds และขนาดภาพ

คำนวณ union ของ `getNodeBounds` ทั้งหมดที่ export รวม rotation, strokes, round caps, arrowheads และ Git widget rect รวม locked nodes เมื่อ export ทั้งสไลด์ แต่ selected-only รวมเฉพาะ IDs ที่เลือกจริง

```text
left   = floor(minX - padding)
top    = floor(minY - padding)
right  = ceil(maxX + padding)
bottom = ceil(maxY + padding)
W = right - left
H = bottom - top
s = min(requestedScale, 8192/W, 8192/H, sqrt(16777216/(W*H)))
```

ใช้ dimensions ที่ปัดแล้วตรวจ cap ซ้ำหลัง rounding ถ้าลด s จากที่ผู้ใช้เลือกให้แสดง pixel dimensions จริงและ warning โดยไม่ crop เนื้อหา

ต้องจำกัดขนาด **ก่อนสร้าง backing canvas**: สร้าง export stage/layer เริ่มขนาด1×1 ตั้ง canvas pixel ratio เป็น1 แล้วปรับ stage เป็นขนาดผลลัพธ์ `pixelWidth=floor(W*s)`, `pixelHeight=floor(H*s)` วาด world nodes ใน Group ที่ scale=s และ translation=(-left*s,-top*s) แล้ว encodeด้วยpixelRatio1 ห้ามสร้าง stage ขนาดworldW×Hก่อนค่อยลดตอนexport เพราะอาจallocatebitmapใหญ่เกินmemoryก่อนถึงขั้นลด ไม่เปลี่ยนpixelratio/cameraของeditorจริงและต้องคืนresourcesในfinally

Empty slide ใช้ logical1280×720 ไม่บวก padding ซ้ำ Selected-only เมื่อ selection ว่างให้ disable action และแจ้ง ไม่มี fallback เงียบเป็นทั้งสไลด์

PNG เริ่มต้น2× เลือก1×/2×/3×, padding0–256 โดยเริ่มที่48 world units และพื้นหลังจากslideหรือtransparent ถ้า browser allocation/encoding ล้มเหลวต้องคืนerror ไม่ดาวน์โหลดblobว่าง หากสัดส่วนสุดโต่งจนความกว้าง/สูงอย่างใดต่ำกว่า1pxหลังลดขนาด ให้แจ้งลดขอบเขต/แยกสไลด์ ไม่ขยายภาพฝ่าฝืนcap

### PDF

หนึ่งหน้า/สไลด์ตาม array order ใช้ raster PNG ที่ render2× และจำกัด pixels ตามสูตรด้านบน PDF page units ใช้1 world unit=1 PDF point เมื่อขนาดไม่เกิน14,400 points/edge; ถ้าเกินลดpage width/heightด้วยfactorเดียวกันให้ด้านยาวสุด14,400 ตามapp capเพื่อรักษาความเข้ากันกับPDFreaders โดยรักษาสัดส่วนและpaddingในภาพ

ฝัง PNG เต็มหน้าไม่มี padding เพิ่มซ้ำ ภาพที่มีพื้นหลังใช้สี slide ไม่ทำ transparent PDF สไลด์ว่าง 1280×720points ข้อความใน PDF เลือกไม่ได้ใน v1

Render และ embed ทีละหน้าแล้ว destroy offscreen stage/revoke object URLs อย่างไรก็ตาม pdf-lib ถือ embedded data ทั้งเอกสารจน save ให้แสดง progress และ Cancel หาก memoryerror ให้แจ้ง exportPNG แยกสไลด์ ห้ามอ้างว่า PDF streaming หรือ memory คงที่

ชื่อไฟล์ default`<ชื่อบทเรียน>-<ชื่อสไลด์>.png`, `<ชื่อบทเรียน>.pdf`, `<ชื่อบทเรียน>.learning-suit` sanitize เฉพาะ filename สำหรับ download ไม่แก้ title จริง

## 9. Portable archive และ import

### Wire format v1

ใช้ ZIP ด้วย fflate ตาม types`ArchiveManifest/ArchiveDocument`ใน[contracts](02-architecture-and-data-contracts.md)

```text
manifest.json
document.json
assets/<asset-id>.png
assets/<asset-id>.jpg
assets/<asset-id>.webp
```

ตัวอย่าง manifest สำหรับเอกสารไม่มีภาพ:

```json
{
  "format": "learning-suit",
  "formatVersion": 1,
  "documentSchemaVersion": 1,
  "title": "Git เบื้องต้น",
  "exportedAt": "2026-09-24T12:00:00.000Z",
  "assets": []
}
```

`document.json` ใช้ ProjectDocument โดยตัด `storagePath` ออกจาก asset metadata ทุกตัว นำเฉพาะ assets ที่ nodes อ้างอยู่ลง manifest/ZIP ไม่รวม ownerId, projectId, cloud revision, tokens, signed URLs, session/history หรือ pendingEdit ใน archive ส่วน exportedAt เป็น metadata ไม่ใช้เลือก version ล่าสุด

Schema ของ archive assets ยังเก็บ id,mimeType,width,height,byteLength,sha256 ส่วน manifest จับคู่ id กับ relative entry path ไม่ใส่รูปเป็น dataURL ใน JSON

### Export sequence

Validate/freeze content → collect referenced assets → resolve bytes ทั้งหมด → verify hash/metadata → build sanitized ArchiveDocument+Manifest → ZIP ใน Web Worker → download Blob หากเกิน50 MiB compressedหรือ100 MiB uncompressedให้แจ้งและไม่สร้างไฟล์บางส่วน

### Import sequence

1. อ่าน file≤50MiB ตรวจ ZIP signature และใช้ streaming decompression ใน worker
2. นับ actual uncompressed bytes รวม≤100MiB และ entries≤1000 ระหว่างแตก ไม่เชื่อ central directory size อย่างเดียว
3. ปฏิเสธ absolute/path traversal/backslash/duplicate entry/encrypted/symlink entries, unknown required format และ entry ที่ไม่ใช่ manifest/document หรือ assets ที่ manifest ระบุ; allow เฉพาะ stored/deflate compression
4. Validate JSON schemas แบบ strict,version 1,limits,uniqueIDs,reference integrity และ Gitgraph ก่อนสร้าง project
5. Validate ภาพทุกไฟล์ด้วย hash/MIME/decode/dimensions ตรง metadata ทำทีละภาพและคืน decoded bitmap หลังตรวจ ไม่เก็บภาพdecodedทั้งหมดพร้อมกัน ไม่โหลดexternalURLจากarchiveและไม่executeHTMLตัวอย่างGit
6. สร้าง projectUUID ใหม่และ remapslide/node/assetUUIDs ทั้งหมด; rebuild storage paths ภายใต้ owner ปัจจุบัน รักษา commitIDs ภายใน widget และลำดับ objects/slides
7. Writeblobs+local draft ใหม่ใน IDB transaction เดียวเมื่อ validation ครบเท่านั้น แล้วเปิด project ใหม่และ enqueue cloud save ผ่าน reservation flow
8. หาก storage quota ไม่พอหรือขั้นตอนก่อนหน้านี้ล้มเหลว ห้ามเปลี่ยน project ที่เปิดอยู่ ล้าง temporary worker buffers แล้วแสดงเหตุผล

Semantic round trip เปรียบเทียบ document หลัง normalizeIDs/storage paths/exporttime ต้องตรง geometry,styles,lock,z-order,slideorder,ข้อความและ Git state ทุกค่า Bytes ของภาพเดิมต้อง sha256 ตรง

## 10. ลำดับ implement และ acceptance

1. Local repositories+ownerkeys+writerlock+recovery
2. SupabaseDDL/grants/RLS/policies และ pgTAPtests
3. Reservation/assets upload+atomic CAS RPC
4. Save coordinator/reload/conflict/expired session/tombstone cleanup
5. Shared offscreen renderer+PNG/PDF
6. Archive worker/strict import+roundtrip

เกณฑ์สำคัญ: stale cloud response ไม่ทับงานใหม่, retryjob เดิมไม่ increment revision ซ้ำ, networkfail ทุกขั้นของ assets ไม่ทำ document อ้างภาพหาย, ผู้ใช้อื่นเรียก REST/RPC/Storage ไม่ได้, failed import ไม่เปลี่ยนเอกสารปัจจุบัน และ export ไม่ถูก crop ตาม viewport รายละเอียด testIDs และสถานะจริงอยู่ที่[delivery](06-delivery-and-acceptance.md)

## แหล่งอ้างอิง

ตรวจเมื่อ 2026-09-24: [Supabase SSR auth](https://supabase.com/docs/guides/auth/server-side/nextjs), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Database functions](https://supabase.com/docs/guides/database/functions), [Storage access control](https://supabase.com/docs/guides/storage/security/access-control), [Private buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals), [Konva export](https://konvajs.org/docs/data_and_serialization/High-Quality-Export.html), [pdf-lib](https://pdf-lib.js.org/), [fflate](https://github.com/101arrowz/fflate)
