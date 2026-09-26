# ADR 0003 — Local drafts, Cloud save และการป้องกันงานทับกัน

- สถานะการตัดสินใจ: **Accepted**
- วันที่ตัดสินใจ: **2026-09-24**
- สถานะการพัฒนาและหลักฐานตรวจรับ: ดู [Delivery and acceptance](../plan/06-delivery-and-acceptance.md)
- สเปกที่เกี่ยวข้อง: [Data contracts](../plan/02-architecture-and-data-contracts.md), [Persistence, security and export](../plan/05-persistence-security-and-export.md)

## บริบท

การสอนสดต้องวาดต่อได้เมื่อ network สะดุด และผู้ใช้ต้องรู้ว่าเก็บงานอยู่ที่เครื่องหรือบน cloud แล้ว การส่งทุก pointer event ไป server ทำให้ค่าใช้จ่ายและความซับซ้อนสูงโดยไม่ช่วยบทเรียน ขณะเดียวกันการเปิดโปรเจกต์เดียวกันจากอีกเครื่องต้องไม่เขียนทับงานเงียบ ๆ

## ทางเลือกที่พิจารณา

| ทางเลือก | ข้อได้เปรียบ | ข้อแลกเปลี่ยน |
|---|---|---|
| Local draft + debounce whole-document save | กู้เอกสารล่าสุดในเครื่องและบันทึกสไลด์กับ Git state เป็นหน่วยเดียว | payload โตตามโปรเจกต์; ต้องตรวจ revision เลือกแนวทางนี้ |
| Manual save ขึ้น cloud อย่างเดียว | โค้ดน้อย | การลืม Save หรือ connection หลุดทำให้เสี่ยงสูญเสียงานระหว่างสอน |
| แยก row ต่อ node และ sync ทุก mutation | ส่งเฉพาะส่วนที่เปลี่ยน | transaction, ordering และ undo ข้ามชนิดข้อมูลซับซ้อนเกิน single-user v1 |
| CRDT/Realtime collaboration | รองรับหลายคนทำงานพร้อมกัน | เพิ่ม model และ operational complexity โดยยังไม่มีความต้องการ |
| เก็บใน localStorage | API เรียบง่าย | synchronous และไม่เหมาะกับ document/ภาพจำนวนมาก |

## การตัดสินใจ

ใช้ IndexedDB ผ่าน [`idb`](https://github.com/jakearchibald/idb) เป็น local draft store และ PostgreSQL JSONB เป็น cloud document มี `projects` เก็บ owner, title, document, revision, `last_mutation_id` และ timestamps ส่วน `project_assets` เก็บ metadata ที่ผูกกับโปรเจกต์และ private Storage ข้อมูล array ใน document เป็นตัวกำหนดลำดับสไลด์และวัตถุ ไม่พึ่งลำดับ key ของ JSONB ซึ่ง [PostgreSQL](https://www.postgresql.org/docs/current/datatype-json.html) ไม่เก็บไว้เหมือน input text

ทุก document transaction รวม Undo/Redo เข้าคิวเขียน draft; ต้องรอ IndexedDB transaction สำเร็จก่อนแสดงว่าเก็บในเครื่องแล้ว การสลับสไลด์ flush draft โดยไม่รอ network ถ้าเขียน local ไม่สำเร็จยังคง document ใน memory แจ้งข้อผิดพลาดและให้ Export ได้ ไม่รายงานว่าบันทึกแล้ว

Cloud autosave debounce **1,500 ms** หลัง transaction ล่าสุด ปุ่ม Save และ `Cmd+S` flush คิวทันที ไม่ส่งข้อมูลจาก camera, selection หรือ pointer move มี request ที่กำลังทำงานได้เพียงหนึ่งรายการต่อ project writer และ coalesce การแก้ล่าสุดเป็น snapshot ถัดไป แต่ละ snapshot มี generation และ client mutation UUID เพื่อไม่ให้ response เก่าทำเครื่องหมายว่าเอกสารใหม่บันทึกแล้ว

ใช้ writer lock ต่อ account/project ภายใน browser installation ให้มี editor ที่แก้ local draft และ sync ได้เพียงแท็บเดียว แท็บอื่นเปิดอ่านและแสดงทางกลับแท็บเจ้าของ lock; เมื่อเจ้าของปิดจึงรับ lock แล้ว reload draft ก่อนแก้ กลไกอ้างอิง [Web Locks API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API) รายละเอียดกรณีไม่มี API และการเก็บ draft ระบุใน [แผน persistence](../plan/05-persistence-security-and-export.md) การล็อกนี้ไม่แทน revision check ระหว่างคนละเครื่อง

Cloud update เรียก database RPC แบบ `security invoker` ตรวจ `expectedRevision` และเขียน title/document/revision/`last_mutation_id` ใน transaction เดียว ฝั่ง client ห้ามทำ read แล้ว unconditional update แยกกัน การใช้ invoker ทำให้ function ใช้สิทธิ์ผู้เรียกตาม [Supabase database functions](https://supabase.com/docs/guides/database/functions) ร่วมกับ [ADR 0004](0004-authentication-and-data-access.md)

กติกาความสอดคล้อง:

1. สร้าง immutable save envelope ของ snapshot พร้อม revision ที่รู้และ mutation UUID แล้วเก็บลง local draft ก่อนส่ง
2. อัปโหลด asset ใหม่และบันทึก metadata ให้ครบก่อนส่ง document ที่อ้างถึง; ห้ามรายงาน cloud saved ขณะยังมี reference ที่ขาดไฟล์
3. RPC เปรียบเทียบ revision อย่าง atomic ถ้าตรงจึงเพิ่ม revision; retry envelope เดิมใช้ mutation UUID เดิม ถ้าคำขอนั้นเป็นรายการที่ server เพิ่งรับแล้วให้ตอบ acknowledgment เดิม ไม่เพิ่ม revision ซ้ำ
4. หากมี writer อื่นบันทึกต่อไปแล้วและไม่สามารถยืนยัน retry เดิมได้ ให้คืน conflict; `last_mutation_id` ไม่ใช่ประวัติ idempotency ไม่จำกัดและห้ามใช้เป็นเหตุผลข้าม revision check
5. response สำเร็จรับรองเฉพาะ generation ที่ส่ง หากมีการแก้ใหม่ระหว่างรอให้ draft ยัง dirty และส่ง snapshot ถัดไปด้วย revision ที่เพิ่งได้รับ
6. offline, auth หมดอายุ, upload ล้มเหลว และ conflict ต้องเก็บ draft/asset ในเครื่อง ไม่ล้างงานและไม่เปลี่ยน owner เพื่อพยายามส่งใหม่

Conflict หยุด cloud queue ของโปรเจกต์นั้นและมีสองทาง: โหลด cloud โดยเก็บ recovery draft เดิมไว้ หรือสร้างโปรเจกต์ใหม่จาก local draft พร้อม remap project/asset identifiers ไม่ merge geometry อัตโนมัติ และไม่มี Force overwrite เป็นค่าเริ่มต้น เปิดคำอธิบายความต่างระหว่าง “เก็บในเครื่อง” กับ “บันทึกบน Cloud แล้ว” ตาม [Product and UX](../plan/01-product-and-ux.md)

เอกสารในเครื่องแยกตาม account ห้ามนำ draft ของบัญชีเดิมไปอัปโหลดภายใต้บัญชีใหม่อัตโนมัติ รูปที่ถูกลบจาก Canvas อาจยังต้องใช้ใน Undo จึงยังไม่ garbage collect binary ทันที รายละเอียดลำดับลบ project/assets อยู่ในแผน persistence

## ผลกระทบและข้อจำกัด

- ผู้ใช้แก้เอกสารที่โหลดแล้วและ export ได้ขณะ offline แต่รุ่นแรกไม่รับประกันเปิดเว็บใหม่จาก cold start โดยไม่มี network; ไม่ได้ประกาศรองรับ PWA/service worker
- Local draft ป้องกัน network failure แต่ไม่ใช่ backup ถาวรเมื่อผู้ใช้ล้างข้อมูล browser จึงมี cloud และ portable archive เพิ่มเติม
- Whole-project JSONB ทำให้ server update สอดคล้องกัน แต่ payload และ write amplification โตตามจำนวนเส้น ต้องวัด performance/ขนาดเอกสารก่อนแยกเป็นรายสไลด์
- Storage upload และ PostgreSQL commit ไม่เป็น transaction เดียวกัน อาจมี asset ที่อัปโหลดแล้วแต่ document save ล้มเหลว ต้อง retry และ cleanup ตามสเปก โดยห้ามลบไฟล์ที่เอกสารอ้างอยู่
- Cloud response timestamps ใช้แสดงผล; conflict ตัดสินด้วย revision ไม่ใช่นาฬิกาของ client

## เงื่อนไขทบทวน

ทบทวนเมื่อขนาดโปรเจกต์ทำให้ cloud saves ช้าหรือเปลืองเกินเกณฑ์, ผู้ใช้ต้องแก้หลายเครื่องพร้อมกันจริง, ต้องมี remote version history หรือกู้ rollback หลังปิด browser ตอนนั้นจึงพิจารณา split documents, change log หรือ CRDT พร้อม migration

## เอกสารอ้างอิง

ตรวจสอบเมื่อ **2026-09-24**

- [idb — IndexedDB promise wrapper](https://github.com/jakearchibald/idb)
- [PostgreSQL — JSON types](https://www.postgresql.org/docs/current/datatype-json.html)
- [Supabase — Database functions](https://supabase.com/docs/guides/database/functions)
- [MDN — Web Locks API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API)
