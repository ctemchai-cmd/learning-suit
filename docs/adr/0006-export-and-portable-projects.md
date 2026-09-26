# ADR 0006 — Export ตามเนื้อหาและ portable projects

- สถานะการตัดสินใจ: **Accepted**
- วันที่ตัดสินใจ: **2026-09-24**
- สถานะการพัฒนาและหลักฐานตรวจรับ: ดู [Delivery and acceptance](../plan/06-delivery-and-acceptance.md)
- สเปกที่เกี่ยวข้อง: [Data contracts](../plan/02-architecture-and-data-contracts.md), [Persistence, security and export](../plan/05-persistence-security-and-export.md)

## บริบท

Canvas ไม่มีขอบหน้า ผู้ใช้จึงต้องการ Export โดยหาเนื้อหาทั้งหมดแล้วเว้นขอบรอบภาพ ขณะเดียวกันไฟล์ที่ใช้แชร์ภาพและไฟล์ที่นำกลับมาแก้ Drawing info มีหน้าที่ต่างกัน ต้องส่งออกทั้งสองแบบได้โดยไม่ทำให้การบันทึกโปรเจกต์ต้องสร้างภาพบน server

## ทางเลือกที่พิจารณา

| ทางเลือก | ข้อได้เปรียบ | ข้อแลกเปลี่ยน |
|---|---|---|
| Browser render จาก document + PNG/PDF และ archive | ทำงานกับ draft ที่โหลดแล้ว ไม่ต้องมี export backend | ใช้หน่วยความจำ browser และต้องรอ font/assets เลือกแนวทางนี้ |
| Screenshot viewport | ทำง่าย | ตัดวัตถุที่อยู่นอกจอและติด UI ไม่ตรง infinite Canvas |
| Vector SVG/PDF ทุกชนิดวัตถุ | zoom แล้วคมและอาจเลือกข้อความได้ | ต้องทำ renderer อีกชุด รวม Thai shaping และ Git node ให้ตรง Canvas |
| Server render | ควบคุม environment และรองรับงานใหญ่ได้ | ต้องอัปโหลดงาน/ภาพก่อน export มีค่าใช้จ่ายและต้องออนไลน์ |
| JSON อย่างเดียวสำหรับไฟล์โครงการ | อ่านง่ายและเล็กเมื่อไม่มีภาพ | อ้างอิงภาพในบัญชีเดิมจึงไม่ portable |

## การตัดสินใจ

แยกผลส่งออกสามแบบ: PNG สำหรับภาพ, PDF สำหรับหลายสไลด์ และ `.learning-suit` สำหรับนำกลับมาแก้ ทุกแบบสร้างใน browser แล้วดาวน์โหลด ไม่มีการเก็บผล PNG/PDF บน server เป็นส่วนหนึ่งของ Save แหล่งข้อมูลหลักยังเป็น Drawing info ตาม [ADR 0002](0002-custom-canvas-and-document-model.md)

### PNG และ PDF

สร้าง offscreen export stage จาก document snapshot เดียวกับตอนกด Export ใช้ node renderers และ bounds ร่วมกับ editor แต่ไม่ใช้ฉากปัจจุบันที่อาจ cull วัตถุนอก viewport ไม่มีการแก้ camera ของ editor หรือเปลี่ยน document ระหว่างส่งออก

Bounds ต้องรวม geometry หลัง transform, stroke, line caps และหัวลูกศร รวมวัตถุ Lock ของสไลด์ที่ export แต่ไม่รวม selection handles, marquee, grid, panel, editor textarea หรือ animation ชั่วคราว ขอบเริ่มต้น **48 world units** ปรับได้ตามแผน ใช้ bounds ทั้งสไลด์หรือ selection ที่เลือกก่อนเริ่ม export; selection ว่างไม่แอบเปลี่ยนเป็นส่งออกทุกวัตถุ

PNG ใช้สีพื้นสไลด์เป็นค่าเริ่มต้นและเลือกโปร่งใสได้ กำหนด pixel ratio เริ่มต้น **2** ตามความสามารถ export ของ [Konva](https://konvajs.org/docs/data_and_serialization/High-Quality-Export.html) ใช้ app cap ด้านยาว **8,192 pixels** และพื้นที่ **16,777,216 pixels** ต่อภาพ ค่าเหล่านี้เป็นขีดจำกัดของแอป ไม่ใช่คำรับรองว่าทุก browser มี limit เดียวกัน ถ้าเกินให้ลด ratio แบบรักษาสัดส่วนและเนื้อหาทั้งหมด พร้อมแสดงขนาดจริงที่ส่งออก; allocation/encoding ล้มเหลวต้องแจ้งและไม่ดาวน์โหลดภาพว่าง

PDF ใช้ `pdf-lib` ฝัง PNG ของแต่ละสไลด์ หนึ่งสไลด์ต่อหนึ่งหน้า เรียงตาม document ขนาดหน้าตาม content bounds + padding โดยรักษาสัดส่วน หน้าว่างใช้ **1280 × 720** เป็นขนาดผลลัพธ์ ไม่บวก padding ซ้ำ ไม่ใช่ A4 โดยอัตโนมัติ และข้อความยังเลือกไม่ได้ใน v1 การสร้างหน้าขนาดกำหนดเองและฝังภาพมีใน [PDFDocument API](https://pdf-lib.js.org/docs/api/classes/pdfdocument)

Render PDF ทีละหน้าแล้วคืน canvas/image resources เมื่อฝังภาพสำเร็จ `pdf-lib` ยังต้องถือข้อมูล PDF จนสร้างไฟล์เสร็จ จึงไม่อ้างว่าเป็น streaming export หรือใช้ memory คงที่ไม่ว่ามีกี่หน้า รายละเอียด cap และหน่วยขนาดหน้าอยู่ในแผน export

ก่อน export รอ font และ image assets ของ snapshot ให้พร้อม ถ้าภาพใดไม่มี binary ใน local cache และ cloud โหลดไม่ได้ ให้ระบุภาพที่ขาดและยกเลิกผลลัพธ์ ไม่ export ภาพแทนที่ว่างเงียบ ๆ ไฟล์ภาพที่รองรับ v1 คือ PNG/JPEG/WebP; ไม่รับ SVG หรือ external image URL ที่ไม่ได้ ingest เป็น asset

### Portable archive

ใช้ `fflate` สร้าง ZIP นามสกุล `.learning-suit` โดยโครงสร้างคงที่:

```text
manifest.json
document.json
assets/<asset-id>.<ext>
```

Manifest ระบุ format/version, metadata ของโปรเจกต์ และ asset entries; document มี versioned Drawing info พร้อม references ที่ใช้ใน archive รายละเอียด wire shape อยู่ใน [data contracts](../plan/02-architecture-and-data-contracts.md) ไม่รวม user ID, owner, auth token, cloud revision, signed URL หรือ undo/session state

Import ตรวจ format/schema, required files, IDs/references, จำนวน/ชนิดไฟล์ และ image decode ก่อนสร้างโปรเจกต์ ไม่รัน HTML/JavaScript หรือคำสั่งจากไฟล์ ZIP ไม่ดึง external URL จาก archive ตรวจและปฏิเสธ path traversal, absolute path, duplicate entries และรายการที่ไม่ตรง manifest

จำกัด archive compressed **50 MiB**, ผลรวมที่แตกแล้ว **100 MiB** และ **1,000 entries** พร้อมนับ bytes ระหว่าง decompress เพื่อหยุดก่อนจัดสรรเกิน ไม่เชื่อ header size อย่างเดียว; `fflate` มี streaming decompression สำหรับการควบคุมนี้ตาม [เอกสารโครงการ](https://github.com/101arrowz/fflate) หากไม่ผ่านให้รายงานสาเหตุโดยไม่แตะโปรเจกต์ที่เปิดอยู่

นำเข้าเป็นโปรเจกต์ใหม่ใน local draft แล้วส่ง cloud ตาม save queue สร้าง project/asset identifiers และ storage paths ใหม่ภายใต้ผู้ใช้ปัจจุบัน รวมทั้งปรับ references ที่เกี่ยวข้อง รักษา slide order, node properties/lock และ Git commit IDs/semantics ภายในแต่ละ simulator ไม่แชร์ asset path กับโปรเจกต์ต้นฉบับ

## ผลกระทบและข้อจำกัด

- PNG/PDF มีไว้เผยแพร่ภาพ; การแก้แต่ละวัตถุทำผ่านโปรเจกต์หรือ archive
- Export ขณะ offline สำเร็จเมื่อ document, font และทุกภาพที่จำเป็นพร้อมอยู่ในเครื่องเท่านั้น
- Raster PDF และการลด resolution สำหรับงานใหญ่เป็นข้อจำกัดที่ UI ต้องบอกตามจริง
- Portable archive ไม่ต้องพึ่งบัญชีเดิม และ import ไม่ overwrite โปรเจกต์ที่มีอยู่
- Version ที่ไม่รองรับต้อง fail ก่อนสร้างข้อมูล รุ่นแรกไม่พยายามเปิด future schema แล้วทิ้ง fields ที่ไม่รู้จัก

## เงื่อนไขทบทวน

ทบทวนเมื่อผู้ใช้ต้องการ selectable text/vector export, ส่งออกงานใหญ่เกิน cap เป็นประจำ, จำเป็นต้องมี server batch export หรือ archive เริ่มเกินขนาดที่ import บน browser ได้ การเพิ่มรูปแบบต้องมี round-trip และ visual acceptance ใหม่

## เอกสารอ้างอิง

ตรวจสอบเมื่อ **2026-09-24**

- [Konva — High quality export](https://konvajs.org/docs/data_and_serialization/High-Quality-Export.html)
- [pdf-lib — PDFDocument](https://pdf-lib.js.org/docs/api/classes/pdfdocument)
- [fflate — ZIP and streaming APIs](https://github.com/101arrowz/fflate)
