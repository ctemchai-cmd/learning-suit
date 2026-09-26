# ADR 0004 — Authentication, RLS และ private assets

- สถานะการตัดสินใจ: **Accepted**
- วันที่ตัดสินใจ: **2026-09-24**
- สถานะการพัฒนาและหลักฐานตรวจรับ: ดู [Delivery and acceptance](../plan/06-delivery-and-acceptance.md)
- สเปกที่เกี่ยวข้อง: [Persistence, security and export](../plan/05-persistence-security-and-export.md), [Data contracts](../plan/02-architecture-and-data-contracts.md)

## บริบท

รุ่นแรกมีผู้สอนคนเดียวและข้อมูลบทเรียนเป็นส่วนตัว แต่ endpoint ของ Supabase ยังเรียกตรงจากภายนอกได้ การซ่อนปุ่มหรือ redirect หน้า editor จึงไม่ใช่ขอบเขตการอนุญาตข้อมูล ต้องตรวจสิทธิ์ที่ PostgreSQL และ Storage ด้วย คำที่ใช้คือ **RLS — Row Level Security**

## ทางเลือกที่พิจารณา

| ทางเลือก | ข้อได้เปรียบ | ข้อแลกเปลี่ยน |
|---|---|---|
| Supabase Auth + owner RLS + private bucket | identity และ policy อยู่ใกล้ข้อมูล browser ใช้ user session ได้ | ต้องทดสอบ policies โดยเรียก API โดยตรง เลือกแนวทางนี้ |
| Route guard อย่างเดียว | เริ่มต้นเร็ว | ไม่ป้องกันการเรียก database/storage API ตรง |
| ทุก request ผ่าน server ด้วย service-role key | รวม business logic ที่ server | ต้องเขียน authorization ซ้ำและเสี่ยง bypass RLS โดยไม่จำเป็น |
| Public signup + sharing roles | รองรับผู้ใช้ทั่วไป | เพิ่มขอบเขต product และ permission model เกินการสอนคนเดียว |
| Public storage bucket | แสดงภาพง่าย | ภาพเปิดอ่านได้เมื่อรู้ URL ไม่สอดคล้องกับ private projects |

## การตัดสินใจ

ใช้ Supabase Auth แบบ email/password สร้างบัญชีเจ้าของล่วงหน้าผ่าน Supabase และ **ปิด public signup ในการตั้งค่า Auth** หน้าแอปไม่มีสมัครสมาชิก (ยืนยัน 2026-09-26: ไม่มีสมัครสมาชิกและไม่มีลืมรหัสผ่านหรือลิงก์ทางอีเมลใดๆ มีแค่ “เปลี่ยนรหัสผ่าน” สำหรับบัญชีที่ login อยู่ ลืมรหัส → ผู้ดูแลตั้งใหม่ใน Supabase) ไม่มี allowlist ของอีเมลที่ hard-code ใน UI; authorization อิง `auth.uid()` และ owner ของข้อมูล ทำให้ทดสอบด้วยผู้ใช้อีกบัญชีได้โดยไม่ต้องเพิ่มฟีเจอร์ multi-user

ใช้ `@supabase/ssr` แยก browser/server clients จัดการ cookie refresh ตามเวอร์ชัน Next.js ที่ตรึง ตรวจ identity จาก validated claims (`supabase.auth.getClaims()`) ก่อนตอบ protected routes และ server actions ห้ามเชื่อ user จาก `getSession()` หรือ cookie ที่ยังไม่ตรวจลายเซ็นอย่างเดียว ตาม [Supabase SSR](https://supabase.com/docs/guides/auth/server-side/nextjs) หน้า authenticated และ response ที่เปลี่ยน auth cookies ต้องไม่ถูก cache ร่วมระหว่างผู้ใช้

บังคับ RLS ทุก application table ที่ client เข้าถึง และกำหนด grants ให้จำกัดตาม operations ที่ใช้จริง:

| Resource/operation | ข้อกำหนด |
|---|---|
| `projects` SELECT/DELETE | `owner_id = auth.uid()` สำหรับ role `authenticated` |
| `projects` INSERT | `WITH CHECK` บังคับ owner เท่ากับผู้เรียก |
| `projects` UPDATE | ทั้ง `USING` และ `WITH CHECK` บังคับ owner เดิม/ใหม่; immutable ownership และ CAS fields ควบคุมตามแผน migration |
| `project_assets` | asset ต้องเป็นของผู้เรียกและ parent project เป็นของผู้เรียก ไม่ตรวจ owner ของ asset เพียงอย่างเดียว |
| Save RPC | `security invoker`, fixed/explicit search path, revoke execute จาก `public`/`anon` และ grant เฉพาะ `authenticated` |
| Anonymous API | ไม่มีสิทธิ์อ่าน/เขียน application rows หรือ private objects |

`USING` และ `WITH CHECK` มีหน้าที่ต่างกัน; UPDATE ต้องไม่เปิดช่องให้ย้ายข้อมูลไปอีก owner หรือ project ของบัญชีอื่น หลัก policy อ้างอิง [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) ส่วนรายละเอียด SQL, constraints และ grants เป็นข้อกำหนดในแผน persistence

ใช้ bucket private สำหรับภาพประกอบเท่านั้น ชื่อ path ตาม `<user-id>/<project-id>/<asset-id>.<ext>` policy ตรวจ bucket, path segments, `auth.uid()` และ ownership ของ parent project ร่วมกัน ห้ามอาศัยชื่อ path ที่ผู้ใช้ส่งมาอย่างเดียว การ INSERT/SELECT/DELETE และ UPDATE ถ้าจำเป็นต้องมี policy ครบ และการ retry upload ต้องไม่เขียนทับ binary ของ asset ID เดิมด้วยภาพคนละไฟล์

เก็บ path ถาวรใน metadata; โหลดรูปด้วย authenticated download เป็น Blob/Object URL หรือ signed URL อายุจำกัดใน runtime แล้ว revoke Object URL เมื่อเลิกใช้ **ไม่เก็บ signed URL ลงเอกสารหรือ archive** Private bucket ยังตรวจการดาวน์โหลดตาม [Supabase Storage buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals) และ [Storage access control](https://supabase.com/docs/guides/storage/security/access-control)

Browser ใช้ Supabase URL, publishable key และ session ของผู้ใช้ production baseline ไม่จำเป็นต้องมี service-role/secret key ในแอป หากงานดูแลระบบนอกแอปจำเป็นต้องใช้ ให้เก็บเฉพาะ trusted environment ห้ามตั้งเป็น `NEXT_PUBLIC_*` หรือส่งเข้า client bundle

เมื่อ session หมดอายุ ให้หยุด sync และแจ้งเข้าสู่ระบบใหม่โดยรักษา draft/ภาพใน IndexedDB การเข้าระบบใหม่ต้องยืนยันว่าเป็น account เดิมก่อน resume queue; การออกจากระบบไม่ใช่เหตุผลให้ทิ้ง unsynced work โดยไม่มีทางกู้

## ผลกระทบและข้อจำกัด

- ต้องทดสอบผู้ใช้ A, B และ anonymous ทั้งผ่าน REST/RPC และ Storage; UI tests อย่างเดียวไม่เพียงพอ
- Publishable key เปิดเผยได้ตามหน้าที่ แต่สิทธิ์ข้อมูลขึ้นกับ RLS และ grants ที่ deploy จริง
- ไม่เพิ่ม API ฝั่ง server ที่ใช้ service role เพื่อเลี่ยงปัญหา policy; ต้องแก้ policy/transaction ให้ถูกต้อง
- สิทธิ์ owner-based ไม่รองรับแชร์โปรเจกต์หรือ role ผู้เรียน หากเพิ่มภายหลังต้องเปลี่ยน permission model และทดสอบใหม่
- Private Storage ไม่ทำให้ไฟล์ที่ผู้ใช้ Export ไปแล้วเป็นส่วนตัวโดยอัตโนมัติ; archive ไม่มี token และผู้ใช้เป็นผู้เลือกแชร์ไฟล์เอง

## เงื่อนไขทบทวน

ทบทวนก่อนเปิด public signup, share links, collaboration, team ownership, background jobs ที่ต้อง elevated access หรือเปลี่ยนผู้ให้บริการ identity การเปลี่ยนทุกแบบต้องเพิ่ม threat-specific tests และอัปเดต ADR นี้ก่อน rollout

## เอกสารอ้างอิง

ตรวจสอบเมื่อ **2026-09-24**

- [Supabase — Creating a client for SSR](https://supabase.com/docs/guides/auth/server-side/nextjs)
- [Supabase — Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase — Database functions](https://supabase.com/docs/guides/database/functions)
- [Supabase — Storage buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals)
- [Supabase — Storage access control](https://supabase.com/docs/guides/storage/security/access-control)
