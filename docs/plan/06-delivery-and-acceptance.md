# 06 — Delivery, acceptance และคำสั่งส่งต่องาน

เอกสารนี้เป็นแหล่งสถานะและรายการงานเพียงแห่งเดียว ADR เก็บการตัดสินใจ ส่วนแผน 01–05 เก็บสเปก ห้ามคัดลอกสถานะ task ไปกระจายหลายไฟล์

## สถานะและลำดับงาน

- ผลส่งมอบรอบปัจจุบัน (2026-09-25): **M1–M3, M5.1–M5.2, M6.1–M6.3 DONE**; ชั้น cloud (M4) เขียนครบพร้อม migration/RLS/RPC/adapters/save coordinator และตรวจด้วย pgTAP บน PostgreSQL shim แล้ว แต่ **ยังไม่ได้รันกับ Supabase จริง** (เครื่องนี้ไม่มี Docker/Supabase CLI) จึงเป็น BLOCKED เฉพาะหลักฐานส่วนนั้น; M7 รอ manual checks บน Mac จริงและ credentials ของ preview/production
- งานถัดไป: ติดตั้ง Docker + Supabase CLI แล้วรัน `supabase start`, `supabase test db`, `pnpm test:integration` (ปิด M4.1–M4.6, M5.3, M6.4 ส่วน cloud publish, M7.1) → ทำ MAN-01..04 บน Mac จริง (M7.2) → ทำตาม [runbook](../runbook/deployment.md) (M7.3–M7.4)
- สถานะใช้ `TODO / IN_PROGRESS / DONE / BLOCKED` โดย BLOCKED ต้องระบุสิ่งที่ขาดและงานอื่นที่ยังทำต่อได้
- `DONE` ต้องมีหลักฐานผลตรวจรับ ไม่ใช่แค่สร้างไฟล์แล้ว; milestone ที่มี manual check ค้างต้องแสดงตามจริง

### M0 — เอกสารและการส่งต่อ

| ID | งาน | Dependency | เกณฑ์ตรวจรับ | Status |
|---|---|---|---|---|
| M0.1 | README, ADR 6 ฉบับ และแผน 6 ฉบับ | — | ครบ 13 ไฟล์, relative links/code fences/JSON examples ถูกต้อง | DONE |
| M0.2 | ตรวจ contracts และกรณี failure ข้ามเอกสาร | M0.1 | Drawing info, lock, Git, revision, initial uploads และ export ไม่ขัดกัน | DONE |

### M1 — ฐานแอปและ domain

| ID | งาน | Dependency | เกณฑ์ตรวจรับ | Status |
|---|---|---|---|---|
| M1.1 | Scaffold Next/React/TS, pnpm scripts, Tailwind/Radix/Lucide และ lockfile | M0.2 | dev/build/typecheck/lint รันได้; editor client boundary ไม่พัง SSR | DONE |
| M1.2 | Versioned schemas, defaults/limits, fixtures และ migration registry v1 | M1.1 | DOM-01..03; ไม่ serialize renderer tree | DONE |
| M1.3 | Pure commands, transaction batching และ Immer history | M1.2 | DOM-04..06; history100 รายการและ no-op ไม่เพิ่ม | DONE |
| M1.4 | Local repository, drafts/assets/sessions stores และ single-writer lock | M1.2 | PST-01,02,10; adapter ไม่ต้องมี Supabase credentials | DONE |
| M1.5 | Dashboard + project/slide CRUD, local navigation และ shell | M1.3,M1.4 | UX-01,02; refresh แล้วคืน draft ได้ | DONE |

### M2 — เครื่องมือ Canvas

| ID | งาน | Dependency | เกณฑ์ตรวจรับ | Status |
|---|---|---|---|---|
| M2.1 | Stage sizing, camera transforms และ shared bounds | M1.2,M1.5 | CAN-01,02; ResizeObserver/Retina/negative coords | DONE |
| M2.2 | Pen/highlighter/rectangle/ellipse/line/arrow | M2.1,M1.3 | CAN-03,04; transient gesture จบหนึ่ง transaction | DONE |
| M2.3 | Hit testing, selection/marquee, Objects และ lock | M2.2 | CAN-05,06 | DONE |
| M2.4 | Move, clone, clipboard และ z-order | M2.3 | CAN-07,08; copy ข้าม slide และ clonecancel | DONE (แทร็กแพดจริงอยู่ MAN-01/M7.2) |
| M2.5 | Transform rules, property editors และ shortcuts | M2.4 | CAN-09..11; ไม่มี skew ที่ model เก็บไม่ได้ | DONE |
| M2.6 | Integration ของ undo/redo, pointer cancellation และ autosave boundary | M2.5,M1.4 | CAN-12; ไม่มี pointer move เข้า cloudqueue | DONE |

### M3 — สื่อประกอบและการสอน

| ID | งาน | Dependency | เกณฑ์ตรวจรับ | Status |
|---|---|---|---|---|
| M3.1 | Self-host Thai font, text overlay, IME และ pending-edit recovery | M2.6 | TXT-01..03, PST-03 | DONE (IME จริงอยู่ MAN-02/M7.2) |
| M3.2 | Image ingest/decode/local blobs และ resize | M3.1 | IMG-01..03; upload ยังไม่จำเป็น | DONE |
| M3.3 | Local thumbnails, teaching mode, responsive panels และ keyboard accessibility | M3.2 | UX-03..05 | DONE (screen reader แบบ manual ของ UX-04 ยังค้าง) |

### M4 — Supabase และ cloud saving

| ID | งาน | Dependency | เกณฑ์ตรวจรับ | Status |
|---|---|---|---|---|
| M4.1 | Local Supabase setup, DDL, grants, RLS, private bucket และ database tests | M1.2 | SEC-01..05 ผ่านด้วย A/B/anon ไม่ใช้ service_role แทน user | BLOCKED — migration + pgTAP ผ่าน 181/181 บน PostgreSQL 16 shim; ขาด Docker/Supabase CLI สำหรับ `supabase test db` และ REST/Storage จริง |
| M4.2 | SSR Auth, closed signup และ owner login flow | M4.1,M1.5 | SEC-06, PST-08; ไม่ redirect ทิ้ง draft | BLOCKED — `/login`, proxy, getClaims guard, login dialog ใน editor และ identity guard เขียนแล้ว; build inspection ผ่าน; PST-08 ต้องมี Supabase Auth จริง |
| M4.3 | Reservation, asset register/upload/retry และ ready validation | M4.1,M3.2 | PST-04,05; ไม่มี ready project อ้าง missing asset | BLOCKED — coordinator/adapter unit tests ผ่าน; ต้องรัน integration กับ local Supabase |
| M4.4 | Atomic save/delete RPC, CAS และ mutation idempotency | M4.1,M4.3 | PST-06,07,09 | BLOCKED — RPC + concurrency ผ่านบน shim (PST-07/09), PST-06 ผ่าน Vitest; ขาด REST/RPC จริง |
| M4.5 | Save coordinator, UI status, reopen reconciliation และ conflict copy | M4.2,M4.4,M1.4 | PST-01..11 รวม failure injection | BLOCKED — logic ผ่าน 82 unit tests + UI wiring; ยังไม่เคยรัน cloud mode ใน browser |
| M4.6 | Project duplication, tombstone/cleanup และ resuming deletion | M4.5 | PST-12; ไม่มี owner/path ข้าม project | BLOCKED — deletion state machine ผ่าน unit tests; ต้องรันกับ Storage จริง |

### M5 — ตัวจำลอง Git

| ID | งาน | Dependency | เกณฑ์ตรวจรับ | Status |
|---|---|---|---|---|
| M5.1 | ใช้ Git types/validators จาก M1.2 เพิ่ม initial fixture และ pure reducer | M1.2 | GIT-01..06 ตามรายละเอียดใน plan04 | DONE |
| M5.2 | Canvas widget, known-local histories, commit preview และ controls | M5.1,M3.1 | GIT-07; controls ใช้ projected draft และ lock ถูกต้อง | DONE |
| M5.3 | Document/history/save integration และบทเรียนสองเครื่อง | M5.2,M4.5 | GIT-01,GIT-07 รวม reload และ clone isolation | BLOCKED — local reload/Undo/clone isolation/archive ผ่าน e2e; ส่วน cloud save รอ M4.5 |

M5.1 ทำขนานกับ M2–M4 ได้เพราะ pure domain ไม่มี network/renderer dependency; M5.2 ต่อเมื่อ text draft contracts พร้อม และ M5.3 รอ cloud integration จริง

M1–M3 ใช้ repository/identity fixtures ที่ inject ผ่าน test harness และ development adapter เพื่อทำ local UI ได้ก่อน M4 ห้ามมี fallback identity ของเจ้าของหรือข้าม auth เมื่อ production config ขาด ให้ปิด development adapter และตรวจ guard นี้ใน M4.2 ก่อน deploy

### M6 — Export และ archive

| ID | งาน | Dependency | เกณฑ์ตรวจรับ | Status |
|---|---|---|---|---|
| M6.1 | Shared offscreen renderer, asset/font readiness และ PNG options | M3.2,M5.2 | EXP-01..04 | DONE |
| M6.2 | Raster PDF ทุกสไลด์พร้อม progress/cancel | M6.1 | EXP-05,06 | DONE |
| M6.3 | Archive export worker, portable wire schema และ limits | M6.1,M1.2 | ARC-01,02 | DONE |
| M6.4 | Strict import validation, remapping, local commit และ cloud publish | M6.3,M4.5 | ARC-03..06 | BLOCKED — import/remap/local commit ผ่าน (ARC-03..06); cloud publish หลัง import รอ M4.5 |

### M7 — ตรวจรับและเตรียมใช้งานจริง

| ID | งาน | Dependency | เกณฑ์ตรวจรับ | Status |
|---|---|---|---|---|
| M7.1 | Full integration flows + production build | M4.6,M5.3,M6.4 | Required automated checks ผ่าน | BLOCKED — lint/typecheck/unit/build/e2e (chromium+webkit)/db shim ผ่าน; `supabase test db` และ `test:integration` ยังรันไม่ได้ |
| M7.2 | Mac trackpad/IME และ performance benchmark | M7.1 | MAN-01..04, PERF-01..03 มีผลและเครื่องอ้างอิงจริง | IN_PROGRESS — PERF automated benchmark มีผลแล้ว (ดูบันทึก); MAN-01..04 Pending (ต้องใช้คนบน Mac จริง) |
| M7.3 | Preview env/migrations/auth redirects และ smoke | M7.1 | DEP-01..03 | BLOCKED — ขาด Supabase preview project + Vercel; ขั้นตอนอยู่ใน runbook |
| M7.4 | Production configuration/rollout runbook และ smoke | M7.2,M7.3 | DEP-04; ไม่มี known data-loss/security blocker | BLOCKED — runbook เขียนแล้ว; ขาด credentials production |

### M8 — ตัวจำลองการไหล (การเก็บข้อมูล และ Deploy)

สเปกอยู่ใน [plan 07](07-data-and-deploy-flows.md) ผู้สอนยืนยันขอบเขตแล้ว 2026-09-25 (สอนหลักการ ไม่สอนโค้ด เน้นเห็นการไหล ธีมร้านกาแฟ ผู้ใช้ 2 คน ภาพรวมอยู่ในตัวจำลอง Deploy)

| ID | งาน | ขึ้นกับ | เกณฑ์ | สถานะ |
|---|---|---|---|---|
| M8.1 | Flow engine ร่วม (จังหวะ/ก้อนข้อมูล/ท่อ/ด่าน/คำบรรยาย/เล่นต่อเนื่อง-ทีละจังหวะ) + node `data-simulator` (schema, bounds, transform, export, panels) + การเก็บข้อมูล ขั้น 1–2 | M5.2 | DATA-01, DATA-02 | DONE |
| M8.2 | การเก็บข้อมูล ขั้น 3–4 + ป้าย Supabase | M8.1 | DATA-03, DATA-04 | DONE |
| M8.3 | ตัวจำลอง Deploy ขั้น 1–2 (Local, Vercel) | M8.1 | DEPLOY-01, DEPLOY-02 | DONE |
| M8.4 | Deploy ขั้น 3–4 (Env, ภาพรวมทั้งระบบ) | M8.3,M8.2 | DEPLOY-03, DEPLOY-04 | DONE |
| M8.5 | ตัวจำลอง AI 5 ขั้น (ประวัติแชท/context, Chain of Thought, Memory บนเว็บ, เว็บ vs Claude Code, ความจำ Claude Code) จำลองล้วน | M8.1 | AI-01, AI-02 | DONE |

### ผลตรวจ implementation ล่าสุด — 2026-09-25 (รอบ 2)

- เวอร์ชันจริง: Node 24.1.0, pnpm 10.34.5 (pin ใน `packageManager`), Next 16.3.6 (`--webpack`; ใช้ `src/proxy.ts` ตาม Next 16), React/react-konva 19.3.0, Konva 10.7.0, Zod 4.6.5, Zustand 5.0.15, Immer 10.2.0, idb 8, pdf-lib 1.17.1, fflate 0.8.3, @supabase/supabase-js 2.117.1, @supabase/ssr 0.12.7, @fontsource/noto-sans-thai 5.3.0 (self-host), Playwright Chrome 153 + WebKit 26.6, PostgreSQL 16.14 + pgTAP 1.3.3 สำหรับ shim
- เครื่องอ้างอิง: MacBook Pro Apple M1 Pro, RAM 16 GiB, macOS 26.6.2
- **ผ่าน**: `pnpm lint`, `pnpm typecheck`, `pnpm test:unit` (20 files / 332 tests: domain/schema/fixtures, Git reducer GIT-01..06, transform/simplify/hit-test, image rules, export bounds, archive ARC-01..05, save coordinator/reconcile/deletion, Supabase adapters, safeNext), `pnpm build` (production; client bundle ไม่มี secret key — พบเฉพาะโค้ดตรวจ prefix), `pnpm test:e2e` **72/72** (36 flows × Chromium + WebKit), `pnpm test:db:local` 181/181 pgTAP + 4/4 concurrency (PostgreSQL shim)
- **ยังรันไม่ได้**: `supabase test db`, `pnpm test:integration` (ต้องมี Docker + Supabase CLI; ชุด integration 19 tests พร้อมและ fail ชัดเจนพร้อมคำแนะนำเมื่อไม่มี env), preview/production deployment, MAN-01..04
- Local adapter ทำงานเฉพาะ `next dev` ที่ไม่มี Supabase env (identity fixture); production build ไม่มี fallback identity; เมื่อมี env ใช้ Supabase Auth + cloud project service พร้อม identity guard ทุก cloud call
- Independent audit 3 ชุด (editor/canvas, persistence/security, export/Git) พบและแก้แล้ว: session ของอีกบัญชีในแท็บอื่นอาจทำให้ autosave publish งานเข้าบัญชีผิด (เพิ่ม owner guard ทุก request), open redirect ใน `next`, Git draft หายเมื่อเปลี่ยน selection/tab, ตัวเลขใน Properties ไปลงวัตถุถัดไป, ลบสไลด์แล้วไปสไลด์แรก, Cmd+S ใน input เปิด Save Page, คีย์ลูกศร/Space ของ canvas แย่งจากปุ่ม/dialog, shortcuts กับ Thai layout, image cache ถูก dispose ใน StrictMode (รูปไม่แสดง/Export ค้าง), bounds ของ stroke ที่หมุน, PNG ว่างเมื่อ allocate ไม่ได้, asset ready→pending, deletion ใช้ revision ที่ผู้ใช้ไม่ได้ยืนยัน, header-dimension guard ก่อน decode ภาพ
- PERF (อัตโนมัติ, `playwright.perf.config.ts`, dev build, headless Chrome 153, DPR 2, fixture PERF-01 20 slides / 2,000 nodes / 100,000 path points): pan p95 16.7 ms ไม่มี long task >200 ms; วาดเส้นระหว่างเนื้อหาหนัก p95 16.8 ms; local draft write p95 220 ms (แก้วัตถุเดียว) และ 96 ms (select-all 2,000 nodes); ไม่มี HTTP write ระหว่าง pan; render เฉพาะสไลด์ที่เปิด. ข้อจำกัด: transaction ที่แก้ทั้ง 2,000 nodes ใช้ ~0.5 s เพราะ validate path points ทุกจุดของ nodes ที่เปลี่ยน; thumbnail ของสไลด์ >1,500 nodes ใช้ placeholder เพื่อไม่ block main thread. ยังไม่ใช่ผล manual บน browser ปกติ/แทร็กแพด (PERF-02 ต้องวัดซ้ำด้วยคนใน M7.2)

## Acceptance matrix

ทุก test เริ่มจาก deterministic fixtures หลีกเลี่ยง assert implementation details เช่นจำนวน React renders หากไม่ได้ผูกกับผลที่ผู้ใช้เห็น

### Domain, UX และ Canvas

| IDs | กรณีและผลที่ต้องได้ | วิธีตรวจ |
|---|---|---|
| DOM-01 | JSONfixtureplan02 valid; unknown version/type ไม่ถูก strip แล้วเปิดต่อ | Vitest |
| DOM-02 | Duplicate IDs, invalid finite geometry, missing asset, malformed Git graph ถูกปฏิเสธก่อน mutation | Vitest |
| DOM-03 | Serialize/deserialize รักษาวัตถุ ลำดับ และ Git state ไม่รวม camera/session/token | Vitest |
| DOM-04 | Batch หนึ่ง command invalid ทำให้ทั้ง transaction ไม่เปลี่ยน | Vitest |
| DOM-05 | Undo/Redo ครบ 100 รายการ, no-op ไม่เพิ่ม, newedit หลัง Undo ตัด redotail | Vitest |
| DOM-06 | Clones deep-copy Git state; slide/project remap references ถูกต้อง | Vitest |
| UX-01 | Create/rename/duplicate/open project local และ cloud ไม่สูญหาย | Playwright |
| UX-02 | Slidesadd/reorder/duplicate/delete/undo; ลบใบสุดท้ายไม่ได้ | Playwright |
| UX-03 | Teaching mode ยังวาด/เปิด Gitcontrols/เปลี่ยน slide ได้และไม่แก้ camera โดยไม่จำเป็น | Playwright |
| UX-04 | Tooltips/names/tabfocus/dialogfocus/disabled reason เข้าถึงได้ | Playwright + manual |
| UX-05 | Left panel พับเหลือพื้นที่ Canvas, ปรับความกว้างด้วย pointer/keyboard และจำค่า; width1024px ใช้ collapsed panels ได้; narrow viewport แสดงคำแนะนำ | Playwright |
| CAN-01 | world↔screen round trip, zoom ใต้ pointer, resize viewport รักษาจุดกลาง | Vitest + Playwright |
| CAN-02 | Fitcontent รวม locked และ negative coords; emptyfit ไม่หารศูนย์ | Vitest + Playwright |
| CAN-03 | วาด rect/ellipse/line/arrow แบบคลิกจุดแรก → preview → คลิกจุดที่สองทุกทิศ, Escape ยกเลิก, Shift constraint, arrowstart/end และ head ถูกต้อง | Playwright |
| CAN-04 | Penpoint/longstroke/highlighter ครบ ยางลบลบทั้ง stroke และ Undo คืนได้ | Playwright |
| CAN-05 | topmosthit, Shift selection, marquee intersection, clear selection และเลือก/highlight จาก Objects panel | Playwright |
| CAN-06 | locked node pointer ทะลุ, Cmd+A ไม่เลือก, panelunlock คืนการเลือกได้ | Playwright |
| CAN-07 | Optiondrag ก่อน threshold ไม่ clone; เกินแล้วต้นฉบับยังเห็นและ clone ครั้งเดียวเมื่อปล่อยเมาส์; releaseOption ไม่ clone ซ้ำ; Escape คืนต้นฉบับ | Playwright + MAN-01 |
| CAN-08 | Multi-copy/paste ข้าม slide, z-orderstable, copyassets ข้าม project ไม่อ้าง path ต้นฉบับ | Playwright |
| CAN-09 | single/multi transforms ของแต่ละ type ตามตาราง spec03, จุดจับขนาดคงที่หลัง zoom, Shift รักษาสัดส่วน และไม่มี negative geometry | Vitest + Playwright |
| CAN-10 | Mixed properties แก้เฉพาะ field ที่เลือก, เปลี่ยน property แล้ว selection คงอยู่, checkbox ปิด fill เป็น transparent, slider หนึ่ง interaction เป็นหนึ่ง Undo | Playwright |
| CAN-11 | Keyboard focus ไม่แย่ง textarea/dialog, nudge coalesced, Save ระหว่าง drag รอ pointerup | Playwright |
| CAN-12 | pointercancel/blur ยกเลิก preview; multi-drag/clone/erase อย่างละหนึ่ง Undo | Playwright |
| TXT-01 | ไทย/emoji/newlines ตรงทั้ง Canvas และ export ฟอนต์เดียวกัน | Browser visual + MAN-02 |
| TXT-02 | Nativeundo/IME/Cmd+Enter/Escape และ text width reflow ไม่ทำตัวอักษรหาย | Playwright + MAN-02 |
| TXT-03 | Refresh ระหว่าง draft คืน editor และ content เดิม; invalid draft ไม่ทำ action ต่อ | Playwright |
| IMG-01 | picker/drop/paste ได้ aspect และ position ถูกต้อง | Playwright |
| IMG-02 | wrong MIME/oversize/decodefail ถูกปฏิเสธก่อน document insert | Vitest + Playwright |
| IMG-03 | Undo/Redo ภาพไม่เสีย blob reference, duplicate project มี paths ใหม่ | Integration |

### Persistence และ security

| IDs | กรณีและผลที่ต้องได้ | วิธีตรวจ |
|---|---|---|
| PST-01 | Refresh หลัง local write คืนงานเดียวกัน ก่อน cloudsave เสร็จ | Playwright |
| PST-02 | IDBquota/writefail แสดง localerror ไม่แสดงเก็บในเครื่องสำเร็จ; export memory ได้ | Integration injection |
| PST-03 | Pendingtextdraft500msrecovery; cloud รอ flush ไม่โชว์ saved เท็จ | Playwright fakeclock |
| PST-04 | New project with images: reserve→metadata→upload→save; อีกเครื่องไม่เห็น blank reservation | Local Supabase integration |
| PST-05 | Fail แต่ละขั้น assetupload/ack/hashcheck แล้ว retry สำเร็จ ไม่ save พร้อม missing image | Integration injection |
| PST-06 | วาดต่อระหว่าง save 1; acksave1 ไม่ทับ content 2 หรือแสดง saved ของ content 2 | Vitest state-machine + Playwright |
| PST-07 | Server commit แล้ว response หาย; retryjob เดิม revision ไม่เพิ่มซ้ำ; ถ้าคนอื่น save ต่อให้ conflict | Local Supabase integration |
| PST-08 | Auth หมดอายุรักษา draft; login เจ้าของเดิม resume; คนใหม่ไม่รับ draft/queue คนเก่า | Playwright |
| PST-09 | Two-device expected revision ชนกันสำเร็จหนึ่งตัว อีกตัว conflict ไม่มี silent overwrite | Parallel RPC integration |
| PST-10 | Two-tabs มี writer หนึ่งตัว; tab2read-only ปิด tab1 แล้ว tab2 ขอ lock ได้ | Playwright multi-page |
| PST-11 | Reopen มี pendingjob/dirtydraft/cloud newer/schema unknown/networkfail แต่ละกรณีเลือกตาม protocol | Integration |
| PST-12 | Delete project ผ่าน tombstone, cleanup interrupt/resume; concurrent save ถูกปฏิเสธและไม่ฟื้น project เดิม | Integration |
| SEC-01 | OwnerACRUD ได้; B/anon ไม่อ่าน/แก้/ลบ A ผ่าน REST | pgTAP + REST integration |
| SEC-02 | INSERT ปลอม owner, UPDATEowner, asset เปลี่ยน project/path ถูกปฏิเสธ | pgTAP + REST integration |
| SEC-03 | Private bucket: A ดาวน์โหลดได้ B/anon ไม่ได้; publicURL ไม่เปิดภาพ | Storage integration |
| SEC-04 | Save RPC/Reserve/Delete RPC เคารพ ownership/grants, ไม่บอกว่ามี project ของ B อยู่ | pgTAP + RPC integration |
| SEC-05 | Document asset refs ข้าม project, deleted project save, fake-readyasset ไม่มี object ไม่ผ่าน | RPC integration |
| SEC-06 | Protected routes ตรวจ identity และ RLS ยังป้องกันแม้ข้าม UI; client bundle ไม่มี secretkey | Playwright + build inspection |

ใช้ user fixtures A/B สำหรับสิทธิ์แม้ production เปิดให้ owner คนเดียว การสร้าง fixture บัญชีผ่าน local test admin ไม่ใช่รูปแบบ runtime ของแอป

### Git และ exports

| IDs | กรณีและผลที่ต้องได้ | วิธีตรวจ |
|---|---|---|
| GIT-01 | บทเรียน A→GitHub→B→GitHub→A; IDs/snapshots ตรงทุกฝั่งที่รับแล้ว | Vitest + Playwright |
| GIT-02 | StageV1 แล้ว workingV2; Commit เก็บ V1 แต่ working ยัง V2 | Vitest |
| GIT-03 | Rejected push ไม่เปลี่ยน remote; diverged pull เก็บ fetch/tracking แต่ไม่ทับ working/head | Vitest + history |
| GIT-04 | Dirty pull reject ก่อน fetch และบอกข้อจำกัด simulation | Vitest |
| GIT-05 | Pull ขณะ local ahead ไม่เลื่อน local ถอยหลัง | Vitest |
| GIT-06 | Invalid input/no-op/limit200/determinism/input immutability | Vitest |
| GIT-07 | UI projected draft, lock, Undo/Redo, reload, archive/export, isolated clone | Playwright + integration |
| EXP-01 | bounds รวม rotated shape/stroke/arrow/negative/offscreen/locked อย่างครบ | Vitest + visual |
| EXP-02 | Pan/zoom ต่างกันได้ export ขนาด/ภาพเหมือนเดิม ไม่มี handles/grid/UI | Browser visual |
| EXP-03 | Emptycanvas1280×720, selected-only empty disabled, padding48 ไม่บวกซ้ำ | Vitest + browser |
| EXP-04 | Font/imagewait; missing asset fail ชัด; resolution cap ลดสัดส่วนไม่ crop/ไม่ download blank | Browser integration |
| EXP-05 | PDF จำนวนหน้า/order/background/หน้าตาม bounds ตรง รวม emptyslide | PDF parse + visual |
| EXP-06 | Export progress/cancel cleanup ไม่แก้ document/current camera และไม่ล็อก editor ถาวร | Playwright |
| ARC-01 | ZIP มีเฉพาะ manifest/document/referenced assets; ไม่มี owner/path/token/session | Vitest |
| ARC-02 | Offline archive ใช้ localbytes ได้; หาก asset ขาดให้ error ไม่สร้างไฟล์ไม่ครบ | Integration |
| ARC-03 | Round trip หลัง normalize IDs แล้ว document/Git/lock/z-order/assetsha256 ตรง | Vitest + integration |
| ARC-04 | Unknown version, corruptJSON, missing file, wrong hash/MIME/dimensions ถูกปฏิเสธ | Vitest |
| ARC-05 | Path traversal/duplicate entries/bomb/unsupported compression ถูกหยุดตาม actual bytes limits | Worker integration |
| ARC-06 | Import failure/quota ไม่เปลี่ยน project ปัจจุบัน; success สร้าง project/path ใหม่ | Playwright |

GIT fixture และลำดับ assert โดยละเอียดให้ใช้ [plan04](04-git-simulator.md) ไม่สร้าง spec แข่งกันใน test ไฟล์

## Required checks และวิธีเก็บหลักฐาน

ตั้ง scripts ใน M1 เพื่อให้คำสั่งต่อไปนี้เป็นสัญญาที่ทุก milestone ใช้ได้:

```sh
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm build
pnpm test:e2e
supabase test db
pnpm test:integration
```

`test:integration` ใช้ local Supabase และ fixture users สำหรับ REST/RPC/Storage ส่วน`test:e2e` ใช้ Playwright projects `chromium` และ`webkit` แยก browser focus/clipboard จริงออกจาก puretests รันชุดที่เกี่ยวข้องก่อน เมื่อผ่านแล้วไม่รันซ้ำทั้งชุดโดยไม่มีการเปลี่ยนที่เกี่ยวข้อง

สำหรับงานเอกสาร M0 ใช้ตรวจไฟล์/relative links/Markdown fences/JSON fixtures/สัญญาข้ามเอกสาร ไม่มีเหตุผลต้องติดตั้งแพ็กเกจหรือสร้าง app เพื่อทดสอบเอกสาร

Visualtests เก็บ small fixtures เฉพาะเสี่ยง crop/text/arrow/Gitlayout ใช้ consistent fonts/deviceScaleFactor หลีกเลี่ยง snapshot ทุก pixel ของทั้งแอปซึ่งไม่ช่วยตรวจ semantic ของ Git หรือ RLS

### Manual และ performance

| ID | วิธีตรวจ |
|---|---|
| MAN-01 | Mac จริง: Option+drag, pinch, two-fingerpan, Cmd+wheel, Spacepan และ browserzoom ไม่ชนกัน |
| MAN-02 | Keyboard ไทย+IME จริง: composition, newlines, undo และ exportThai; browser automation อย่างเดียวไม่แทนผลนี้ |
| MAN-03 | สอนตัวอย่าง 10 นาที: วาด 3slides, Lock/Clone, Git สองเครื่อง และ Save/Export โดยไม่ออกไปใช้โปรแกรมอื่น |
| MAN-04 | ตรวจความอ่านง่ายของ PDF/PNG ทั้ง 100%และ zoom รวม highlighter พื้นหลังสี |
| PERF-01 | Fixture20slides: active หนึ่ง slide มี 2,000nodes รวม 100,000pathpoints, อีก 19slides ใบละ≤10nodes เพื่ออยู่ใน project limits |
| PERF-02 | บน Mac อ้างอิงบันทึกรุ่น CPU/RAM/browser/DPR; หลัง warmup pan/draw ต่อเนื่อง 5 วินาที เป้าหมาย p95frame≤32ms และไม่มี UIfreeze>200ms จาก pointer processing |
| PERF-03 | เป้าหมาย localdraftwritep95≤300ms ของ fixture, ไม่มี HTTPwrite ต่อ pointer move/camera และ inactive canvas ไม่ render ทุก slide |

ถ้า performance ไม่ถึงเป้าหมายให้บันทึก trace และแก้สาเหตุที่พบก่อนเพิ่ม architecture ใหม่ ห้ามรับรองลื่นทุกเครื่องจากผลเครื่องเดียว หาก manualcheck ยังไม่มีเครื่องให้ระบุ Pending และยังไม่ปิด M7.2

## Environment และ rollout

### ตัวแปรและสิ่งที่ต้องตั้งค่า

| ค่า | ฝั่ง | การใช้ |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | browser/server | URL ของ environment นั้น |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | browser/server | public client key; แยก preview/production |
| Supabase CLI project ref/access token | เครื่อง deploy/CI secrets | migrate/test เท่านั้น ไม่อยู่ใน appbundle |
| Owneremail/password | Supabase Auth | ตั้งใน Dashboard ไม่ใส่ fixtures production หรือ README |

Runtime baseline ไม่ต้องใช้ service_role/secretkey มี`.env.example`เป็นชื่อ placeholder เท่านั้น ใช้ local Supabase ก่อนระหว่างยังไม่มี credentials ของ cloud Preview ใช้ Supabase project แยกและไม่มีสำเนาข้อมูลจริงของผู้ใช้

### Deployment acceptance

- **DEP-01:** Clean checkout→pnpm install frozen lock→checks→build สำเร็จ ข้อมูล version จริงอยู่ใน handoff record
- **DEP-02:** Apply migrations เข้า preview, เปิด RLS/private bucket, ปิด signup และสร้าง owner, ตั้ง authorigins, direct API isolation tests ผ่าน
- **DEP-03:** Preview สร้าง project แนบภาพ→save→เปิดอีก browser→export/import สำเร็จ และ client bundle ไม่มี secret
- **DEP-04:** Production ใช้ config/migration ชุดเดียวที่ผ่าน preview ทดสอบ ownerlogin/save/reopen/export ด้วยบทเรียนทดสอบ และบันทึก deployment identifier/เวลา

ตั้งค่า Vercel Git deployment ผ่าน repository ของผู้ใช้เมื่อถึง M7 ไม่สร้าง account หรือใช้ credentials คาดเดา Migration ต้องรันก่อน deploy แอปที่อ้าง schema ใหม่ หาก release ล้มเหลวให้ rollback Vercel ไปเวอร์ชันก่อนและคง DBschema ที่ยัง compatible ไม่ dropcolumn/table เพื่อแก้ rollback ฉุกเฉิน

Logger เก็บเฉพาะ operation, resultcode, correlation/mutationID, duration และขนาดข้อมูล ไม่เก็บ drawingtext, Git file content, password/token/signedURL Stack trace ต้อง redact credentials ก่อนออก console/CI

สำหรับ privatev1 ยังไม่เพิ่ม monitoring vendor; ใช้ Vercel/Supabase logs และ persistent error UI เมื่อพบบันทึกไม่สำเร็จซ้ำสามารถ export archive ได้เสมอถ้า bytes อยู่ในเครื่อง

## คำสั่งงานสำหรับ Sol

> อ่าน docs/README.md และเอกสารที่ลิงก์ไว้ แล้วเริ่มจาก task แรกที่ยังไม่ DONE ใน docs/plan/06-delivery-and-acceptance.md พัฒนาตาม contracts และ acceptance IDs ที่กำหนด เก็บ Drawing info เป็นข้อมูลหลัก ใช้ migration/tests ตามสเปก อัปเดตสถานะและผลตรวจจริงหลังแต่ละ milestone อย่าเปลี่ยน stack หรือ Git semantics โดยไม่ปรับ ADR ที่เกี่ยวข้อง หาก cloud credentials ยังไม่พร้อมให้ทำ local adapters, local Supabase และ tests ต่อ พร้อมบันทึกเฉพาะ deployment task ที่ยังทำไม่ได้

ไม่ต้องถามซ้ำเรื่อง default ที่ล็อกไว้แล้วในแผน หากพบช่องว่างระดับ implementation ที่ไม่เปลี่ยน public behavior ให้แก้ตามรูปแบบของโมดูลและบันทึกเหตุผลเมื่อจำเป็น ถ้าเป็นการเปลี่ยนขอบเขต/ข้อมูลถาวร/สิทธิ์ผู้ใช้ ให้ปรับ ADR+contracts+tests ให้สอดคล้องก่อนนำไปใช้

## บันทึกการตรวจรับและส่งมอบ

| วันที่ | Milestone | สิ่งที่ตรวจ | ผล/ข้อจำกัด |
|---|---|---|---|
| 2026-09-24 | M0.1 | Python audit ของ Markdown 13 ไฟล์: ลิงก์ภายใน 84 จุด, ตาราง 38 ชุด, JSON 3 ตัวอย่าง, code fences และ required ADR sections | ผ่าน ไม่พบไฟล์/anchor หาย, JSON ผิด หรือ unresolved spec marker |
| 2026-09-24 | M0.1 | รวม TypeScript contracts 6 blocks แล้วรัน `node --experimental-strip-types --check /tmp/learning-suit-doc-types.ts` ด้วย Node 24.1.0 | syntax ผ่าน; เป็น syntax check ของตัวอย่าง ไม่ใช่ TypeScript semantic typecheck หรือ app build |
| 2026-09-24 | M0.2 | ตรวจ dependency graph 33 tasks และอ่าน contracts ข้ามเอกสาร | ไม่มีวงวน แก้ lock/Inspect, projected Git draft, repository types, reservation/retry/recovery/deletion และ export allocation ให้ตรงกัน |
| 2026-09-24 | M0 | ขอบเขตการตรวจ | ยังไม่ติดตั้ง dependencies ไม่รัน app/database/browser/performance tests; งานเหล่านั้นอยู่ M1–M7 และยัง TODO |
| 2026-09-25 | M1.2–M1.5 | DB `learning-suit` ตาม plan05 §2 (owner keys, Web Locks, BroadcastChannel, quota classification, import draft จาก prototype เดิม), fixtures `tests/fixtures`, incremental transaction validation + full parse ตอนเปิด | Vitest DOM-01..06 ผ่าน; e2e UX-01/02, PST-01/02/10 ผ่านทั้ง Chromium/WebKit |
| 2026-09-25 | M2.x | Canvas ใหม่: pointer-capture state machine + rAF, RDP, eraser, transforms ทุกชนิด/หมุน/multi-scale, clone threshold, clipboard ข้ามสไลด์/โปรเจกต์, property preview + commit ครั้งเดียว, nudge coalesce, culling, grid layer | e2e CAN-03..12 ผ่านทั้งสอง browser; แทร็กแพดจริง (MAN-01) Pending |
| 2026-09-25 | M3.x | Noto Sans Thai self-host, text overlay + recovery 500 ms, image ingest (magic bytes/header dims/decode/limits), thumbnails, teaching mode, responsive/overlay panels, shortcut help | e2e TXT-01..03, IMG-01..03, UX-03..05 ผ่าน; IME จริง (MAN-02) Pending |
| 2026-09-25 | M4.x | Migration + RLS + RPC + bucket, pgTAP, shim harness, Supabase adapters, save coordinator/reconcile/deletion, login/proxy/getClaims guard, cloud project service | shim 181/181 + concurrency 4/4; unit tests ผ่าน; **ยังไม่ได้รันกับ Supabase จริง** → BLOCKED |
| 2026-09-25 | M5.1–M5.2 | Git reducer/selectors/messages, widget view, DOM panel (projected state, recovery, lock) | Vitest GIT-01..06 (50 tests), e2e GIT-01/07 ผ่านทั้งสอง browser |
| 2026-09-25 | M6.1–M6.4 | Offscreen renderer ชุดเดียวกับ editor, PNG caps/warnings, raster PDF, archive worker + strict import | Vitest EXP bounds + ARC-01..05; e2e EXP-02/03/05, ARC-06 ผ่าน; cloud publish หลัง import รอ M4.5 |
| 2026-09-25 | M7 | Audit 3 ชุด + แก้ทุก finding ที่ยืนยัน, PERF benchmark อัตโนมัติ, runbook deployment | Required checks ที่รันได้ผ่านทั้งหมด; `supabase test db`/`test:integration`/deploy/manual ยังค้าง |
| 2026-09-25 | M7.3 (เตรียม) | เป้าหมาย deploy คือ Vercel: pin Node `24.x` ใน `engines`, production build ในโหมด cloud (Supabase env placeholder) + `next start` ตรวจ redirect/404/cache headers/cookie ปลอม | ผ่านบนเครื่อง; ยังไม่ได้ deploy จริงบน Vercel (ขาด Supabase project + Vercel project) — ขั้นตอนอยู่ใน runbook §3 |
| 2026-09-25 | M5.2 (ปรับ) | Feedback: ภาพ Git รกและเข้าใจยาก → ออกแบบใหม่เป็น pipeline ① แก้ไฟล์ → ② Stage → ③ Commits ต่อเครื่อง, commit เป็นวงกลมสีตาม ID (สีเดียวกัน = commit เดียวกันทุกการ์ด), ทางแยกเมื่อ DIVERGED, ลูกศร Push/Pull เฉพาะระดับ commits, สถานะสั้นหนึ่งบรรทัดพร้อมสัญลักษณ์, หมายเหตุรวมไว้ที่เดียว (plan04 §5 ปรับตาม) | Vitest diagram model 5 tests ผ่าน; screenshot 3 สถานะ (เริ่มต้น/บทเรียน/DIVERGED) ตรวจด้วยตา; e2e Git ผ่าน |
| 2026-09-25 | M5.2 (ปรับ 2) | Feedback: แยกไฟล์ที่แก้ (ซ้าย) กับ Git (ขวา) ในแต่ละเครื่อง และมี 3 ขั้นบทเรียน `A → Git`, `A → Git → GitHub`, `A+Git → GitHub → B+Git` เก็บเป็น `view` ของ node (optional, ไม่มี = full) เปลี่ยนผ่าน Git panel เป็น transaction ที่ Undo ได้; widget ใหม่เริ่มขั้น 1 (plan02/04 ปรับตาม) | Vitest layout/diagram 21 tests ผ่าน; screenshot 3 ขั้นตรวจด้วยตา; e2e GIT-01 เดินครบ 3 ขั้นผ่าน panel |
| 2026-09-25 | M5.2 (ปรับ 3) | Feedback: แผงขวาเหลือแค่ปุ่ม (ขั้นบทเรียน, 1. Add แทนคำว่า Stage, 2. Commit, Push/Pull/Clone ตั้งแต่ขั้น 2); แก้ไฟล์ใน textarea บนกระดานตรงกล่องไฟล์ (draft = `pendingEdit` git-file + flusher เดียว, recovery หลัง reload); คลิกวง commit เพื่อดูโค้ดของ commit นั้นแบบอ่านอย่างเดียว (session state ไม่เข้า history/export); ไฟล์เริ่มต้น `main.py` = `print("Hello World")`; widget ใหม่ซูมกล้องออกให้เห็นทั้งชิ้น; ลบ Inspect/card model ที่ไม่ใช้ (plan01/03/04/05, ADR 0005 ปรับตาม) | lint/typecheck ผ่าน; Vitest 341 tests ผ่าน; e2e 74/74 ผ่าน (chromium+webkit) รวม GIT spec ใหม่ 4 เคส (แก้บนกระดาน, preview, Escape, draft recovery, ชื่อไฟล์ invalid); screenshot 3 ขั้นตรวจด้วยตา |
| 2026-09-25 | M5.2 (ปรับ 4) | Feedback: ปรับ UI/UX ให้สวยขึ้น และปุ่ม Add / ช่องข้อความ / Commit ติดกัน → แผง Git เป็นการ์ดขั้นตอนมีหมายเลข (① Add ② Commit ③ GitHub) เว้นระยะชัด, เน้น “ขั้นถัดไป” ด้วยกรอบ/ปุ่มน้ำเงิน, เหตุผลปุ่มปิดอยู่ในการ์ดของปุ่มนั้น, ตัวเลือกขั้นบทเรียนมีเลขขั้น; กล่องไฟล์บนกระดานเป็น code editor โทนมืด (tab ชื่อไฟล์ + เลขบรรทัด) ทั้งภาพและ textarea ใช้ metrics เดียวกัน, กล่องไฟล์ GitHub โทนเดียวกัน | lint/typecheck ผ่าน; Vitest ผ่าน (เพิ่ม `codeLines`, `nextGitStep`, geometry editor); e2e ทั้งชุดผ่านทั้งสอง browser; screenshot 3 ขั้นตรวจด้วยตา |
| 2026-09-25 | M5.2 (ปรับ 5) | ขั้นของบทเรียนเปลี่ยนเป็น dropdown (ประหยัดพื้นที่แผง); ขั้น 3 แผงสลับไปเครื่องที่กำลังแก้ไฟล์/คลิก commit บนกระดานอัตโนมัติ (เดิมกด Add หลังแก้ไฟล์ B แล้วไปทำกับ A); ตรวจรายงาน “ปากกาวาดแล้วหาย”: วัดซ้ำ 53 เส้น × 2 รอบ Chrome และ 53 เส้น Safari เก็บครบเมื่อไม่มีการ reload, เส้นหายเฉพาะช่วงที่ dev server (`next dev`) reload หน้าเพราะมีการแก้โค้ด (production ไม่มี HMR) | e2e Git 8/8 ผ่านสองเบราว์เซอร์ (เพิ่ม assert แผงตามเครื่อง); script วัดเส้นปากกาอยู่ใน scratchpad |
| 2026-09-25 | M5.2 (ปรับ 6) | UX audit (script-driven, 11 scenarios, 1440/1280/1024) → แก้ทันที: Tab/Shift+Tab/Enter เยื้องโค้ด Python ในกล่องไฟล์ (เดิม Tab หลุดไปเครื่องมือ), Esc เก็บโค้ดแทนทิ้ง + ปุ่ม “ยกเลิกการแก้” เมื่อ invalid, แผง Git เปิดเองเมื่อเพิ่ม/คลิกตัวจำลองที่ 1024 และโหมดสอน + fit กล้องไม่ให้แผงบัง, แท็บ Git เสนอเลือกตัวจำลองเดิมก่อน/ตัวใหม่ไม่ทับตัวเดิม, ผลลัพธ์ sticky, animation Push/Pull 900 ms และจุดใหญ่ขึ้น, favicon; ข้อที่ต้องตัดสินใจ (merge/reset เมื่อประวัติแยก, ปุ่มบน widget, โหมดเน้นเครื่องเดียว, diff, คำสั่ง git, หลายไฟล์, branch) ยังไม่ทำ | Vitest 348 ผ่าน (code-edit 4 tests), e2e Git 10/10 สอง browser (เพิ่มเคสคีย์และสองตัวจำลอง); พบ dev server rebuild loop ระหว่าง audit (ไม่ใช่บั๊กแอป) |
| 2026-09-25 | M5.2 (ปรับ 7) | Feedback: กล่องไฟล์ใน GitHub แสดงแค่บรรทัดแรก → การ์ด GitHub มีกล่องโค้ดหลายบรรทัด (tab ชื่อไฟล์ + ป้าย commit ที่มาของไฟล์, เลขบรรทัด, “… อีก N บรรทัด”) และขณะเลือก widget เลื่อนดูทั้งไฟล์ได้ (textarea อ่านอย่างเดียว); จำนวนวง commit ปรับตามพื้นที่ของแต่ละรายการ (สูงสุด 8 ในขั้น 1); dev server ที่รันนาน ~5 ชม. ค้าง (CPU 100%, RSS 2.5 GB) → restart + ล้าง `.next` | Vitest 348 ผ่าน (layout: ทุกแถวที่วาดมีปุ่มคลิกอยู่ในรายการ, GitHub ≥7 บรรทัด/≥5 commit); e2e Git+Export 16/16 สอง browser; screenshot ไฟล์ 19 บรรทัดตรวจด้วยตา |
| 2026-09-25 | M5.2 (ปรับ 8) | Feedback: ขั้น A+Git → GitHub → B+Git ข้อความ commit หาย (เหลือแต่ C1, C2) → รายการ commit ในคอลัมน์แคบเป็นสองบรรทัด: ป้ายเล็กด้านบน, ข้อความ commit ด้านล่าง; วงเล็กลงเล็กน้อยเพื่อให้ป้าย main + origin/main พอดีแม้มีทางแยก | ตรวจ screenshot ขั้น 3 แบบปกติและแบบประวัติแยกด้วยตา; lint/typecheck ผ่าน, Vitest 348 ผ่าน, e2e Git+Export 16/16 สอง browser |
| 2026-09-25 | M5.2 (ปรับ 9) | Feedback: ขยายขั้น 3 ให้มีพื้นที่ → widget ขั้น 3 กว้าง 1600×680 (`gitBaseSize(view)` ใน domain เป็นแหล่งเดียวของ bounds/transform/export/overlay; เอกสารเก่าที่ไม่มี `view` = ขั้น 3 จึงกว้างขึ้นด้วย), ทุกเครื่องใช้เลย์เอาต์ขนาดเต็ม, รายการ commit ที่แคบใช้แถวสองบรรทัด, เปลี่ยนขั้นแล้วซูม/เลื่อนกล้องให้เห็นทั้งชิ้น | Vitest 348 ผ่าน (transform/geometry ของขั้น 3, layout 1600); วัดตำแหน่ง overlay อยู่ในกระดานหลังเปลี่ยนขั้น/Clone/โฟกัสเครื่อง B; lint/typecheck ผ่าน, e2e ทั้งชุด 76/76 สอง browser |
| 2026-09-25 | M8.1–M8.2 | ตัวจำลองการเก็บข้อมูล (ร้านกาแฟ) 4 ขั้น: ข้อมูลเก็บที่ไหน / ตาราง / เชื่อมตาราง / ใครเห็นอะไร; reducer แบบ pure คืน state + ลำดับจังหวะการไหล; flow engine ร่วม; แท็บขวาเปลี่ยนชื่อเป็น “ตัวจำลอง” และแสดงแผงตามชนิด; ขนาด/transform/ห้ามหมุนของ widget ทั่วไปผ่าน `isWidgetNode`/`widgetNodeSize` | Vitest ผ่าน (reducer ข้อมูล 16 tests รวม schema); e2e DATA-01..04; screenshot ทั้ง 4 ขั้นระหว่างวิ่งและหลังถึงตรวจด้วยตา; lint/typecheck ผ่าน; e2e ทั้งชุด 84/84 สอง browser |
| 2026-09-25 | M8.3–M8.4 | ตัวจำลอง Deploy 4 ขั้น: เปิดเว็บในเครื่อง (localhost เห็นแค่เครื่องเรา) / ขึ้น Vercel (push → GitHub → Build → Production, Build ล้มแล้วเว็บเดิมยังออนไลน์, Rollback) / กุญแจลับ (ไม่ขึ้น GitHub เพราะ .gitignore, ต้องใส่บน Vercel แล้ว Deploy ใหม่, ในเครื่องใช้ .env.local) / ภาพรวม (มือถือ → Vercel → กฎสิทธิ์ → ตารางออเดอร์ + ปุ่ม “เตรียมเว็บให้พร้อม”); node `deploy-simulator`; แผงใช้ชิ้นส่วนร่วม `flow-panel-parts`, ตัววาดใช้ `useFlowPlayback` ร่วมกับตัวจำลองข้อมูล | Vitest ผ่าน (reducer Deploy 10 tests รวม schema/prepare); e2e DEPLOY-01..04; screenshot ทั้ง 4 ขั้นตรวจด้วยตา; ปุ่มเพิ่มตัวจำลองในแผงซ้ายรวมเป็นแถวเดียว (สามปุ่มแนวตั้งดันรายการสไลด์จนการลากสไลด์ที่จอสูง 720 พลาด); lint/typecheck ผ่าน, Vitest 374 ผ่าน, e2e ทั้งชุด 88/88 สอง browser |
| 2026-09-26 | M8.2 (ปรับ) | Feedback ขั้นข้อมูลเก็บที่ไหน: ความจำของแอปอยู่ในกรอบหน้าต่างแอป (เก็บในเครื่องอยู่นอกแอป), รีเฟรชมี animation (↻ หมุน จอว่าง ความจำลอยหาย แล้วโหลดใหม่), แอปขึ้นวงหมุนกำลังโหลด/บันทึกตลอดช่วงที่ก้อนข้อมูลวิ่ง (`waitingAt`) ทุกขั้น + ตัวจำลอง Deploy | Vitest 377 ผ่าน (waitingAt 3 tests, ลำดับจังหวะรีเฟรช); e2e ข้อมูล/Deploy/Export 18/18 สอง browser; screenshot ระหว่างรีเฟรชและระหว่างโหลดตรวจด้วยตา |
| 2026-09-26 | M8.2/M8.4 (ปรับ) | Feedback: แผงขวารก → ออกแบบแผงตัวจำลองใหม่ (หัวข้อสั้น, segmented, ปุ่มไอคอน, แท็บ CRUD/ลูกค้า, แถบเล่นแบบย่อ, ตัดคำอธิบายซ้ำ); Deploy เพิ่มขั้น “กุญแจในเครื่อง (.env.local)” (เซิร์ฟเวอร์อ่านกุญแจก่อนต่อฐานข้อมูล, สลับมี/ไม่มีกุญแจ) เป็น 5 ขั้น; ตัดคำบนกระดาน Deploy; การสั่งกาแฟแสดง “กำลังบันทึก…” | Vitest 378 ผ่าน (DEPLOY localEnv), e2e ข้อมูล/Deploy 14/14 สอง browser + DEPLOY-05; screenshot แผงทั้ง 5 และขั้น .env.local ตรวจด้วยตา; lint/typecheck ผ่าน; e2e ทั้งชุด 90/90 สอง browser |
| 2026-09-26 | M8 (แก้) | Feedback: ไม่มีกุญแจแล้วสั่งไม่สำเร็จแต่ตัวหนังสือเป็นสีเขียว → เพิ่มผลแบบ `failed` (กรอบแดง + ไอคอน ⊗ ในแผง) สำหรับความล้มเหลวที่ตั้งใจสาธิต: ไม่มีกุญแจ (ในเครื่อง/Vercel), Build ล้ม, ยังไม่มีเว็บจริง, เพื่อนเปิด localhost, รีเฟรชแล้วออเดอร์หาย, เครื่องอื่นมองไม่เห็น, ข้อมูลรั่ว, ชื่อที่ก๊อปไม่ตรง; ข้อความผลบน browser ในเครื่องที่มี ✗ เป็นสีแดง | Vitest ผ่าน (outcome tests ทั้งสองตัวจำลอง); e2e ข้อมูล/Deploy สอง browser ผ่าน; screenshot กรณีไม่มีกุญแจตรวจด้วยตา |
| 2026-09-26 | M5.2/M3 (UX ค้าง) | ฟีเจอร์ที่ค้างจาก UX audit (ไม่รวมกระดานสด เพราะสอนด้วยแชร์หน้าจอ): (1) **แก้ประวัติที่แยกกัน** — action `merge` (merge commit สอง parent, เลือกเก็บไฟล์ของเรา/ของ GitHub) และ `resetToRemote`, ancestry เดินทั้งสอง parent, schema ตรวจ `mergeParentId`, กราฟวาดเส้นที่สองของ merge, การ์ด “ประวัติแยกกัน” บนสุดของแผง; (2) **diff ของ commit** — preview แสดงบรรทัดเพิ่ม/ลบเทียบ parent + ป้าย `+N −M` (ย่อ tab ชื่อไฟล์ในคอลัมน์แคบให้ป้ายพอดี); (3) **เลเซอร์พอยเตอร์** (K) — แก้บั๊กที่พบระหว่างทดสอบ: จุดหายเมื่อเมาส์นิ่งเกิน 0.7 วินาที | Vitest ผ่าน (reducer GIT-07 merge 4 tests, diff 4, diagram merge lanes, schema mergeParent); e2e GIT-08 + CAN-13 ผ่านสอง browser; screenshot ประวัติแยก/หลัง Merge+Push/diff ขั้น 1 และ 3/เลเซอร์ ตรวจด้วยตา |
| 2026-09-26 | M4 (auth) | Feedback: ทำระบบ Sign in ด้วย Supabase ให้เรียบร้อยก่อนขึ้น git + Vercel → `/login` ข้ามเมื่อ login อยู่แล้ว + ข้อความตาม `?notice=` + แสดง/ซ่อนรหัสผ่าน + error ไทยจาก `code` (รหัสผิด, ลองถี่เกิน, เน็ตหลุด, ยังไม่ยืนยันอีเมล); `/forgot-password`; `/auth/confirm` (token_hash/PKCE code, `next` same-origin); `/reset-password` (≥12 ตัว, ใช้เป็นเปลี่ยนรหัสผ่านได้); ออกจากระบบเฉพาะเบราว์เซอร์นี้ + แท็บอื่นตามไป login; `.gitignore` เพิ่ม `.playwright-mcp/`, `.vercel/`; runbook: Redirect URLs `/auth/confirm**`, email template token_hash, SMTP, invite | Vitest 395 ผ่าน (auth-messages, confirm-link); e2e AUTH-01 สอง browser; `next build` (สำเนาโปรเจกต์ + Supabase env placeholder) ผ่าน + `next start`: หน้า protected 307 → `/login` (เก็บ `next`), `next=//evil` ไม่ออกนอกเว็บ, ลิงก์อีเมลเสีย → `/login?notice=link-invalid`, cookie ปลอม → login, หน้า auth `no-store`; screenshot login/รหัสผิด/ลืมรหัส/ส่งแล้ว/ลิงก์หมดอายุ (Supabase Auth จำลองด้วย route interception) ตรวจด้วยตา; **ยังไม่ได้ทดสอบกับ Supabase จริง** (ต้องมี project + SMTP) |
| 2026-09-26 | M7 (audit ก่อนขึ้น Vercel) | Audit อิสระ (Codex + ตรวจซ้ำ): ไม่พบการข้ามบัญชี/RLS รั่ว/secret ใน repo; แก้แล้ว: cookie `Secure` เมื่อเป็น HTTPS (browser/server/proxy/confirm ใช้ค่าเดียวกัน), `next build` ล้มถ้าใส่ secret/service-role key ใน `NEXT_PUBLIC_*` (ไม่ให้ฝังลง bundle), `/auth/confirm` ใส่ session cookie บน redirect เอง + `Cache-Control: private, no-store`, security headers (`frame-ancestors 'none'`, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy, ปิด `X-Powered-By`), import `.learning-suit` ตรวจขนาดภาพจาก header จริงก่อน decode (manifest โกหกขนาดไม่ทำให้จองหน่วยความจำก้อนใหญ่), บัญชีอื่น login ในแท็บอื่น → หน้าโปรเจกต์ reload / editor หยุด sync แล้วออก, ลบ `NEXT_PUBLIC_APP_URL` ที่ไม่ได้ใช้; ยอมรับไว้ (runbook §8): UPDATE ตรงบน `projects` ไม่ตรวจรูปแบบ document, ลบ asset ที่ยังใช้อยู่ได้ — ทั้งสองต้องมี session ของเจ้าของเอง | lint/typecheck ผ่าน; Vitest 395 ผ่าน (archive: header ขนาดไม่ตรง → ปฏิเสธก่อน decode); e2e ทั้งชุด 94/96 + AUTH-01 ที่ล้มเพราะ dev server compile ครั้งแรกแล้ว redirect ฝั่ง client (แก้ให้รอผลปลายทาง) ผ่าน 4/4; production build (สำเนาโปรเจกต์) ผ่าน และ build ด้วย `sb_secret_…` ล้มพร้อมข้อความชัด; `next start`: headers ครบ ไม่มี `X-Powered-By`, cookie `Secure` เมื่อ `x-forwarded-proto: https`; กับ Supabase Auth จำลองในเครื่อง: ลิงก์ดี → set session cookie + ไป `/reset-password` (เห็นอีเมลบัญชี), ลิงก์เสีย → `/login?notice=link-invalid`, เปิด `/login` ตอน login อยู่ → `/projects` |
| 2026-09-26 | M4 (auth ปรับ) | Feedback: “ไม่เอาลืมรหัส ไม่เอาสมัครสมาชิก” → ลบ `/forgot-password`, `/auth/confirm`, `/reset-password` และลิงก์ “ลืมรหัสผ่าน?”; เหลือ `/login` + `/change-password` (ต้อง login, ใส่รหัสปัจจุบันก่อน, ไม่ใช้อีเมล); runbook ตัด Redirect URLs/Email Template/SMTP/Invite และเพิ่มวิธีผู้ดูแลตั้งรหัสใหม่ด้วย SQL (ห้ามลบผู้ใช้เพราะ owner ID เปลี่ยน) | lint/typecheck ผ่าน; Vitest 392 ผ่าน; e2e ทั้งชุด 95/96 + AUTH-01 (ตรวจ 404 ของ `/signup`, `/forgot-password`, `/reset-password`, `/auth/confirm` และ 307 ของ `/change-password` จาก HTTP response เพราะ dev server reload แท็บเมื่อ compile หน้าใหม่) ผ่าน 6/6; production build + Supabase Auth จำลอง: ไม่มีลิงก์ลืมรหัส, รหัสปัจจุบันผิด → “รหัสผ่านปัจจุบันไม่ถูกต้อง”, รหัสใหม่สั้น → ข้อความไทย, สำเร็จ → “เปลี่ยนรหัสผ่านแล้ว” (เรียก PUT /user ครั้งเดียว) |
| 2026-09-26 | M2 (แก้) | Feedback: “บางครั้งคลิกวาดไม่ได้ ต้องคลิกหลายๆที” → ตรวจพบ 3 สาเหตุ: (1) รูปทรงรับแค่คลิก 2 ครั้ง การกดลากถูกทิ้ง → เพิ่มกดลากปล่อย + preview; (2) วาดเสร็จกลับ Select (ตามสเปก) → คงไว้ แต่จำ “วาดต่อเนื่อง” ในเครื่อง; (3) เลือกตัวจำลอง Git ค้างไว้ กล่องแก้ไฟล์กินคลิกของปากกา → overlay แสดงเฉพาะเครื่องมือ Select | Vitest 392 ผ่าน; e2e ทั้งชุด 98/98 สอง browser (รวม CAN-14: ลากวาดสี่เหลี่ยม, วาดต่อเนื่องหลัง reload, ปากกาทับกล่องไฟล์ Git) |
| 2026-09-26 | M8.5 | Feedback: อยากได้ตัวจำลองสอน AI (การทำงาน, Memory, AI บนเว็บ vs Claude Code, ความจำของ Claude, ทำไม AI รู้ประวัติแชท, Chain of Thought) แบบจำลอง ไม่ต้องลึกถึงการเดาคำ → node `ai-simulator` 5 ขั้น (plan07 §4b) ใช้ flow engine ร่วม; ปุ่ม “AI” ในแผงซ้าย; คำตอบเป็นกฎตายตัว ไม่มี request ออกไปหา AI | Vitest AI 9 tests (ทุกขั้น + schema ของทุกเฟรม — พบและแก้: เฟรมแรกของแชทยาวเกิน 24 ข้อความ); e2e AI-01/02 สอง browser (รวมตรวจว่าไม่มี request ไป anthropic/openai); screenshot ทั้ง 5 ขั้นระหว่างเล่นและหลังจบตรวจด้วยตา (แก้: โจทย์ขั้น 2 ถูกตัด, แชทบนเว็บขั้น 4 เตี้ยเกิน) |
| 2026-09-26 | M8.5 (ปรับ) | Feedback: ส่วน AI เข้าใจยาก — อยากเห็นข้อความทั้งหมดลอยไปตอนส่ง, ผู้เรียนงงแอปแชทกับเบราว์เซอร์ → ขั้น 1/3 เหลือ 2 ฝั่ง (แอปแชท ↔ ตัว AI), ก้อนข้อมูลเป็นการ์ดที่มีทุกข้อความ (และแถวความจำในขั้น 3), กล่อง AI แสดง “ได้รับรอบนี้” ระหว่างตอบ แล้วว่าง “ลืมหมด” หลังตอบ; `Packet` รับ `body` | Vitest ทั้งชุด 401 ผ่าน; e2e ตัวจำลอง AI/ข้อมูล/Deploy 18/18 สอง browser; screenshot ทีละจังหวะ (พิมพ์ → การ์ดลอย → AI อ่าน → คำตอบลอยกลับ → ว่าง) ขั้น 1 และ 3 ตรวจด้วยตา |
| 2026-09-26 | M8.5 (ปรับ 2) | Feedback: ขั้น “AI บนเว็บ vs Claude Code” สื่อดีแต่ UX รก → จัดใหม่ 3 คอลัมน์ (เว็บ \| AI ตัวเดียวกัน \| เครื่องเรา), ตัดกรอบเส้นประ/กล่องหมายเหตุ/ด่านบนท่อ, ก้อนข้อมูลเป็นการ์ดรายละเอียด (`Hop.detail`) วิ่งเฉพาะ Claude Code ↔ AI, terminal เป็นภาษาคน, 16 → 12 จังหวะ | lint/typecheck ผ่าน; Vitest 401 ผ่าน (วงจรวิ่งเฉพาะ cc↔model, เนื้อหาไฟล์อยู่ในการ์ด, ไฟล์เปลี่ยนหลังอนุญาตเท่านั้น); e2e AI/ข้อมูล/Deploy 18/18 สอง browser; screenshot ทีละจังหวะตรวจด้วยตา |
| 2026-09-26 | M8.5 (ปรับ 3) | Feedback: (1) ปุ่มเพิ่มตัวจำลองทางซ้ายตัวหนังสือใหญ่ — สาเหตุ `button { font: inherit }` (unlayered) ทับ `text-[11px]` → `!text-[11px]`; (2) ขั้น “ความจำของ Claude Code” ไม่ชัด ไม่รู้ว่าส่งอะไร → 3 คอลัมน์ ไฟล์ถาวร \| session ชั่วคราว \| AI, การ์ด “ส่ง context ทั้งหมด” มีทุกบรรทัด (CLAUDE.md/ความจำ/บทสนทนา), แถบ context แยกสี, AI ได้รับแล้วลืม; (3) animation ทุกตัวช้าลงครึ่งหนึ่ง (flow 1100→2200 ms, Git transfer 900→1800 ms) | lint/typecheck ผ่าน; Vitest 401 ผ่าน (ทุกข้อความส่ง CLAUDE.md + ความจำ + บทสนทนา, AI ลืมหลังตอบ); e2e ทั้งชุด 102/102 สอง browser; วัดขนาดตัวอักษรปุ่ม = 11px ไม่ล้น; screenshot ขั้น 5 ทีละจังหวะตรวจด้วยตา |
| 2026-09-26 | M2/M3 (ปรับ) | Feedback: คีย์ 1–8 สำหรับเครื่องมือโปรด + สลับลำดับได้, grid แบบ draw.io (หลัก + ย่อยเส้นประ) → แถบเครื่องมือโปรดเรียงตามลำดับที่เก็บ (เดิมเรียงตามรายการเครื่องมือ) ลากไอคอนเพื่อย้าย/⌥←/→, ตัวเลขเล็กบนปุ่ม, คีย์ Digit1–8; grid เส้นย่อยประ 20 / เส้นหลักทึบ 100 หน่วย ปรับตามซูม | lint/typecheck ผ่าน; Vitest 403 ผ่าน (favorites 2 tests); e2e ทั้งชุด 103/104 → ตัวที่ล้มคือเทสต์เก่า “draws by two clicks…” ที่ไม่เสถียรมาตั้งแต่รอบ 3/4/11 (ดับเบิลคลิกข้อความภายในเฟรมเดียวกับที่ Esc ปิด editor) แก้เทสต์ให้ลองซ้ำจนช่องแก้ขึ้น ผ่าน 8/8 (×4 สอง browser); CAN-15 สอง browser (ลาก, คีย์, ⌥←, คงลำดับหลัง reload); screenshot grid + แถบระหว่างลากตรวจด้วยตา |
| 2026-09-26 | M2 (แก้) | Feedback: (1) สี่เหลี่ยมคลิกครั้งที่ 2 บางทีไม่จบ — คลิกแรกที่มือขยับ >6 px ถูกนับเป็นลากจิ๋ว (สร้างรูป 5×6 px แล้วกลับเครื่องมือเลือก; ก่อนมีการลากวาดก็ถูกทิ้งเงียบๆ) → ลากต้อง ≥ 12 px ไม่งั้นเป็นคลิก และคลิกที่สองจำจากตอนกด; (2) ปากกาวาดวนแล้วปล่อยหาย — จำลองวาดวน 1,100 จุดไม่หาย จึงแก้ต้นเหตุที่เป็นไปได้ทั้งหมด: blur/pointercancel/lost capture เก็บเส้นที่วาดไว้แทนทิ้ง, resize ระหว่างวาดไม่ยกเลิกเส้น | e2e CAN-12 (ปรับ: blur เก็บเส้น, Esc ทิ้ง) + CAN-16 (คลิกมือสั่น 8 px สองครั้ง → สี่เหลี่ยม) สอง browser; lint ผ่าน, Vitest 403 ผ่าน, e2e ทั้งชุด 106/106 สอง browser |
| 2026-09-26 | M2 (ติดตาม) | Feedback เพิ่ม: เส้นหาย “ส่วนใหญ่ตอนวาดไวๆ แล้วปล่อย” — จำลองขีดสั้นเร็ว 24 เส้น × Chrome/WebKit ไม่หาย, ส่วนหัวสูงคงที่ (ไม่ resize), writable ไม่เปลี่ยนระหว่างวาด → เพิ่มโหมดวินิจฉัย `?debug=pointer` (log บนกระดาน: down/up/cancel/lost capture/blur/resize, อุปกรณ์ pointerType, จำนวนจุด, บันทึกสำเร็จหรือไม่) ให้ผู้สอนเปิดบนเครื่องจริงแล้วส่งภาพ | e2e การวาด/สถานะ ผ่าน; screenshot log ตรวจด้วยตา |
| 2026-09-26 | M3 (เพิ่ม) | Feedback: อยากได้คลิกขวา + ล้าง Drawing → เมนูคลิกขวา (`context-menu.tsx`, role=menu, ↑↓/Home/End/Esc, ปิดเมื่อกดข้างนอก/scroll/resize/blur) วัตถุ: ทำสำเนา/คัดลอก/ชั้น/ล็อก/ลบ; กระดาน: วาง/เลือกทั้งหมด; ล้างเส้นปากกา/ไฮไลต์ หรือสิ่งที่วาดทั้งหมด (ไม่แตะวัตถุล็อก รูป ตัวจำลอง) Undo ครั้งเดียว; ⌃คลิกบน Mac ไม่วาดจุด | e2e CAN-17 สอง browser (ล้าง+Undo, ล็อกไม่หาย, Esc, ทำสำเนา, ล้างทั้งหมด); screenshot เมนูทั้งสองแบบตรวจด้วยตา |
| 2026-09-26 | M2 (ตัดสินใจ) | Feedback: การวาดรูปทรง “ผสมระหว่างคลิก→ลาก→คลิก กับ คลิก+ลาก→ปล่อย” → ผู้สอนเลือก **คลิก→เลื่อน→คลิก อย่างเดียว**: เอาการลากวาดรูปทรงออก (ลาก = วางจุดแรก), ปากกา/ไฮไลต์ยังกดลาก | e2e CAN-14 (ปรับ: ลากแล้วยังไม่มีรูป คลิกถัดไปได้รูป) + CAN-16 + ชุด drawing/local-workflow/selection 42/42 สอง browser; lint ผ่าน, Vitest 403 ผ่าน, e2e ทั้งชุด 108/108 สอง browser |
| 2026-09-26 | M2 (ปรับ) | Feedback: grid ใหญ่ไป + เลเซอร์ไม่สมูท (เป็นจุดๆ ต่อกัน) → grid เส้นย่อย 10 / เส้นหลัก 50 หน่วย (เปลี่ยนระยะเมื่อเส้นย่อย < 8 px) เส้นย่อยจางลง; หางเลเซอร์วาดเป็น path โค้งต่อเนื่อง (quadratic ผ่านจุดกึ่งกลาง) ไล่ความหนา/สีเป็น 4 ช่วง + เงาเรือง แทนเส้นสั้นทีละช่วง | CAN-13 ปรับให้นับ `<path>` ของหาง (เดิมนับ `<line>` ทีละช่วง) ผ่าน 4/4 สอง browser; screenshot grid สามระดับซูม + หางเลเซอร์ตรวจด้วยตา |
| 2026-09-26 | M3/M5 (ปรับ) | Feedback: เปลี่ยนอีโมจิทั้งหมดเป็นไอคอน → ไอคอน Lucide บนกระดาน (Konva `Path` จาก `scripts/build-icon-paths.mjs`, แก้ moveto ตัวแรกของแต่ละ path ให้เป็น absolute ตอนต่อ path) ใน AI/Deploy/Data ทุกขั้น; ของที่ส่งกับแพ็กเก็ต AI เป็น `CarriedLine{kind,text}`; Segmented รับไอคอน; ปุ่ม “ถัดไป” ใช้ไอคอนแทน ▶. ภาพย่อสไลด์ในแถบซ้าย (renderer เดียวกับ Export, วาดใหม่เฉพาะสไลด์ที่เปลี่ยน, 76 px) | lint/typecheck ผ่าน; Vitest 403 ผ่าน (reducer AI ปรับ detail เป็นข้อมูลมีชนิด); e2e AI/Data/Deploy 18/18 + UX-06 (ภาพย่อขึ้น/วาดใหม่หลังแก้/สไลด์ว่างไม่มีภาพ) + UX-02 สอง browser; e2e ทั้งชุด 108/110 → ที่ล้มคือ CAN-13 (เทสต์เลเซอร์เก่า) แก้แล้วผ่าน; production build ผ่าน; screenshot ทุกขั้นของ AI, Data, Deploy และรายการสไลด์ตรวจด้วยตา |

แต่ละ handoff เพิ่มวันที่, task IDs, ไฟล์/behavior ที่เปลี่ยน, คำสั่งที่รันและผล, manual checks ที่ยังค้าง, known limits และ task ถัดไป ห้ามใส่คำว่า all tests passed หากเพียง build ผ่าน
