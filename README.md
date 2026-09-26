# Learning Suit

เว็บกระดานวาดสำหรับสอนสด จัดงานเป็นโปรเจกต์และสไลด์ มีตัวจำลองบนกระดาน 4 แบบ: Git (เครื่อง A ↔ GitHub ↔ เครื่อง B, Merge, diff ของ commit), การเก็บข้อมูล (ฐานข้อมูล/Supabase), การ Deploy (Local, `.env.local`, Vercel) และ AI (ประวัติแชท/context, Chain of Thought, Memory, AI บนเว็บ vs Claude Code — จำลองล้วน ไม่เรียก AI จริง) พร้อมเลเซอร์พอยเตอร์ (K) สำหรับแชร์หน้าจอ เก็บ **Drawing info** (จุดเส้น รูปทรง ข้อความ properties ลำดับซ้อน และ Git state) เป็นข้อมูลหลัก และ Export เป็น PNG / PDF / `.learning-suit` ได้ สถานะงานและผลตรวจรับล่าสุดอยู่ที่ [docs/plan/06-delivery-and-acceptance.md](docs/plan/06-delivery-and-acceptance.md)

## ทดลองบนเครื่อง (โหมดพัฒนาในเครื่อง)

ใช้ Node.js 24 (ตาม `engines`) และ Corepack:

```sh
corepack pnpm install
corepack pnpm dev
```

เปิด `http://localhost:3000` เมื่อ **ไม่ได้ตั้ง** `NEXT_PUBLIC_SUPABASE_*` และรันด้วย `next dev` แอปใช้ local development adapter: identity fixture + IndexedDB ของ browser นี้เท่านั้น (ไม่ซิงก์ข้ามเครื่อง) Production build ที่ไม่มี Supabase config จะไม่เปิดให้เก็บบทเรียน และไม่มี fallback identity

## โหมด Cloud (Supabase)

ตั้งค่าตาม `.env.example` ด้วยค่าจาก Supabase project ของคุณ (publishable key เท่านั้น ห้ามใช้ secret/service-role key):

```sh
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
```

Migration, RLS, private bucket และ RPC อยู่ใน `supabase/migrations` ขั้นตอน preview/production อยู่ใน [runbook](docs/runbook/deployment.md)

### ระบบเข้าสู่ระบบ

- อีเมล + รหัสผ่านของ **บัญชีเจ้าของ** ที่สร้างใน Supabase Dashboard (Add user) **ไม่มีสมัครสมาชิกและไม่มีลืมรหัสผ่าน** และต้องปิด “Allow new users to sign up” ใน Supabase
- `/login` (เข้าสู่ระบบอยู่แล้วจะข้ามไปหน้าโปรเจกต์) และ `/change-password` (“เปลี่ยนรหัสผ่าน” จากหน้าโปรเจกต์: ใส่รหัสปัจจุบัน + รหัสใหม่ ≥ 12 ตัวอักษร) ถ้าลืมรหัส ผู้ดูแลตั้งใหม่ใน Supabase ตาม runbook
- Session อยู่ใน cookie (`@supabase/ssr`) `src/proxy.ts` ต่ออายุ session ทุก request หน้า protected ตรวจด้วย `getClaims()` บน server และข้อมูลทุกแถวถูกป้องกันด้วย RLS
- ออกจากระบบมีผลเฉพาะเบราว์เซอร์นี้ แท็บอื่นของหน้าโปรเจกต์ไปหน้า login เอง; ถ้า session หมดระหว่างแก้กระดาน จะมีกล่องให้เข้าสู่ระบบใหม่โดยไม่ปิดงาน

### ขึ้น Vercel (สรุป — รายละเอียดใน runbook)

1. Supabase: `supabase link` → `supabase db push`, ปิด sign up, สร้างบัญชีเจ้าของ, ตั้ง Site URL = โดเมน production
2. Vercel: Import repository → ตั้ง `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (Preview/Production แยกกัน) **ก่อน** build ครั้งแรก → Deploy
3. Smoke: login → สร้างโปรเจกต์ → วาด → เปิดจากอีกเครื่อง → เปลี่ยนรหัสผ่าน

## คำสั่งตรวจ

```sh
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test:unit          # Vitest: domain, Git reducer, geometry, archive, save coordinator, adapters
corepack pnpm test:db:local      # pgTAP บน PostgreSQL 16 + Supabase shim (ไม่ต้องมี Docker)
corepack pnpm test:db            # supabase test db (ต้องมี Docker + Supabase CLI)
corepack pnpm test:integration   # REST/RPC/Storage กับ local Supabase (ต้องมี supabase start)
corepack pnpm build
corepack pnpm test:e2e           # Playwright: chromium (Google Chrome ในเครื่อง) + webkit
corepack pnpm exec playwright test --config playwright.perf.config.ts   # benchmark PERF-01..03
```

Playwright เปิด dev server ที่พอร์ต 3100 เอง หากมี `next dev` ของโปรเจกต์นี้รันอยู่แล้ว ให้ตั้ง `PLAYWRIGHT_BASE_URL=http://localhost:3000` เพื่อใช้ server เดิม WebKit ต้องติดตั้งครั้งแรกด้วย `corepack pnpm exec playwright install webkit`

## โครงสร้างหลัก

| ส่วน | ที่อยู่ |
|---|---|
| Domain (pure TS) | `src/domain/document`, `src/domain/git` |
| Canvas / editor / Git widget + panel | `src/features/canvas`, `src/features/editor`, `src/features/git-simulator` |
| ตัวจำลองการเก็บข้อมูล, Deploy และ AI | `src/domain/{data,deploy,ai}`, `src/features/flow`, `src/features/{data,deploy,ai}-simulator` |
| เข้าสู่ระบบ | `src/features/auth`, `src/app/{login,change-password}`, `src/lib/supabase`, `src/proxy.ts` |
| Local drafts, save coordinator, Supabase adapters | `src/services/persistence` |
| Export PNG/PDF, archive worker | `src/services/export` |
| SQL + pgTAP | `supabase/` และ `tests/db-shim` |
| Tests | `src/**/*.test.ts`, `tests/e2e`, `tests/integration`, `tests/perf` |
