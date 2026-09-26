# 01 — Product และ UX

เอกสารนี้กำหนดสิ่งที่ผู้ใช้ต้องทำได้ รายละเอียด gesture อยู่ใน [Canvas spec](03-canvas-editor.md), ข้อมูลใน [contracts](02-architecture-and-data-contracts.md), และสถานะงานใน [delivery](06-delivery-and-acceptance.md)

## เป้าหมายและผู้ใช้

ครูหนึ่งคนใช้ Mac กับเมาส์/แทร็กแพด วาดอธิบายสดขณะแชร์หน้าจอ โดยต้องเปลี่ยนสี/ความหนา เลือก ลาก Lock และ Clone ได้คล่อง ไม่ต้องเปิดโปรแกรมวาดอื่นเพื่อเตรียมบทเรียนพื้นฐาน

ใช้กรอบคิด Project = บทเรียน, Slide = กระดานหนึ่งช่วงของบทเรียน ไม่มีอัตราส่วนหน้ากระดาษตายตัวบน Canvas ผู้ใช้วาดออกไปได้ทุกทิศ ส่วน Export คำนวณขอบเขตเนื้อหาอัตโนมัติ

ความสำเร็จวัดจากการสร้างบทเรียนหลายสไลด์ วาดสด บันทึก ปิดเปิดกลับมาแก้ต่อ และส่งออกไฟล์ให้ผู้เรียนได้โดยไม่สูญเสียวัตถุหรือ Git state

## ขอบเขตรุ่นแรก

| รวมใน v1 | เลื่อนไปภายหลัง |
|---|---|
| วาด pen/highlighter/shapes/line/arrow/text, แนบภาพ | ปากกาแรงกด/Apple Pencil และ mobile editor |
| Selection, multi-select, transform, lock, clone, z-order | Nested groups, layers แบบ Photoshop, smart connectors |
| Infinite canvas, zoom/pan, slide CRUD, teaching mode | Slide animation, recording และ presentation playback timeline |
| Local drafts + cloud autosave + manual Save | Offline PWA ที่เปิด cold start โดยไม่มี network |
| Private projects ของ owner | Public links, collaboration, student accounts และ billing |
| PNG, raster PDF, portable editable archive | SVG export, selectable-text PDF, PSD และ video |
| Git หนึ่งไฟล์, สองเครื่อง, remote เดียว, main เดียว | GitHub API, terminal, executing HTML, branches, merge/rebase/conflict resolver |
| ภาษาไทยและคำศัพท์ Git ภาษาอังกฤษ | ระบบเปลี่ยนภาษาเต็มรูปแบบ |

ไม่เพิ่มฟีเจอร์ข้างต้นเพียงเพราะไลบรารีรองรับ; ให้ผ่าน v1 ก่อน

## หน้าจอและ routes

| Route | หน้าที่ |
|---|---|
| `/login` | email/password สำหรับ owner ที่สร้างไว้แล้ว **ไม่มีสมัครสมาชิกและไม่มีลืมรหัสผ่าน** (ตาม feedback 2026-09-26); มี session อยู่แล้ว → ไป `next` ทันที; แสดงข้อความตาม `?notice=signed-out` |
| `/change-password` | เปลี่ยนรหัสผ่านของบัญชีที่ login อยู่: ตรวจรหัสปัจจุบันด้วยการ login ซ้ำ (นับเป็น recent login ของ `secure_password_change`) แล้วตั้งรหัสใหม่ ≥ 12 ตัวอักษร ไม่ใช้อีเมล; ไม่มี session → `/login?next=/change-password` |
| `/projects` | รายการโปรเจกต์ล่าสุด, สร้าง, เปิด, เปลี่ยนชื่อ, ทำสำเนา, ลบ และ Import; ช่องค้นหาตามชื่อ (ทุกคำ ไม่สนลำดับ/ตัวพิมพ์, กด `/` เพื่อพิมพ์, Esc/✕ ล้าง, บอกจำนวนที่พบ; เพิ่ม 2026-09-26); ปุ่ม “ติดตั้งแอป” เมื่อ browser รองรับ |
| `/projects/[projectId]` | editor; UUID ของ draft และ cloud project ใช้ค่าเดียวกัน |
| `/` | redirect ตาม session ไป `/projects` หรือ `/login` |

ออกจากระบบ (`signOut` scope `local`) มีผลเฉพาะเบราว์เซอร์นี้ หน้าโปรเจกต์ในแท็บอื่นได้ `SIGNED_OUT` แล้วไป `/login?notice=signed-out` เอง ข้อความ error ของ Auth แปลงเป็นไทยจาก `code` (`auth-messages.ts`) ไม่แสดงข้อความจาก server

Editor เป็น client component ภายใน authenticated shell การ session หมดอายุขณะเปิดงานต้องเก็บ editor/draft ไว้ แล้วเปิดกล่อง login เพื่อบันทึกต่อ ไม่ redirect จนข้อมูลในหน่วยความจำหาย

### Project dashboard

- เรียงตามเวลาแก้ไขล่าสุด แยก badge งานที่ยังอยู่ในเครื่องและงานที่รอ sync
- Create สร้าง draft ทันทีชื่อ `บทเรียนใหม่` พร้อม `สไลด์ 1` ไม่รอ network
- Rename ชื่อ 1–120 ตัวอักษรหลัง trim ทำผ่าน save flow เดียวกับ editor
- Duplicate คัดลอก document และ assets เป็นโปรเจกต์ใหม่ ไม่แชร์ ownership/path กับต้นฉบับ
- Delete ต้องแสดงชื่อและยืนยัน ลบผ่านขั้นตอน tombstone/cleanup ใน [persistence](05-persistence-security-and-export.md) และแจ้งหากยังไม่เสร็จ
- ไม่มี undo สำหรับลบทั้งโปรเจกต์; dialog อธิบายชัด ลบสไลด์และวัตถุภายใน editor ใช้ Undo ได้
- แสดง thumbnail จาก local cache ของสไลด์แรก; ถ้าไม่เคยเปิดในเครื่องนั้นให้ใช้ placeholder โดยไม่ต้องดาวน์โหลดทั้งโปรเจกต์เพื่อวาด thumbnail

### Editor layout

| พื้นที่ | เนื้อหา/ขนาดเริ่มต้น |
|---|---|
| Top bar | สูง 52 px: กลับโปรเจกต์, ชื่อ, save status, Undo/Redo, Save, Export, โหมดสอน |
| Left panel | เริ่มกว้าง 240 px ปรับด้วยการลากขอบได้ในช่วง 192–400 px; รวม tools และรายการสไลด์ พับเหลือ 56 px แล้วยังเลือกเครื่องมือ/สไลด์และเพิ่มสไลด์ได้; รายการสไลด์มีภาพย่อ (thumbnail 76 px, 16:10) วาดด้วยตัวเรนเดอร์เดียวกับ Export พอดีเนื้อหา วาดใหม่เฉพาะสไลด์ที่เปลี่ยนหลังหยุดแก้ 0.5 วินาที สไลด์ว่างแสดงแค่สีพื้น |
| Canvas | พื้นที่ที่เหลือ ไม่มี browser scrollbars ใน editor |
| Right panel | กว้าง 280 px: Properties / Objects / Git; ยุบได้ |
| Bottom controls | zoom, Fit content, reset100%, ชื่อและลำดับสไลด์ |

ที่ viewport ต่ำกว่า 1100 px ยุบ slide rail และ right panel โดยอัตโนมัติและเปิดเป็น overlay ได้ เป้าหมาย editor คือ desktop ตั้งแต่ 1024×700; จอแคบกว่านี้แสดงข้อความแนะนำใช้คอมพิวเตอร์โดยยังเปิด dashboard ได้

สถานะพับและความกว้างของ Left panel จำในอุปกรณ์ ไม่เข้า document/Undo/cloud save ตัวจับขอบใช้ pointer และคีย์ลูกศร/Home/End ได้ เมื่อพับแล้ว Canvas ได้พื้นที่คืนทันที

แถบ UI ใช้โทนมืด, Canvas เริ่มพื้นขาวเพื่ออ่านและ export ง่าย เปลี่ยนพื้นหลังแต่ละสไลด์ได้ ภาพและข้อความที่ผู้ใช้กำหนดสีต้องไม่ถูกแปลงตาม theme

### Slide operations

- เพิ่มหลังสไลด์ปัจจุบัน ใช้ชื่อ `สไลด์ N` จากหมายเลขถัดไปที่ไม่ชนชื่ออัตโนมัติเดิม
- เปลี่ยนชื่อ 1–120 ตัวอักษร และ drag reorder พร้อมเมนูเลื่อนขึ้น/ลงที่ใช้ keyboard ได้
- Duplicate คัดลอกทุก node และ Git model, เปลี่ยน slide/node IDs, แชร์ immutable asset bytes ภายในโปรเจกต์ได้
- ลบเลือกสไลด์ถัดไป ถ้าไม่มีเลือกก่อนหน้า; เมื่อเหลือหนึ่งสไลด์ปิดปุ่มลบและบอกเหตุผล
- Camera ของแต่ละสไลด์จำในอุปกรณ์ที่ใช้อยู่ ไม่ซิงก์ camera ข้ามเครื่อง; สไลด์ duplicate ใช้ camera เดิมเป็นจุดเริ่มต้น
- Thumbnail อัปเดตหลังจบ transaction เมื่อ idle; ไม่สร้างใหม่ทุก pointer move (สไลด์ที่มีเกิน 1,500 วัตถุใช้ placeholder เพื่อไม่ block การสอน)

### Properties และ Objects

ไม่มี selection แสดง default properties ของ tool ปัจจุบัน มี selection แสดง properties ที่ทุก node ใน selection รองรับร่วมกัน ค่าที่ต่างกันแสดง `หลายค่า`; การตั้งใหม่ใช้กับทุก node ที่เลือก

การแก้ property ของ selection ไม่เปลี่ยน default ของ tool โดยเงียบ ๆ แต่ toolbar ที่ไม่มี selection ใช้ตั้ง default สำหรับวัตถุใหม่ และจำค่าไว้เฉพาะอุปกรณ์

Objects panel แสดงเรียงบนสุดก่อน พร้อมชื่อที่สร้างจาก type/ข้อความย่อ, icon และ Lock toggle คลิกแถว unlocked เลือกและ highlight ใน Canvas; Shift + คลิกแถวเพื่อเลือกหลายชิ้น มีตัวกรอง `ทั้งหมด` กับ `ล็อกอยู่` วัตถุ locked ยังอยู่ใน panel แต่คลิกชื่อไม่เลือกเข้า Canvas จนกว่าจะปลดล็อก Toggle lock เป็น document transaction

Favorite Tools เป็นแถบลอยบน Canvas มี handle สำหรับย้ายตำแหน่งและแสดงเฉพาะเครื่องมือที่ปักหมุดจาก toolbar หลัก การปักหมุดและตำแหน่งเป็นการตั้งค่าเฉพาะอุปกรณ์ ไม่เปลี่ยน document

### โหมดสอน

ซ่อน slide rail และ right panel เหลือ Canvas, toolbar แบบย่อ, สถานะ save และก่อนหน้า/ถัดไป เข้าหรือออกโหมดไม่แก้ข้อมูลหรือ camera ปุ่ม Properties/Git เปิด panel ชั่วคราวได้เพื่อใช้งานระหว่างสอน

ใช้ PageUp/PageDown เปลี่ยนสไลด์เมื่อไม่มี text editor/dialog รับ keyboard อยู่ ไม่แย่งลูกศรจากการขยับวัตถุ Fullscreen browser เป็นปุ่มแยกและมีทางออกที่มองเห็นได้

## User journeys ที่ต้องรองรับ

### วาดสดและเก็บบทเรียน

1. Login → สร้างโปรเจกต์ → ใช้ Pen เขียนและ Rectangle/Arrow ประกอบ
2. Shift เลือกหลายวัตถุ เปลี่ยนสีพร้อมกัน และ Option+ลากสำเนา
3. Lock รูปพื้นฐาน แล้ววาดทับได้โดยไม่ลากพื้นฐานติดมือ
4. เพิ่มสไลด์และกลับมาเห็น camera/เนื้อหาเดิม
5. กด Save ดูว่า cloud ยืนยันแล้ว ปิดและเปิดงานกลับมาแก้ได้

### สอนเรื่อง Git ข้ามเครื่อง

1. Insert Git simulator กลาง viewport → เลือกเครื่อง A ใน right panel
2. แก้ไฟล์ในกล่องบนกระดาน → Add (Stage) → Commit แล้วชี้ว่าข้อมูลอยู่เฉพาะ A; คลิกวง commit เพื่อเทียบโค้ดแต่ละรุ่น
3. Push → เห็น remote เปลี่ยน; B ยังไม่มี repo จน Clone
4. แก้บน B → Add → Commit → Push แล้วกลับ A → Pull
5. ใช้ Pen เขียนคำอธิบายรอบ simulation และ export สไลด์รวมภาพ simulation ปัจจุบัน

### Network หรือ login มีปัญหาระหว่างสอน

1. วาดต่อได้ในเอกสารที่โหลดแล้วพร้อม badge เก็บในเครื่อง
2. ไม่แสดงสำเร็จบน cloud เมื่อ offline/token หมดอายุ
3. เชื่อมต่อ/login แล้ว sync ต่อ หาก remote เปลี่ยนให้เลือกเก็บงาน local เป็นสำเนาหรือใช้ cloud
4. Export archive ได้จาก local document และ local assets แม้ cloud ใช้งานไม่ได้

## ข้อความสำคัญใน UI

| State | ข้อความหลัก |
|---|---|
| Local write pending | `กำลังเก็บในเครื่อง…` |
| Cloud write pending | `กำลังบันทึก…` |
| Current snapshot acknowledged | `บันทึกบน Cloud แล้ว` + เวลา |
| Offline | `เก็บในเครื่องแล้ว · รอเชื่อมต่อ` |
| Active text draft | `กำลังแก้ข้อความ` และ badge local recovery เมื่อเขียนสำเร็จ |
| Local storage failure | `เก็บในเครื่องไม่สำเร็จ` + ปุ่ม Export สำรอง |
| Cloud failure | `บันทึกบน Cloud ไม่สำเร็จ` + ลองใหม่ |
| Conflict | `มีงานจากอีกเครื่อง` + ใช้ฉบับ Cloud / เก็บงานนี้เป็นสำเนา |
| Expired login | `เข้าสู่ระบบอีกครั้งเพื่อบันทึกต่อ` |

ใช้คำ `บันทึกบทเรียน` สำหรับแอป และ `Commit / Push / Pull (จำลอง)` สำหรับ Git ห้ามใช้ badge cloud save แสดงผลของ Git action

## Accessibility และ feedback

- ทุก icon มี accessible name, tooltip, focus ring และใช้ keyboard เปิดเมนูได้
- Button disabled ต้องมีคำอธิบาย โดยเฉพาะ Commit/Pull/Clone และ Delete slide
- สถานะ Git ใช้ข้อความและ icon ควบคู่สี การ rejected Push ไม่ใช้สีแดงอย่างเดียว
- ใช้ toast สำหรับผลสำเร็จสั้น ๆ แต่ข้อผิดพลาด save/conflict เป็น persistent banner จนแก้ไข
- `prefers-reduced-motion` ปิด animation การส่ง commit ได้ ผลข้อมูลต้องเหมือนเดิม

## การส่งต่อและตรวจรับ

ทำ shell/dashboard ก่อน tools แล้วต่อ Git, save และ export ตาม [task dependencies](06-delivery-and-acceptance.md) ตรวจรับด้วย journeys ทั้งสามข้างต้น, การเข้าถึง Objects เพื่อ unlock, การยุบ panel และการพิมพ์ภาษาไทยจริง รายละเอียด test IDs อยู่ใน delivery แห่งเดียว
