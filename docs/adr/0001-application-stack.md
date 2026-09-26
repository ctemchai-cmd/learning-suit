# ADR 0001 — Application stack และขอบเขตระบบ

- สถานะการตัดสินใจ: **Accepted**
- วันที่ตัดสินใจ: **2026-09-24**
- สถานะการพัฒนาและหลักฐานตรวจรับ: ดู [Delivery and acceptance](../plan/06-delivery-and-acceptance.md) แห่งเดียว
- สเปกที่เกี่ยวข้อง: [Product and UX](../plan/01-product-and-ux.md), [Architecture and data contracts](../plan/02-architecture-and-data-contracts.md)

## บริบท

Learning Suit เป็นเครื่องมือส่วนตัวสำหรับครูวาดสอนสด จัดเนื้อหาเป็นโปรเจกต์และสไลด์ และใช้ตัวจำลอง Git ประกอบการอธิบาย ผู้ใช้ต้องการลดการสลับไป Photoshop, Paint หรือ TradingView โดยให้การเลือกวัตถุ เปลี่ยน Properties, Lock และ Option + ลากใช้ได้คล่องบน Mac

เป้าหมาย deployment คือ Vercel และ Supabase การเลือก stack ต้องทำให้ editor ตอบสนองทันทีโดยไม่รอ server และแยก logic การสอนออกจาก UI เพื่อทดสอบได้ การเลือก Vercel + Supabase เพียงอย่างเดียวไม่รับประกันสิทธิ์ข้อมูล; ข้อกำหนด RLS อยู่ใน [ADR 0004](0004-authentication-and-data-access.md)

## ทางเลือกที่พิจารณา

| ทางเลือก | ข้อได้เปรียบ | เหตุผลที่ไม่เลือกเป็นแนวทางหลัก |
|---|---|---|
| Next.js + Supabase | รวม routes, authentication integration และ browser editor ในแอปเดียว สอดคล้องกับปลายทาง deployment | เลือกแนวทางนี้ โดยจำกัดส่วนที่ต้องใช้ server ให้ชัด |
| React SPA + API แยก | editor เรียบง่ายและแยก deployment ได้ | ยังไม่มีความต้องการ API สำหรับ client อื่น การแยก service เพิ่มงานดูแล |
| Full-stack server ที่ render Canvas/Export | ควบคุม environment ของภาพส่งออกได้ | เพิ่มค่าใช้งานและ network dependency ระหว่างสอน; browser ทำงานรุ่นแรกได้ |
| Whiteboard สำเร็จรูปทั้งแอป | ลดเวลาสร้างเครื่องมือพื้นฐาน | ต้องปรับพฤติกรรม editor และฝัง Git simulation ตามบทเรียน ดูการเปรียบเทียบใน [ADR 0002](0002-custom-canvas-and-document-model.md) |

## การตัดสินใจ

| หน้าที่ | เครื่องมือที่เลือก | ขอบเขตการใช้ |
|---|---|---|
| App shell และ routes | Next.js App Router, React, TypeScript strict | หน้า login, projects, editor; deploy บน Vercel |
| Canvas renderer | Konva + react-konva | โหลดและทำงานเฉพาะ browser |
| UI | Tailwind CSS, Radix UI, Lucide | layout, accessible controls, dialogs, icons |
| State และ history | Zustand + Immer | document, session และ gesture แยกกัน; transactions และ inverse patches |
| Validation | Zod | document, cloud data และ import boundary |
| Local drafts | IndexedDB ผ่าน `idb` | document drafts และภาพที่ใช้ในบทเรียน |
| Cloud | Supabase Auth, PostgreSQL, Storage | บัญชี, JSONB และ private assets |
| Auth integration | `@supabase/supabase-js`, `@supabase/ssr` | browser/server clients และตรวจ identity ตาม [ADR 0004](0004-authentication-and-data-access.md) |
| Export | Konva, `pdf-lib`, `fflate` | PNG, raster PDF, portable ZIP ใน browser |
| Validation tools | Vitest, Playwright, Supabase CLI/database tests | pure logic, browser interaction, RLS |
| Package manager | pnpm | ใช้ lockfile เดียวและ frozen install ใน CI |

ใช้ Node.js LTS ที่ Next.js และ Vercel รองรับร่วมกัน ณ M1 ตรวจ peer dependencies ของ React/react-konva แล้วตรึงรุ่นจริงใน `package.json`, `pnpm-lock.yaml` และไฟล์กำหนด Node ของ repository ห้ามเลือก canary/preview เป็น default และไม่เปลี่ยน major ระหว่าง milestone โดยไม่บันทึกเหตุผล การไม่เขียนเลขรุ่นสมมติใน ADR นี้ช่วยให้เอกสารไม่อ้างว่า compatibility ได้ผ่านการทดสอบแล้ว

หน้าและ layout ใช้ server boundary สำหรับตรวจ identity และจัด shell ส่วน Canvas, IndexedDB, pointer input และ export อยู่ภายใน client boundary โดยโหลด editor แบบไม่ SSR ตามข้อจำกัด browser APIs ของ [Next.js Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components)

แยก domain ของ document/geometry/Git simulator ให้เป็น TypeScript ล้วน ไม่ import React, Konva หรือ Supabase ส่วน adapter แปลงข้อมูลไปยัง renderer, persistence และ export เส้นทางข้อมูลและ interfaces ที่ต้องสร้างกำหนดใน [Architecture and data contracts](../plan/02-architecture-and-data-contracts.md)

รุ่นแรกใช้คนเดียวและแชร์หน้าจอ UI ภาษาไทยและศัพท์ Git ภาษาอังกฤษ รองรับ Mac พร้อมเมาส์หรือแทร็กแพดเป็นหลัก ไม่มี collaboration, public sharing, GitHub API จริง, terminal, AI backend, Branch/Merge/Rebase หรือ Apple Pencil integration โดยเฉพาะ (ปรับ 2026-09-26: เพิ่ม Merge แบบเลือกฝั่งไฟล์และ “ใช้เวอร์ชัน GitHub” เพื่อแก้ประวัติที่แยกกันในตัวจำลอง Git ยังไม่มี branch/Rebase — plan 04 §4)

## ผลกระทบและข้อจำกัด

- Editor และ export ไม่ต้องมี server render service; งานหนักและขีดจำกัดหน่วยความจำอยู่ที่ browser
- แบ่ง milestone ให้ local editor ใช้งานและทดสอบได้ก่อนเชื่อม cloud แต่ production ต้องมี authentication และ RLS ครบ
- Pure domain layer ทำให้ Sol ตรวจ semantics ของ Git และ geometry ได้ก่อน UI และช่วยลดการผูกเอกสารกับ renderer
- มี dependency หลายตัวแต่แต่ละตัวมีหน้าที่ชัดเจน ไม่เพิ่ม UI framework, state library หรือ persistence layer อีกชุดเพื่อทำหน้าที่ซ้ำ
- Font ภาษาไทยต้องเป็น asset ที่แอปโหลดได้แน่นอน และ export ต้องรอพร้อมใช้งาน รายละเอียดอยู่ใน [Canvas editor](../plan/03-canvas-editor.md)

## เงื่อนไขทบทวน

ทบทวนเมื่อจำเป็นต้องมีผู้ใช้หลายคนวาดพร้อมกัน, editor ไม่ผ่าน performance acceptance หลังปรับ rendering, browser export ไม่รองรับขนาดงานจริง หรือจำเป็นต้องมี client อื่นที่ใช้ API เดียวกัน การเปลี่ยนแปลงต้องปรับ ADR ที่เกี่ยวข้องพร้อม acceptance criteria ก่อนย้าย stack

## เอกสารอ้างอิง

ตรวจสอบแหล่งทางการเมื่อ **2026-09-24**; รุ่นแพ็กเกจที่ติดตั้งจริงต้องบันทึกอีกครั้งใน M1

- [Next.js — Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components): การแบ่ง browser และ server boundary
- [Supabase — Creating a client for SSR](https://supabase.com/docs/guides/auth/server-side/nextjs): browser/server clients และ authentication integration
- [Konva — Save/load best practices](https://konvajs.org/docs/data_and_serialization/Best_Practices.html): เก็บ state ของแอปแยกจาก renderer
- [Immer — Patches](https://immerjs.github.io/immer/patches/): patch และ inverse patch สำหรับ history
