# ADR 0002 — Custom Canvas และ Drawing info เป็นข้อมูลต้นฉบับ

- สถานะการตัดสินใจ: **Accepted**
- วันที่ตัดสินใจ: **2026-09-24**
- สถานะการพัฒนาและหลักฐานตรวจรับ: ดู [Delivery and acceptance](../plan/06-delivery-and-acceptance.md)
- สเปกที่เกี่ยวข้อง: [Architecture and data contracts](../plan/02-architecture-and-data-contracts.md), [Canvas editor](../plan/03-canvas-editor.md)

## บริบท

ผู้ใช้ต้องกลับมาแก้เส้นปากกา สี ตำแหน่ง Lock และสถานะตัวจำลอง Git หลังเปิดโปรเจกต์ใหม่ได้ ข้อมูลหลักจึงเป็น Drawing info ของแต่ละวัตถุ ภาพแบนเพียงอย่างเดียวไม่เพียงพอสำหรับงานนี้

Editor ต้องรองรับการวาดสดและ interaction เฉพาะ เช่น Option + ลาก Clone, selection ที่ข้ามวัตถุ Lock, properties panel ที่เรียบง่าย และ Git simulator เป็นวัตถุบนกระดาน การควบคุม interaction และ document model จึงเป็นเหตุผลหลักในการเลือก renderer

## ทางเลือกที่พิจารณา

| ทางเลือก | ข้อได้เปรียบ | ข้อแลกเปลี่ยนสำหรับโครงการนี้ |
|---|---|---|
| Konva + react-konva และ editor ของแอปเอง | ควบคุมรูปทรง, gesture, UI และวัตถุ Git ได้โดยตรง | ต้องทำ selection, transforms, history และ geometry เอง เลือกแนวทางนี้ |
| ฝัง Excalidraw | มี whiteboard และเครื่องมือพื้นฐานพร้อมใช้ | ต้องปรับ UX และวัตถุ Git ให้เข้ากับ editor/model ของ library; ยังเป็นทางเลือกได้หากยอมลด customization ตาม [เอกสารการฝัง React component](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/integration) |
| tldraw SDK | มีระบบ editor และ custom shapes | ต้องยอมรับ model/API ของ SDK และไลเซนส์ production; [เอกสารปัจจุบัน](https://tldraw.dev/community/license) ระบุว่า production ต้องมี license key ที่ใช้งานได้ รวม trial, commercial หรือ hobby ตามเงื่อนไข ไม่ได้แปลว่าทุกกรณีต้องซื้อ commercial |
| Canvas API โดยตรง | ควบคุม rendering ทั้งหมด | เพิ่มงาน hit testing, scene graph และ export โดยไม่เพิ่มความสามารถสอนที่จำเป็น |
| บันทึกภาพ PNG แทนวัตถุ | แสดง preview ง่าย | ไม่สามารถเลือกแก้ Drawing info เดิม จึงใช้เฉพาะผลส่งออก |
| บันทึก `Konva.Stage.toJSON()` | เริ่มต้นง่ายในฉากเล็ก | ผูก schema กับ view tree และจัดการ image/event state ได้ไม่ครบ จึงไม่เป็น storage format |

การเลือก custom editor เป็นการตัดสินใจออกแบบของโครงการ ไม่ใช่ข้ออ้างว่า whiteboard SDK อื่นสร้างความสามารถเหล่านี้ไม่ได้

## การตัดสินใจ

ใช้ Konva เป็น renderer และให้ document ของแอปเป็นแหล่งข้อมูลหลัก ตามแนวทางเก็บ application state แยกจากฉากใน [Konva best practices](https://konvajs.org/docs/data_and_serialization/Best_Practices.html)

`ProjectDocument` มี `schemaVersion: 1`, สไลด์เรียงลำดับ และ `assets` เป็น record ตาม asset ID แต่ละสไลด์มี nodes เรียงจากหลังมาหน้า `CanvasNode` เป็น discriminated union ของรูปทรง เส้นปากกา ข้อความ ภาพ และ Git simulator เก็บพิกัด geometry, style, rotation, opacity, lock และเนื้อหาที่จำเป็นต่อการสร้างภาพกลับมา ทุกค่าเป็น JSON-serializable และตรวจด้วย Zod

ฐานข้อมูลเก็บ `ProjectDocument` เป็น JSONB ส่วนภาพที่ผู้ใช้แทรกเข้าบทเรียนเก็บเป็น binary ใน private Storage แล้วอ้างอิงด้วย asset ID ไม่ใส่ base64 image, DOM node, Konva instance, event listener, Blob URL หรือ signed URL ลง document ภาพ thumbnail เป็น derived local cache ที่ลบแล้วสร้างใหม่ได้ การบันทึก Drawing info ไม่ต้องสร้าง screenshot ลง DB

แยก state เป็นสามส่วน:

| State | อายุและหน้าที่ | Cloud document |
|---|---|---|
| Document | สไลด์, nodes, asset references และ Git state | บันทึก |
| Session | slide ที่เปิด, camera ต่อ slide, selection, tool, panel และ presentation mode | ไม่บันทึกลง cloud; camera/การตั้งค่าที่จำเป็นเก็บ local preference ได้ |
| Gesture | pointer samples, preview transform, marquee, text composition | ชั่วคราวจนยืนยันหรือยกเลิก |

world coordinates เป็นข้อมูลถาวร ใช้ camera แปลงระหว่าง world และหน้าจอ การ zoom ไม่เปลี่ยน geometry ไม่มีกรอบกระดาษบังคับใน Canvas แต่ค่าพิกัดต้องเป็น finite numbers และอยู่ในขอบเขต validation ของ [data contracts](../plan/02-architecture-and-data-contracts.md)

ระหว่าง pointer move ใช้ gesture preview และ animation frame; สร้าง document transaction เมื่อจบ gesture เท่านั้น หนึ่งการวาด ลากกลุ่ม Clone หรือ Git action ที่เปลี่ยน state เท่ากับหนึ่ง Undo ไม่มี history entry สำหรับ no-op, selection, camera และการเปิด panel

ใช้ Zustand เก็บ state และ Immer patches/inverse patches สำหรับ history ระดับโปรเจกต์สูงสุด 100 transactions พร้อมสไลด์ที่เกี่ยวข้อง การ Undo ข้ามสไลด์เปิดสไลด์ที่เกี่ยวข้องให้เห็นผล Redo คืน ID เดิมของวัตถุหรือ commit ไม่มีการสุ่ม ID ใหม่ การเปิดโปรเจกต์หลัง refresh เริ่ม history ว่าง แต่ document คืนมาจาก draft/cloud ได้ วิธีใช้ patches อ้างอิง [Immer](https://immerjs.github.io/immer/patches/)

geometry/bounds และ node renderer ต้องมี adapter กลางที่ใช้ร่วมกันใน selection, Fit content, thumbnails และ export ส่วนโหมด export ตัดเฉพาะ transient UI ออก แต่ต้อง render วัตถุที่อยู่พ้น viewport ได้ตาม [ADR 0006](0006-export-and-portable-projects.md)

## ผลกระทบและข้อจำกัด

- การเปิดไฟล์เดิมคืนวัตถุที่แก้ไขได้ครบ รวม locked nodes และสถานะ Git ไม่ขึ้นกับภาพ preview
- ต้องมี versioned schema และ migration แบบไม่ทำลายต้นฉบับเมื่อเพิ่มชนิดวัตถุในอนาคต รุ่นแรกปฏิเสธ schema version ที่ไม่รองรับอย่างชัดเจน
- ภาระสำคัญอยู่ที่ interaction, text/IME และ transforms จึงต้องตรวจรับก่อนเพิ่ม cloud หรือ polish หน้าเว็บ
- Infinite Canvas หมายถึงไม่จำกัดขนาดหน้าใน UX ไม่ได้หมายถึง browser มีหน่วยความจำไม่จำกัด; จำนวนวัตถุและ export มีเกณฑ์ตรวจรับที่ระบุไว้
- Whole-object eraser, ลูกศรไม่มี auto binding และ single-user editing เป็นขอบเขตรุ่นแรก ไม่เพิ่ม scene graph/grouping ขั้นสูงโดยไม่มีความต้องการ

## เงื่อนไขทบทวน

ทบทวนหากเวลาพัฒนา interaction สูงเกินประโยชน์ของ customization, ต้องการ collaboration ที่ library สำเร็จรูปช่วยได้มาก หรือ Canvas ไม่ผ่าน performance acceptance หลังแยก layers และลด rerender แล้ว การย้าย renderer ต้องคง Drawing info หรือมี migration ที่ทดสอบ round trip

## เอกสารอ้างอิง

ตรวจสอบเมื่อ **2026-09-24**

- [Konva — Save/load best practices](https://konvajs.org/docs/data_and_serialization/Best_Practices.html)
- [Excalidraw — Integration](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/integration)
- [tldraw — License](https://tldraw.dev/community/license)
- [Immer — Patches](https://immerjs.github.io/immer/patches/)
