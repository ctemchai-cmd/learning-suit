# Runbook — Preview และ Production (M7.3 / M7.4)

เอกสารนี้เป็นขั้นตอนปฏิบัติสำหรับเจ้าของ repository ใช้ร่วมกับเกณฑ์ DEP-01..04 ใน [delivery](../plan/06-delivery-and-acceptance.md) สถานะว่าทำแล้วหรือยังบันทึกที่ delivery เท่านั้น ห้ามใส่ key, password หรือ project ref จริงในไฟล์นี้

## 0. สิ่งที่ต้องมีก่อน

- Docker Desktop และ [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) บนเครื่องที่ใช้ migrate/test
- Supabase สองโปรเจกต์แยกกัน: **preview** และ **production** (preview ไม่มีข้อมูลจริงของผู้ใช้)
- Vercel project ที่เชื่อม Git repository ของผู้ใช้
- Node.js 24 + `corepack pnpm` (pnpm ถูก pin ไว้ใน `packageManager`)

## 1. ตรวจบนเครื่องก่อนทุก release (DEP-01)

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test:unit
corepack pnpm test:db:local      # pgTAP บน PostgreSQL shim (ไม่ต้องมี Docker)
supabase start                   # local Supabase จริง
supabase test db                 # pgTAP บน Supabase จริง
supabase status -o env           # นำค่า local มาใส่ SUPABASE_TEST_* (ค่า local เท่านั้น)
corepack pnpm test:integration   # REST/RPC/Storage ด้วยผู้ใช้ A/B/anon
corepack pnpm build
corepack pnpm test:e2e           # chromium + webkit (ไม่ตั้ง Supabase env = local adapter)
```

บันทึกเวอร์ชันจริงจาก `node -v`, `corepack pnpm -v`, `package.json` และผลคำสั่งลง handoff record ของ delivery

## 2. Supabase preview (DEP-02)

1. `supabase link --project-ref <preview-ref>` (ใช้ access token ใน shell ของเครื่อง deploy เท่านั้น)
2. `supabase db push` — apply `supabase/migrations/*` **ก่อน** deploy แอปที่อ้าง schema ใหม่
3. ตรวจใน Dashboard ว่า RLS เปิดบน `projects` และ `project_assets`, bucket `project-assets` เป็น private, file size limit 10 MiB และ MIME png/jpeg/webp
4. Authentication → Providers → Email: **ปิด "Allow new users to sign up"** แล้วสร้างบัญชี owner ด้วย Add user (ตั้ง password ใน Dashboard ห้ามใส่ใน repository)
   - ใช้ **Add user** เท่านั้น (ใส่อีเมล + รหัสผ่าน และติ๊ก Auto Confirm User) แอปไม่มีหน้าสมัครสมาชิกและไม่มี “ลืมรหัสผ่าน” จึงไม่ใช้ Invite user หรือลิงก์ทางอีเมล
   - Authentication → Sign In / Providers → Email: ตั้ง Minimum password length = 12 ให้ตรงกับ `supabase/config.toml` และแอป
5. Authentication → URL Configuration: Site URL = URL preview, Redirect URLs เฉพาะ origin ของ development/preview ที่ใช้จริง
6. สร้างผู้ใช้ทดสอบ B ชั่วคราวใน preview แล้วรันชุด direct API ของ `pnpm test:integration` กับ preview ได้เฉพาะเมื่อยอมรับว่าจะสร้าง/ลบ fixture ในโปรเจกต์ preview; ลบ B หลังตรวจ

## 3. Vercel

### ตั้งค่าโปรเจกต์

1. Vercel → Add New Project → Import Git repository นี้ (Framework: Next.js ตรวจเองอัตโนมัติ)
2. ไม่ต้องแก้ Build Command/Install Command: Vercel ใช้ pnpm จาก `pnpm-lock.yaml` และรัน `pnpm build` (= `next build --webpack`)
3. Node.js ถูก pin ใน `package.json` → `"engines": { "node": "24.x" }` ให้ตรงกับเวอร์ชันที่ทดสอบ
4. Settings → Functions → Region: เลือกใกล้ region ของ Supabase (เช่น Supabase `ap-southeast-1` ↔ Vercel `sin1` Singapore) เพราะ `src/proxy.ts` และหน้า protected เรียก Supabase Auth ทุก request
5. แนะนำเปิด Deployment Protection สำหรับ Preview

### Environment variables

| ตัวแปร | Preview | Production |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL ของ Supabase preview | URL ของ Supabase production |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | publishable key ของ preview | publishable key ของ production |

- ตั้งค่า **ก่อน build ครั้งแรก**: ค่า `NEXT_PUBLIC_*` ถูก inline ตอน build ถ้าแก้ภายหลังต้อง Redeploy
- ใช้ Environment scope ของ Vercel แยก Preview/Production ให้ชี้คนละ Supabase project
- ถ้า deploy โดยไม่มีค่าเหล่านี้ แอปจะแสดง “ยังเปิดใช้งานไม่ได้” โดยตั้งใจ (ไม่มี fallback identity ใน production)
- ห้ามตั้ง service-role/secret key เป็น `NEXT_PUBLIC_*`; key ที่ขึ้นต้น `sb_secret_` หรือ JWT role `service_role` ทำให้ **build ล้มทันที** (`next.config.ts`) จึงไม่ถูกฝังลง bundle ของ browser และ runtime ก็ปิด cloud features ถ้าหลุดมาได้ Runtime ไม่ต้องใช้ secret key

### Supabase Auth ที่เกี่ยวกับ Vercel

- แอปใช้แค่ login ด้วยรหัสผ่าน ไม่มีลิงก์ทางอีเมลใดๆ จึงไม่ต้องตั้ง Redirect URLs, Email Templates หรือ SMTP; ตั้ง Site URL = โดเมน production ไว้ก็พอ
- **เปลี่ยนรหัสผ่าน**: login แล้วกด “เปลี่ยนรหัสผ่าน” ในหน้าโปรเจกต์ (`/change-password` ต้องใส่รหัสปัจจุบัน ใหม่อย่างน้อย 12 ตัว)
- **ลืมรหัสผ่าน** (ไม่มีในแอปโดยตั้งใจ): ผู้ดูแลตั้งรหัสใหม่ใน Supabase → SQL Editor ห้ามลบแล้วสร้างผู้ใช้ใหม่ เพราะ ID ใหม่จะไม่ใช่เจ้าของโปรเจกต์เดิม
  ```sql
  update auth.users set encrypted_password = extensions.crypt('<รหัสใหม่อย่างน้อย 12 ตัว>', extensions.gen_salt('bf'))
  where email = '<อีเมลเจ้าของ>';
  ```
  พิมพ์รหัสใน SQL Editor เท่านั้น ห้ามบันทึกลงไฟล์ใน repository
- แนะนำเปิด JWT Signing Keys แบบ asymmetric (Project Settings → JWT Keys) เพื่อให้ `getClaims()` ตรวจ token ได้จาก JWKS ที่ cache ไว้ ไม่ต้องเรียก Auth server ทุก request ใน proxy
- ลำดับทุก release: `supabase db push` (migration) **ก่อน** Vercel deploy แอปที่อ้าง schema ใหม่

### ตรวจแล้วบนเครื่อง (ไม่ใช่ Vercel จริง)

Production build ที่ตั้ง Supabase env (ค่า placeholder) + `next start`: `/`, `/projects`, `/projects/<id>` ไม่มี session → 307 ไป `/login` (เก็บ `next`), cookie ปลอม → `/login` ไม่ error, project id ผิดรูปแบบ → 404, หน้า protected ตอบ `Cache-Control: private, no-store`, `/login` ไม่มีสมัครสมาชิก

## 3b. ห้องวาดร่วม (Supabase Realtime)

ห้องวาดร่วม (plan 08) ใช้ Realtime broadcast + presence แบบ public channel ด้วย publishable key ไม่ต้อง migration
- Supabase Dashboard → Project Settings → Realtime: ถ้าเปิด “Private channels only” ไว้ ให้ปิด (ห้องใช้ public channel ชื่อ `live:<roomId>` ที่เดาไม่ได้)
- ตรวจโควตา Realtime ของแพ็กเกจ (การเชื่อมต่อพร้อมกัน / ข้อความต่อเดือน) ให้พอกับจำนวนผู้เรียน
- Smoke: ครูเปิดบทเรียน → วาดร่วม → เปิดห้อง → เปิดลิงก์ในอีก browser (หน้าต่างไม่ระบุตัวตน) ใส่ชื่อ → วาดสองฝั่ง → ปิดห้อง

## 4. Preview smoke (DEP-03)

1. เปิด preview → ถูกพาไป `/login` (ไม่มีปุ่มสมัครสมาชิก) → login owner
   - รหัสผิด → “อีเมลหรือรหัสผ่านไม่ถูกต้อง”; login แล้วเปิด `/login` อีกครั้ง → ข้ามไป `/projects`
   - ไม่มีลิงก์ “สมัครสมาชิก” หรือ “ลืมรหัสผ่าน”; `/signup`, `/forgot-password` ตอบ 404
   - “เปลี่ยนรหัสผ่าน” → รหัสปัจจุบันผิด → “รหัสผ่านปัจจุบันไม่ถูกต้อง”; ถูก → เปลี่ยนแล้ว → ออกจากระบบ (ขึ้น “ออกจากระบบแล้ว”) → login ด้วยรหัสใหม่ได้
   - เปิดสองแท็บ → ออกจากระบบในแท็บหนึ่ง → อีกแท็บ (หน้าโปรเจกต์) ไปหน้า login เอง
2. สร้างโปรเจกต์ → วาด + แทรกรูป PNG → รอสถานะ `บันทึกบน Cloud แล้ว`
3. เปิด browser/โปรไฟล์อื่น login owner → เปิดโปรเจกต์ → เห็นรูปและวัตถุเดิม
4. Export PNG, PDF และ `.learning-suit` → Import ไฟล์นั้นกลับเป็นโปรเจกต์ใหม่
5. ตรวจ client bundle: `grep -rE "sb_secret_[A-Za-z0-9]|eyJ[^\"]{40,}" .next/static` ต้องไม่พบ key จริง (พบได้เฉพาะโค้ดตรวจ prefix)
6. ลองเปิด REST ด้วย publishable key โดยไม่มี session: `GET /rest/v1/projects` ต้องได้แถวว่าง/ปฏิเสธ

## 5. Production (DEP-04)

1. ใช้ migration ชุดเดียวกับที่ผ่าน preview: `supabase link --project-ref <prod-ref>` → `supabase db push`
2. ตั้ง Auth (ปิด signup, owner, redirect URLs) เหมือนข้อ 2
3. Promote deployment ที่ผ่าน preview ใน Vercel
4. Smoke ด้วยบทเรียนทดสอบ: login → สร้าง → save → reopen → export แล้วลบบทเรียนทดสอบ
5. บันทึก deployment ID, commit SHA, เวลา และผลลง delivery

## 6. Rollback

- แอปมีปัญหา: Vercel → Deployments → Promote/rollback ไปเวอร์ชันก่อน
- ห้าม drop column/table เพื่อ rollback ฉุกเฉิน; migration ถัดไปต้อง compatible กับแอปเวอร์ชันก่อนหน้า
- ผู้ใช้ยัง Export `.learning-suit` จาก local draft ได้แม้ cloud ใช้งานไม่ได้

## 7. Logging

ใช้ Vercel/Supabase logs ที่มีอยู่ ไม่เพิ่ม monitoring vendor ใน private v1 Log ต้องไม่มี drawing text, Git file content, password, token หรือ signed URL

## 8. ข้อจำกัดด้านความปลอดภัยที่ยอมรับไว้ (audit 2026-09-26)

แอปนี้มีเจ้าของบัญชีเดียว ข้อด้านล่างต้องมี session ที่ถูกต้องของเจ้าของเองก่อน จึงกระทบได้แค่ข้อมูลของเจ้าของ ไม่ข้ามบัญชี (RLS กันแล้ว) ถ้าจะเปิดให้หลายคนใช้ต้องแก้ก่อน:

- `authenticated` ยังมีสิทธิ์ UPDATE ตรงบน `projects` (trigger บังคับ revision/owner/tombstone แต่ **ไม่ตรวจรูปแบบ `document`** เหมือน `save_project`) — ถ้าจะปิด ให้ revoke UPDATE/INSERT แล้วเขียนผ่าน RPC อย่างเดียว พร้อมแก้ pgTAP
- ลบแถว `project_assets`/object ใน Storage ได้แม้โปรเจกต์ยังใช้รูปนั้นอยู่ (policy ตรวจแค่ owner)
- Cookie ของ session อ่านได้จาก JavaScript (รูปแบบของ `@supabase/ssr` ที่ browser client ต้องใช้) จึงสำคัญที่จะไม่มี XSS: แอปไม่ใช้ `dangerouslySetInnerHTML` และข้อความของผู้ใช้วาดบน canvas/ใส่เป็น text เท่านั้น; cookie เป็น `Secure` เมื่อเปิดผ่าน HTTPS และ response ทุกหน้ามี `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`
