# Learning Suit — เอกสารสำหรับพัฒนารุ่นแรก

ชุดเอกสารนี้เป็นข้อกำหนดที่ตกลงแล้วสำหรับเว็บวาดสอนสดส่วนตัว จัดบทเรียนเป็นโปรเจกต์และสไลด์ และจำลองการส่งงานระหว่างเครื่อง A ↔ GitHub ↔ เครื่อง B ขณะนี้แอปมี editor, ตัวจำลอง Git, export/archive และชั้น cloud (Supabase migration + adapters) ครบตามสเปก ส่วนการตรวจกับ Supabase จริงและ deployment ยังรอ environment/credentials ดูสถานะจริงที่ delivery

วันที่จัดทำและตรวจแหล่งอ้างอิง: **2026-09-24**

## เริ่มงานสำหรับ Sol

1. อ่าน [ผลิตภัณฑ์และ UX](plan/01-product-and-ux.md) เพื่อเข้าใจงานสอนและขอบเขตรุ่นแรก
2. อ่าน [architecture และ data contracts](plan/02-architecture-and-data-contracts.md) ก่อนสร้าง types/store/component
3. อ่าน [Canvas](plan/03-canvas-editor.md), [Git simulator](plan/04-git-simulator.md) และ [persistence/security/export](plan/05-persistence-security-and-export.md) ตามงานที่จะทำ
4. ใช้ [delivery และ acceptance](plan/06-delivery-and-acceptance.md) เป็น **แหล่งสถานะงานเพียงแห่งเดียว** เริ่มจากงานแรกที่ยังไม่เสร็จและ dependency ผ่านแล้ว
5. อ่าน ADR ที่เกี่ยวข้องก่อนเปลี่ยนเทคโนโลยีหรือขอบเขต หากต้องเปลี่ยนการตัดสินใจ ให้เขียน ADR ใหม่ที่ supersede ฉบับเดิม พร้อมแก้สเปกและ acceptance ที่กระทบ

คำว่า Accepted ใน ADR หมายถึงยอมรับการออกแบบ ไม่ได้หมายถึงเขียนโปรแกรมหรือทดสอบฟีเจอร์นั้นแล้ว ดู milestone ปัจจุบันที่ [delivery](plan/06-delivery-and-acceptance.md#สถานะและลำดับงาน)

## ข้อสรุปที่ต้องรักษา

- ทำ editor เองด้วย React + Konva; ใช้ Next.js, TypeScript, Supabase และ Vercel
- **ข้อมูลหลักคือ Drawing info**: จุดเส้น รูปทรง ข้อความ properties ลำดับซ้อน และ Git state เป็น JSONB ไม่ใช่ภาพ screenshot และไม่ใช่ serialized Konva tree
- Storage มีไว้เก็บเฉพาะภาพแนบของผู้ใช้ PNG/PDF สร้างใน browser ตอน Export; thumbnail เป็น cache สร้างใหม่ได้
- โปรเจกต์มีสไลด์เรียงลำดับ แต่ละสไลด์เป็น infinite canvas; camera/selection เป็น state ของอุปกรณ์ ไม่เปลี่ยนตำแหน่งวัตถุ
- Local draft มาก่อน cloud save; ไม่แสดงว่า cloud saved ก่อน server ยืนยัน snapshot นั้น
- ใช้ revision กันการเขียนทับเมื่อเปิดสองเครื่อง; ไม่ทำ collaborative editing หรือ merge เอกสารในรุ่นแรก
- Object Lock ต้องป้องกันการเลือก/เปลี่ยนผ่าน Canvas และมีทางปลดล็อกผ่าน Objects panel
- Git simulator เป็นการจำลองข้อมูลหนึ่งไฟล์บน `main` เพื่อสอน Add (Stage)/Commit/Push/Clone/Pull (แก้ไฟล์และดูโค้ดของแต่ละ commit บนกระดาน) ไม่เชื่อม GitHub จริงและไม่รันโค้ด
- การ Save บทเรียนกับการ Commit/Push ในบทเรียนเป็นคนละระบบและใช้คำใน UI แยกกัน
- Auth/RLS/Storage policies ต้องมี integration tests; การซ่อนหน้าจอไม่ใช่ขอบเขตสิทธิ์ข้อมูล

## แผนที่เอกสาร

| เอกสาร | เป็นเจ้าของข้อกำหนด |
|---|---|
| [01 Product](plan/01-product-and-ux.md) | ผู้ใช้ ขอบเขต หน้าจอ user journeys คำที่ใช้ใน UI |
| [02 Architecture](plan/02-architecture-and-data-contracts.md) | TypeScript contracts, schema, module boundaries, defaults/limits |
| [03 Canvas](plan/03-canvas-editor.md) | gestures, geometry, selection, history, keyboard, text/image integration |
| [04 Git](plan/04-git-simulator.md) | Git state/reducer, transition rules, fixtures และบทเรียน |
| [05 Persistence](plan/05-persistence-security-and-export.md) | local/cloud protocols, SQL/RLS contracts, assets, archives และ export |
| [06 Delivery](plan/06-delivery-and-acceptance.md) | task IDs/dependencies/status, acceptance IDs, verification และ rollout |
| [07 Flows](plan/07-data-and-deploy-flows.md) | ตัวจำลองการไหล: การเก็บข้อมูล (ร้านกาแฟ, สิทธิ์/Supabase) และการ Deploy (Local → Vercel → Env → ภาพรวม) |
| [Runbook](runbook/deployment.md) | ขั้นตอนปฏิบัติ preview/production, env, smoke และ rollback (ไม่ใช่แหล่งสถานะ) |

ถ้ารายละเอียดซ้ำกัน ให้เอกสารเจ้าของข้อกำหนดในตารางนี้เป็นหลัก แล้วแก้จุดอ้างอิงให้ตรงกัน อย่าเลือกพฤติกรรมใหม่เองโดยปล่อยเอกสารขัดกัน

## Architectural Decision Records

| ADR | การตัดสินใจ |
|---|---|
| [0001](adr/0001-application-stack.md) | Application stack และขอบเขต client/server |
| [0002](adr/0002-custom-canvas-and-document-model.md) | Custom canvas, drawing model และ transaction history |
| [0003](adr/0003-local-drafts-and-cloud-saving.md) | Local drafts, cloud snapshots และ revision conflicts |
| [0004](adr/0004-authentication-and-data-access.md) | Closed signup, owner RLS และ private assets |
| [0005](adr/0005-git-teaching-simulator.md) | Git simulation ที่ถูกต้องตามขอบเขตการสอน |
| [0006](adr/0006-export-and-portable-projects.md) | Bounds-based export และ portable archive |

## วิธีส่งมอบแต่ละ milestone

Implement ตาม acceptance ID ที่ระบุ ทดสอบเฉพาะส่วนที่เกี่ยวข้องพร้อม regression ที่จำเป็น แล้วบันทึกคำสั่ง ผลจริง และข้อจำกัดลง delivery document แยก automation ออกจากการตรวจด้วยคน ห้ามทำเครื่องหมายผ่านหากยังไม่ได้รัน

Dependencies ภายนอก เช่น Supabase project, owner account และ Vercel environment ให้บันทึกว่ายังไม่ได้ตั้งค่าเมื่อขาดข้อมูล แต่ยังทำ local UI, pure logic, local migrations และ tests ต่อได้ ห้ามใช้ production credentials ใน fixtures หรือเอกสาร

รัน `corepack pnpm install` และ `corepack pnpm dev` เพื่อทดลองโหมดพัฒนาในเครื่อง (ไม่ตั้ง Supabase env) หรือตั้ง env ตาม README เพื่อใช้ cloud; ใช้ [delivery](plan/06-delivery-and-acceptance.md) ดูงานที่ผ่านและข้อจำกัดล่าสุด และ [runbook](runbook/deployment.md) สำหรับ M7
