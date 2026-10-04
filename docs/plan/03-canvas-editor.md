# 03 — Canvas editor: interactions, geometry และ history

ข้อกำหนดนี้ทำให้การวาด เลือก Lock และ Clone ใช้คล่องบน Mac อ่าน [data contracts](02-architecture-and-data-contracts.md) ก่อน implement และใช้ [ADR 0002](../adr/0002-custom-canvas-and-document-model.md) เป็นเหตุผลการแยก model/renderer

## 1. Renderer และ coordinate system

Stage มีขนาดเท่า viewport ที่มองเห็น ใช้ ResizeObserver ไม่สร้าง canvas bitmap ขนาดเท่าโลกทั้งใบ ภายในแยกอย่างน้อย background/grid layer (ไม่รับ hit), document layer, transient preview และ selection overlay ทุก node renderer รับข้อมูลจาก document เท่านั้น

Grid พื้นหลัง (ปรับ 2026-09-26 ตาม feedback ให้เหมือน draw.io แล้วย่อให้ถี่ขึ้น): เส้นย่อยเส้นประจางทุก 10 หน่วยโลก และเส้นหลักทึบทุก 5 เส้นย่อย (50 หน่วย) ผูกกับพิกัดโลก เมื่อซูมออกจนเส้นย่อยห่างกันน้อยกว่า 8 px ระยะจะคูณ 5 ต่อไปเรื่อยๆ วาดเป็นเส้นบน screen space ใน layer ที่ไม่รับ hit และไม่ถูก export

```text
screen = world * camera.zoom + camera.translation
world  = (screen - camera.translation) / camera.zoom
```

หัก offset ของ DOM canvas ก่อนแปลง screen → world ทั้งการวาด เลือก ย้าย endpoint และ image drop ทดสอบบน Retina ด้วย CSS pixels แยกจาก backing-store pixel ratio

Pan ปรับ camera.x/y ส่วน zoom รอบ pointer ต้องรักษา world point เดิมให้อยู่ใต้ pointer หลังเปลี่ยน zoom:

```text
w = (pointer - oldTranslation) / oldZoom
newTranslation = pointer - w * newZoom
```

Camera ไม่แก้ node coordinates และไม่เข้าระบบ Undo/cloud save

ระหว่าง drawing/moving/cloning/transforming/erasing ให้งด wheel pan/zoom จน pointerup เพื่อรักษา coordinate frame ของ gesture ถ้า viewport resize ระหว่าง gesture ให้ cancel gesture ที่ยังไม่ commit ก่อนปรับ camera

### Zoom / pan mapping

- Wheel ที่ไม่มี modifier เลื่อนตาม deltaX/deltaY หลัง normalize deltaMode; Shift + wheel เปลี่ยน vertical delta เป็น horizontal หากอุปกรณ์ไม่ได้ส่ง deltaX
- Wheel ที่ `ctrlKey` (trackpad pinch) หรือ `metaKey` ซูมตาม `oldZoom * exp(-deltaY * 0.01)` แล้ว clamp 0.1–8; ไม่พยายามแยกเมาส์กับแทร็กแพดจาก user agent
- ป้องกัน browser default เฉพาะ wheel/pointer บน canvas ไม่ปิด zoom/scroll ของ textarea หรือ dialog
- Space + primary drag, middle-button drag หรือ Hand + primary drag เลื่อน camera; Space ระหว่างมี active stroke รอจน gesture จบ ไม่ตัดเส้นแล้วเริ่ม pan กลางคัน
- Fit content ใช้ content bounds รวม locked nodes เหลือ margin 48 CSS px; สไลด์ว่าง reset เป็น 1× และวาง world origin กลางจอ
- Reset 100% ซูมเป็น 1 โดยรักษา world point กลางจอ; resize viewport รักษา world point กลางจอเช่นกัน

## 2. Interaction state machine

ลำดับรับ input: focused text/dialog → active gesture ที่ capture pointer → Space/Hand pan → transform handle → tool ที่เลือก → selection บนวัตถุ/พื้นว่าง

ใช้ primary pointer เพียงตัวเดียวใน v1; `setPointerCapture` ตอนเริ่ม gesture, release เมื่อจบ หาก pointercancel/window blur/lost capture ผิดปกติ ให้ cancel gesture ที่ยังไม่ commit และคืนก่อนเริ่ม ไม่ทิ้งวัตถุครึ่งชิ้นใน document

| State | เริ่ม | Preview | จบ / ยกเลิก |
|---|---|---|---|
| freehand drawing | pointerdown ด้วย Pen/Highlighter | temporary points ตาม pointer | pointerup → insert เป็น 1 transaction; Escape/cancel → ทิ้ง preview |
| two-click drawing | คลิกจุดแรกด้วย Rect/Ellipse/Line/Arrow | temporary node จากจุดแรกถึง pointer แม้ปล่อยเมาส์แล้ว | คลิกจุดที่สอง → insert เป็น 1 transaction; Escape/เปลี่ยน tool → ทิ้ง preview |
| marquee | Select ลากพื้นว่าง | screen box และ derived IDs | pointerup → selection; ไม่มี document change |
| moving | ลาก selected/unselected unlocked node | เปลี่ยนตำแหน่งที่เห็นของ selection | pointerup → replace ทั้งหมดเป็น 1 transaction |
| cloning | Alt/Option มีค่าตอนเริ่มลาก node | ต้นฉบับคงเดิม แสดง previews ของสำเนา | pointerup → insert สำเนาชุดเดียว |
| transforming | drag handle | resize/rotation preview | pointerup → normalize geometry แล้ว replace |
| panning | Hand/Space/middle | camera ชั่วคราว | เมื่อจบ จำ camera ใน local ไม่มี history |
| erasing | Eraser ลากผ่าน freehand | ซ่อน stroke เป้าหมายใน preview | pointerup → remove ทั้งชุดเป็น 1 transaction |
| editing | Text หรือ Git file editor | DOM draft + local recovery | blur/action/Save/Export → flush; Escape → cancel |

Mutation ของ document และ snapshot ก่อนเริ่มอยู่แยกจาก preview ไม่แก้ Zustand document ทุก pointer move ใช้ refs + requestAnimationFrame และ commit เมื่อจบ

## 3. การวาดและ properties

### Pen และ Highlighter

เก็บจุดใน world coordinates ระหว่างวาด รับจุดใหม่เมื่อห่างจากจุดก่อนอย่างน้อย 0.8 CSS px หรือเป็น endpoint สุดท้าย จากนั้น normalize เป็น local points พร้อม x/y ของ stroke

หลังจบ stroke ใช้ Ramer–Douglas–Peucker ลดจุดด้วย tolerance `0.35 / zoomAtStart` world units และวาด polyline round cap/join (`tension=0`) ไม่ใช้ smoothing ที่ทำให้เส้นโค้งยื่นพ้น bounds โดยไม่มีการคำนวณรองรับ การคลิกไม่ลากสร้างจุดกลมขนาด strokeWidth; model อนุญาตหนึ่ง point และ renderer/bounds รองรับเหมือนกัน

Pen ใช้สี/ความหนาจาก tool defaults; Highlighter ใช้ opacity 0.25 และความหนา 16 ตาม constants เมื่อ Highlighter ซ้อนกันจะเข้มขึ้นตาม compositing ปกติ ไม่มี blending engine เพิ่มใน v1

### รูปทรง เส้น และลูกศร

- Rect/Ellipse คลิกจุดแรก → เลื่อน pointer ดู preview → คลิกจุดที่สองได้ทุกทิศ normalize width/height เป็นบวก; Shift ระหว่างกำหนดจุดที่สองสร้าง square/circle
- Line/Arrow คลิกจุดแรก → เลื่อน pointer → คลิกจุดที่สอง เก็บ start/end ตามทิศทางที่คลิก; Shift ระหว่างกำหนดจุดที่สอง snap มุมทีละ 45 องศา
- ลูกศรชี้ปลาย end และ stroke เป็นสีเดียวกับหัว; หัวมี base length 12 / width 10 world units ปรับตาม spec ผ่าน Properties ได้
- จุดแรกกับจุดที่สองห่างกันน้อยกว่า 3 CSS px ให้คง draft รอจุดที่สองใหม่ ไม่สร้างวัตถุขนาดศูนย์
- วาดสำเร็จแล้วกลับ Select และเลือกวัตถุใหม่ ยกเว้น Pen/Highlighter หรือ keepDrawing เปิดอยู่ (keepDrawing = “วาดต่อเนื่อง” จำไว้ใน localStorage ของเครื่องเหมือน tool defaults)
- การขัดจังหวะที่ผู้สอนไม่ได้ตั้งใจ (window blur เช่น Force Click/แอปแชร์จอดึงโฟกัส, pointercancel, lost capture) **เก็บเส้นปากกา/ไฮไลต์เท่าที่วาดไว้** ส่วน Escape เท่านั้นที่ทิ้งเส้น; กระดานเปลี่ยนขนาดระหว่างวาดเส้น (เช่นแถบแจ้งเตือนโผล่) วาดต่อได้เพราะจุดเป็นพิกัดโลก (ปรับ 2026-09-26 ตาม feedback “วาดวนๆ ปล่อยแล้วหาย”)
- Rect/Ellipse/Line/Arrow วาดแบบ **คลิก → เลื่อน → คลิก เท่านั้น** (ผู้สอนเลือก 2026-09-26 หลังเคยลองให้กดลากได้ด้วยแล้วสับสนเพราะผสมสองแบบ): การเคลื่อนที่ระหว่างกดไม่มีผล (แทร็กแพดขยับได้/เผลอลากก็ยังเป็นการวางจุด) คลิกแรกวางจุดเริ่มจากตำแหน่งที่กด คลิกที่สองจบเสมอ (`hadPending` จำจากตอนกด ไม่พึ่ง state) ระหว่างกดคลิกที่สอง preview ยังตามเมาส์
- กล่องแก้ไฟล์ของตัวจำลอง Git (DOM overlay) แสดงเฉพาะเครื่องมือ Select เครื่องมืออื่นจึงวาด/ขีดทับตัวจำลองได้แม้เลือกค้างไว้
- Tool defaults จำในอุปกรณ์; สี normalize เป็น `#RRGGBB`, no fill ใช้ literal `transparent`
- Properties ของ Rect/Ellipse มี checkbox `ใช้สีพื้น`; ปิดแล้วบันทึก `fill: "transparent"` และซ่อน color picker เปิดใหม่ใช้สีเริ่มต้นที่เห็นชัด

Floating Favorite Tools อยู่บน viewport ในพิกัดหน้าจอ เลื่อนตำแหน่งได้โดยลาก handle; ปักหมุด/ถอดเครื่องมือจาก toolbar หลัก รายการและตำแหน่งเก็บเฉพาะอุปกรณ์ ไม่เพิ่ม Undo หรือ cloud transaction

### Properties edit

Property slider/color picker preview ได้ต่อเนื่อง แต่ commit หนึ่งครั้งเมื่อปล่อย/ปิด picker ส่วน input ตัวเลข commit เมื่อ Enter หรือ blur; Escape คืนก่อนแก้ ตรวจค่าตาม limits ก่อนใช้

Mixed selection แสดงเฉพาะ properties ร่วมกันและ mixed indicator การแก้ค่าหนึ่งไม่เปลี่ยน fields ที่ไม่ได้แตะ เช่น เลือก rectangle กับ text มี opacity ร่วมกันแต่ไม่มี fill ร่วมกัน

## 4. Selection, lock และการจัดลำดับ

Hit test ใช้ reverse node order และ geometry จริง กรอบ rect/ellipse ที่ fill เป็น `transparent` ยังเลือกจากพื้นที่ภายในได้ Path ใช้ hit width `max(strokeWidth, 8 / zoom)`; handles คงขนาด 14 CSS px ไม่ขยายตาม zoom

- คลิก unlocked node ที่ไม่ได้เลือก → เลือกเฉพาะตัวนั้น; คลิกตัวที่อยู่ใน multi-selection → รักษาชุดเพื่อเริ่มลากพร้อมกัน
- Shift + คลิก toggle membership; Shift + ลาก node ที่ยังไม่ได้เลือก เพิ่ม node ก่อนแล้วเคลื่อนทั้ง selection
- คลิกพื้นว่างไม่ลาก → clear selection; Shift + คลิกพื้นว่างรักษาชุด
- Marquee ใช้ world AABB ตัดกับ bounds ของแต่ละ node (ไม่จำเป็นต้องครอบทั้งหมด); Shift + marquee รวมกับชุดเดิม
- Locked nodes ไม่เข้าผล hit/marquee/SelectAll และ pointer ทะลุไปหา unlocked node ด้านล่างได้; หากไม่มีให้เป็นพื้นว่าง
- Objects panel เรียง front-to-back; คลิกแถว unlocked เลือกและ highlight ทั้ง panel/Canvas, Shift + คลิก toggle selection มี tab `ทั้งหมด` / `ล็อกอยู่`; locked row ไม่เลือกจนปลดล็อก แต่มีปุ่ม unlock ได้เสมอ การ Lock selection ทำให้วัตถุถูกนำออกจาก selection หลัง transaction
- Commands จาก selection เก่าต้องตรวจ lock ซ้ำก่อน commit ถ้าไม่ valid ให้ cancel ทั้ง transaction ไม่ย้ายได้บางตัว

Cmd+A เลือก unlocked nodes ในสไลด์ปัจจุบัน ไม่เลือกวัตถุในสไลด์อื่น Cmd+L ล็อก selection; การปลดล็อกทำผ่าน Objects panel โดยไม่ต้องคลิกวัตถุบน Canvas

Bring forward/backward ขยับ selection ข้าม unselected เพื่อนบ้านหนึ่งระดับโดยรักษาลำดับภายใน selection ส่วน Bring to front/send to back ย้ายชุดเดียวโดยรักษาลำดับเดิม; model ใช้ nodes array ไม่เก็บ zIndex ซ้ำ

Objects panel มีปุ่ม `นำขึ้นบนสุด`, `ย้ายขึ้นหนึ่งชั้น`, `ย้ายลงหนึ่งชั้น`, `ส่งลงล่างสุด` เปิดใช้เฉพาะเมื่อเกิดการเปลี่ยนลำดับจริง คีย์ลัด `Cmd+]` / `Cmd+[` ขยับหนึ่งชั้น และเพิ่ม Shift เพื่อส่งสุดทาง หนึ่งการกดเป็นหนึ่ง document transaction และ selection คงอยู่หลังจัดลำดับ

## 5. Move, resize และ rotate

Move ใช้ delta ใน world จาก pointerdown กับ pointer ปัจจุบัน ประยุกต์ delta เดียวกับทุก node หนึ่งกลุ่มลากคือหนึ่ง transaction กด Shift ล็อกแกนที่เคลื่อนมากกว่าหลังผ่าน threshold

### Transform rules ตามชนิด

| Node | Single selection | Multi-selection |
|---|---|---|
| Rect/Ellipse | resize width/height ได้อิสระ; Shift รักษาสัดส่วน; rotate ได้ | uniform scale และ rotate |
| Pen/Highlighter | scale points ตามกรอบ, rotate ได้; strokeWidth คงเดิม | uniform scale และ rotate |
| Line/Arrow | endpoint handles + rotation; หัว/ความหนาคงเดิม | uniform scale/rotate positions และ points |
| Text | side handles ปรับ width และ reflow; เปลี่ยน fontSize ใน Properties; rotate ได้ | uniform scale ปรับ width/fontSize ด้วย |
| Image | corner handles resize โดยรักษาสัดส่วนเสมอ, rotate ได้ | uniform scale/rotate |
| ภาพประกอบ (stencil) | 8 จุดจับ resize อิสระเหมือน Rect, rotate ได้ (ไอคอนคงสัดส่วนภายในกรอบเอง) | uniform scale/rotate |
| ตาราง / กล่องคลาส | จุดจับซ้าย/ขวาปรับความกว้างทั้งตาราง (ทุกคอลัมน์คงสัดส่วน) ความสูงตามข้อความ; ลากเส้นแบ่งคอลัมน์ปรับทีละคอลัมน์; rotate ได้ | uniform scale ปรับคอลัมน์และขนาดตัวอักษร |
| Git simulator | corner handles ทำ uniform scale อย่างเดียว | uniform scale ได้; ปิด rotation ทั้ง selection หากมี Git |

Resize ไม่มี flip ใน v1; ถ้าลากข้าม minimum ให้ clamp ไม่ให้ width/height ติดลบ จุดจับเป็น DOM overlay ในพิกัด screen เพื่อให้กดง่ายและมีขนาดคงที่ขณะซูม โดยใช้ pure geometry แปลง pointer กลับ world/local แล้ว normalize ลง model ไม่ serialize จุดจับลง document ในช่วงแรก Rect/Ellipse ที่เลือกเดี่ยวมี 8 จุดจับรอบกรอบ, Line/Arrow มีจุดต้น/ปลาย; ด้านหรือมุมตรงข้ามอยู่ที่เดิมระหว่างลาก Shift + corner รักษาสัดส่วน และ Shift + endpoint snap 45 องศา หนึ่ง gesture เป็นหนึ่ง Undo; Escape/pointercancel/window blur คืนค่าเดิม ก่อนปิด M2.5 ยังต้องเพิ่ม Text/Image/Git, multi-transform และ rotation ตามตารางข้างบน โดย rotation ต้องหมุนได้อิสระและ Shift snap ทีละ 15 องศา

Multi-selection scale/rotate ใช้จุดศูนย์กลางกรอบรวมและแปลง origin ของแต่ละ node พร้อม geometry ต้องไม่เขียน shear ลง data หากชน min/max ของ node ใดให้ clamp gesture ทั้งชุดที่ขอบเขตเดียวกัน

## 6. Clone และ clipboard

Option + drag ตรวจ modifier ตอน pointerdown ของ node; เมื่อระยะเกิน 3 CSS px ให้ต้นฉบับแสดงอยู่ตำแหน่งเดิมตลอด gesture และแสดงสำเนาชั่วคราวตาม pointer โดยยังไม่แก้ document ปล่อยเมาส์ครั้งเดียวจึงสร้าง IDs ใหม่และ insert เป็น transaction เดียว ไม่ต้องคลิกวางซ้ำ สำเนา clone ด้วย deep copy ทุกรายการ, Git state แยกจากต้นฉบับ, assets เดิมอ้างซ้ำภายใน project ได้ ปล่อย Option กลาง gesture ไม่เปลี่ยนโหมดและไม่สร้าง copy เพิ่ม Escape ทิ้งสำเนาทั้งชุด ต้นฉบับไม่ขยับ

Cmd+D เพิ่มสำเนาของ selection ออฟเซ็ต (24, 24) world แล้วเลือกชุดใหม่ Cmd+C เก็บ validated clipboard payload ของ selection ในหน่วยความจำแอป; Cmd+V วางในสไลด์ปัจจุบันด้วย offset 24 และเพิ่ม offset ในการวางซ้ำ เก็บ relative positions/z-order เดิม

Cross-slide ภายในโปรเจกต์รองรับแน่นอน Cross-project ใน session เดียวให้ ingest/remap assets ก่อน insert; หาก bytes ต้นฉบับไม่พร้อมให้แจ้งและไม่ insert บางส่วน หลัง reload ไม่รับประกันว่า internal clipboard ยังอยู่

ใช้ paste event เพื่อรับ image จาก system clipboard เมื่อไม่มี text editor focus อยู่ การ copy วัตถุภายในแอปไม่ต้องขอ clipboard permission และไม่เขียน system clipboard ใน UI ระบุ `คัดลอกวัตถุในแอป` ไม่อ้างว่าวางวัตถุใน Photoshop ได้

## 7. Text, image และ Git integration

### Text

Text tool คลิกตำแหน่งแล้วเปิด textarea ตรงตำแหน่ง world บนจอ Node ใหม่ยังเป็น pending draft จน flush ข้อความใหม่ที่ว่างให้ยกเลิก; หาก node เดิมลบข้อความจนว่างแล้ว flush ให้ลบ node เป็นหนึ่ง transaction

ใช้ font และ line-height เดียวกับ Canvas โดย textarea มี width ตาม node; positioning/rotation/zoom ต้องตรง renderer และข้อความต้นฉบับไม่วาดทับระหว่าง edit รอ `document.fonts.ready` ก่อน measure/export รองรับ compositionstart/end และไม่ commit ระหว่าง IME ยัง composing

Enter ขึ้นบรรทัดใหม่, Cmd+Enter จบการแก้, Escape ยกเลิก Native Undo ของ textarea ทำงานขณะ focus; blur หรือกด Save/Export/เปลี่ยน slide ต้อง flush ก่อน โดยหนึ่ง edit focus เป็นหนึ่ง document transaction

Persist pending draft ตาม [persistence](05-persistence-security-and-export.md) หาก refresh ให้คืน editor พร้อม draft ไม่อ้างว่า text ที่ยังไม่ flush ขึ้น cloud แล้ว

### Image

รองรับ PNG/JPEG/WebP จาก file picker/drop/paste ตรวจ MIME + decode + limits ก่อน insert ไม่ใช้ external URL โดยตรง เมื่อ image พร้อมให้ write blob ลง local assets ก่อน transaction `assets.register` + `nodes.insert`

ตำแหน่ง drop ใช้ world ใต้ pointer; paste/file picker ใช้กลาง viewport ขนาดเริ่มต้นลดสัดส่วนให้พอดี 60% ของ viewport โดยไม่ขยายเกิน natural pixels การ select/resize ไม่แก้ binary bytes ส่วน export รอ decode ครบ

### ภาพประกอบ (stencils)

เพิ่ม 2026-09-26 ตาม feedback หลังใช้สอนจริง: node ชนิด `stencil` `{kind, width, height, color, label}` สำหรับวาด diagram เร็วๆ — **อุปกรณ์/หน้าต่าง** (หน้าต่าง Browser ที่มีแถบ URL, หน้าจอมือถือ, โน้ตบุ๊ก, หน้าต่างแอป, Terminal, หน้าต่างโค้ดที่มีแท็บชื่อไฟล์ + เลขบรรทัด) ยืดได้ทุกขนาดให้ผู้สอนวาดข้างใน และ **ไอคอน** 16 แบบ (เซิร์ฟเวอร์, ฐานข้อมูล, คลาวด์, อินเทอร์เน็ต, ผู้ใช้, คอมพิวเตอร์, มือถือ, ไฟล์, โฟลเดอร์, โค้ด, Git, ความปลอดภัย, กุญแจ, AI, API …) ที่คงสัดส่วนในกรอบพร้อมคำใต้ไอคอน แคตตาล็อกอยู่ที่ `src/domain/document/stencils.ts` วาดด้วย Konva (`stencil-view.tsx`, ไอคอน Lucide เป็น path) จึงเหมือนกันทั้ง editor/export

- เปิดหน้าต่างเลือกด้วยปุ่ม “ภาพประกอบ” ในแถบเครื่องมือ (ปักหมุดเป็นเครื่องมือโปรดได้) หรือคีย์ `I`; คลิกหนึ่งครั้งวางกลาง viewport ขนาดเริ่มต้นและเลือกไว้ (ชิ้นชนิดเดียวกันที่อยู่ตำแหน่งเดิมพอดีจะถูกเลื่อน 32 หน่วย) หนึ่งครั้งเป็นหนึ่ง Undo
- Properties: สี และข้อความหนึ่งบรรทัด ≤ 60 ตัวอักษร (ชื่อช่องตามชนิด: ที่อยู่เว็บ/ชื่อหน้าต่าง/ชื่อไฟล์/ข้อความบนจอ/คำใต้ไอคอน); Objects แสดงชื่อไทย + ข้อความ
- “ล้างสิ่งที่วาดทั้งหมด” ลบภาพประกอบด้วย (ปรับตาม feedback 2026-09-26; รูปภาพและตัวจำลองยังไม่ถูกล้าง); schema strict ปฏิเสธ kind ที่ไม่รู้จักและข้อความหลายบรรทัด

### ตารางและกล่องคลาส (tables)

เพิ่ม 2026-09-26: node `table` `{variant: grid|class, columns[], rows[{cells[], divider}], header, headerFill, stroke, color, fontSize}` — ตารางปกติ (แถวหัวเปิด/ปิดได้, เส้นทุกแถว/คอลัมน์) และกล่องคลาส/ตารางฐานข้อมูล (คอลัมน์เดียว, แถวแรกเป็นชื่อกึ่งกลางบนแถบสี, ไม่มีเส้นระหว่างบรรทัด มีแต่เส้นใต้ชื่อและเส้นแบ่งส่วนที่เลือกใส่) ความสูงแถวคำนวณจากข้อความที่ตัดบรรทัดด้วย metrics เดียวกับ text node (`src/domain/document/table.ts`) จึงตรงกันทั้งกระดาน/hit/export; ขีดจำกัด 60 แถว 12 คอลัมน์ ช่องละ ≤ 500 ตัวอักษร คอลัมน์กว้าง ≥ 40

- เพิ่ม: เครื่องมือ “ตาราง” (3×3 มีหัว) หรือหน้าต่างภาพประกอบ → “ตาราง” / “กล่องคลาส / ตารางฐานข้อมูล”; วางกลางจอและเริ่มพิมพ์ช่องแรกทันที (ข้อความตัวอย่างถูกเลือกไว้ พิมพ์ทับได้เลย)
- พิมพ์: ดับเบิลคลิกช่อง (หรือคลิกช่องอื่นของตารางเดิมระหว่างพิมพ์) → textarea ทับช่อง ตารางขยายตามข้อความสด; Tab/⇧Tab ช่องถัดไป/ก่อนหน้า (Tab ช่องสุดท้ายเพิ่มแถว), Enter ช่องด้านล่าง (สุดตารางเพิ่มแถว; กล่องคลาสเพิ่มบรรทัดใต้บรรทัดปัจจุบัน), ⇧Enter ขึ้นบรรทัดในช่อง, Esc ยกเลิกช่องนี้, ⌘Enter จบ; ย้ายไปช่องใหม่จะเลือกข้อความทั้งช่อง (เหมือน Word/Excel); หนึ่งช่องเป็นหนึ่ง Undo
- คลิกขวาที่ช่อง: เพิ่มแถวบน/ล่าง, เพิ่มคอลัมน์ซ้าย/ขวา, ลบแถว/คอลัมน์ (เหลืออย่างน้อย 1); กล่องคลาส: เพิ่ม/ลบบรรทัด, ใส่/เอาเส้นแบ่งส่วน (ชื่อกล่องลบไม่ได้)
- Properties: สีเส้น, สีหัวตาราง (ตัวอักษรหัวเลือกดำ/ขาวให้อ่านง่ายเอง), สีตัวอักษร, ขนาดตัวอักษร 10–72, แถวหัวเปิด/ปิด (ตาราง), ปุ่มเพิ่มแถว/คอลัมน์
- “ล้างสิ่งที่วาดทั้งหมด” ลบตาราง/กล่องคลาสด้วย; ยังไม่มีการกู้ข้อความในช่องที่พิมพ์ค้างหลัง crash (บันทึกเมื่อออกจากช่อง/บันทึก/เปลี่ยนสไลด์)

### บล็อกโค้ด (code)

เพิ่ม 2026-09-26: node `code` `{code, language: python|javascript|sql|html|plain, theme: dark|light, fontSize 10–48, lineNumbers}` ฟอนต์ JetBrains Mono (self-hosted, ภาษาไทยในโค้ดใช้ Noto Sans Thai แทน) มีแถบหัวสามจุด + ชื่อภาษา, เลขบรรทัด, สีตามไวยากรณ์ (`src/domain/document/code.ts`: tokenizer ทั้งก้อนแล้วแบ่งบรรทัด comment/string หลายบรรทัดได้; ข้อความที่อยู่ติดกันสีเดียวกันรวมเป็นชิ้นเดียว) ขนาดกล่องมาจากบรรทัดที่ยาวสุด × ขนาดตัวอักษร (เชิงเส้น) ขีดจำกัด 10,000 ตัวอักษร 300 บรรทัด

- เพิ่ม: เครื่องมือ “บล็อกโค้ด” หรือหน้าต่างภาพประกอบ → ตัวอย่าง Python ถูกเลือกไว้ พิมพ์ทับได้ทันที
- พิมพ์: textarea ตัวอักษรโปร่งใสทับกล่อง กระดานด้านล่างแสดงสีตามไวยากรณ์สดตำแหน่งเดียวกัน; Tab/⇧Tab เยื้อง/ถอยทีละ 4 ช่อง (เลือกหลายบรรทัดได้), Enter เยื้องตามบรรทัดบน และลึกขึ้นหลัง `:` (Python) `{ ( [` (JS/SQL) หรือแท็กเปิด (HTML), แท็บที่วางถูกแปลงเป็น 4 ช่องว่าง, Esc ยกเลิก, ⌘Enter/คลิกที่อื่นบันทึก (หนึ่ง Undo) ใช้ `execCommand("insertText")` เพื่อให้ Undo ในช่องพิมพ์ทำงาน (การลบเป็นว่างใช้ `setRangeText` เพราะ WebKit ลบขึ้นบรรทัดเกิน); ร่างเก็บเป็น pending edit ชนิด `code` เปิดกลับมาหลัง reload/crash
- ปรับขนาด: จุดจับมุมเปลี่ยนขนาดตัวอักษร (มุมตรงข้ามอยู่ที่เดิม), หมุนได้; Properties: ภาษา, ธีมมืด/สว่าง, ขนาด, เลขบรรทัด
- “ล้างสิ่งที่วาดทั้งหมด” ลบบล็อกโค้ดด้วย

### ตัวหนาในกล่องข้อความ

`bold?: boolean` บน text node (ทั้งกล่อง ไม่มีตัวหนาบางคำ) — ปุ่ม “ตัวหนา” ใน Properties หรือ ⌘B ตอนเลือกกล่อง/ตอนพิมพ์; การวัดความสูง/ตัดบรรทัดใช้น้ำหนักตัวอักษรเดียวกับที่วาด

### กลุ่ม (groups)

เพิ่ม 2026-09-26: `groupId` (optional) บนทุก node หนึ่งชั้น ไม่ซ้อน — คลิกวัตถุในกลุ่มหรือลาก marquee ได้ทั้งกลุ่ม แล้วย้าย/ย่อขยาย/หมุนด้วย multi-selection เดิม; ดับเบิลคลิกเลือกชิ้นเดียวในกลุ่ม; คลิกขวา “จับกลุ่ม N ชิ้น” / “แยกกลุ่ม” หรือ ⌘G / ⌘⇧G (หนึ่ง Undo); วัตถุที่ล็อกไม่เข้าร่วม; สำเนา (⌘D, ⌥ลาก, วาง, ทำสำเนาสไลด์) ได้กลุ่มใหม่ของตัวเอง สำเนาชิ้นเดียวไม่มีกลุ่ม; Objects แสดงป้าย “กลุ่ม”

### ลูกศรเชื่อม (connectors)

เพิ่ม 2026-10-02 ตาม feedback (แบบ draw.io): เลือกวัตถุหนึ่งชิ้น (สี่เหลี่ยม วงกลม ข้อความ รูป ภาพประกอบ ตาราง โค้ด) จะมีจุดเชื่อมสีฟ้ารอบวัตถุ (ดูด้านล่าง) ลากออกไป = เส้นประตัวอย่าง; ปล่อยบนวัตถุอื่น (วัตถุนั้นขึ้นกรอบฟ้า) = ลูกศรติดทั้งสองฝั่ง, ปล่อยที่ว่าง = ปลายลอย; หนึ่งการลากหนึ่ง Undo; ลูกศรใช้ค่าเริ่มต้นของเครื่องมือเส้น
- ข้อมูล: `startBinding`/`endBinding` `{nodeId, anchor: n|e|s|w|auto|fixed, at?, side?}` บน line/arrow (optional); ปลายที่ลากจากจุดเชื่อมเป็น `fixed`; ปลายที่ปล่อยบนวัตถุแต่ไม่ใกล้จุดเป็น `auto` = จับด้านที่หันเข้าหาอีกฝั่งเสมอ (ด้านที่ใกล้จุดกลางของวัตถุอีกฝั่ง/ปลายลอย)
- ตามวัตถุ: ทุก transaction (รวมของผู้เรียนในห้องวาดร่วมที่เครื่องครู) ผ่าน `withConnectorUpdates` ที่คำนวณตำแหน่งปลายลูกศรที่ติดกับวัตถุที่เปลี่ยน แล้วต่อท้ายเป็น `nodes.replace` ใน transaction เดียวกัน (Undo ครั้งเดียว, บันทึก/ส่งออกได้ค่าจริง); ใช้ metrics ของ Konva จึงตรงกับที่วาด; ลูกศรที่ล็อกไม่ขยับ
- ลบวัตถุปลายทาง = ปลายนั้นหลุดอยู่ที่เดิม; ลากปลายลูกศร (จุดจับต้น/ปลาย) ไปวางบนวัตถุ = ติดวัตถุนั้น, วางที่ว่าง = หลุด; ย้ายทั้งลูกศรที่ติดอยู่ = ปลายที่ติดกลับไปที่วัตถุ
- คัดลอก (ทำสำเนา/วาง/⌥ลาก/ทำสำเนาสไลด์) ผ่าน `copyNodes`: ลูกศรติดกับวัตถุที่ถูกคัดลอกไปด้วยเท่านั้น ที่เหลือหลุด
- **จุดเชื่อมหลายจุด** (ปรับ 2026-10-02/03 ตาม feedback “4 จุดน้อยไป” และ “จุดมี 2 แบบ ระยะไม่เท่ากัน”): จุดเชื่อมของวัตถุ (`connectionPoints`) = กล่องด้านละ 3 จุด (1/4, กลาง, 3/4) รวม 12, วงรี 12 จุดทุก 30°; วัตถุที่เลือกแสดงจุดกลมสีฟ้าแบบเดียวกันทุกจุด ห่างเส้นขอบ 14 px บนจอเท่ากันหมด (พ้นจุดย่อขยาย และต่ำกว่าจุดหมุนที่ 28 px) — ลากจากจุดไหน ลูกศรเริ่มและติดที่จุดนั้น (`anchor: "fixed"`, `at` 0–1 ของกรอบ); ไม่แสดงตอนแค่ชี้ และไม่วางบนเส้นขอบ เพราะรูปที่ไม่มีสีพื้นต้องจับที่เส้นขอบเพื่อย้าย (ลองแบบแสดงตอนชี้บนขอบแล้ว จับย้ายไม่ได้); `anchor` แบบด้าน/`auto` ยังใช้เมื่อปล่อยบนวัตถุแต่ไม่ใกล้จุด
- **จุดเชื่อมรายบรรทัด** (เพิ่ม 2026-10-04 ตาม feedback “กล่องคลาสแต่ละบรรทัดมีจุดของตัวเองแบบ draw.io”): ตาราง/กล่องคลาสมีจุดที่ปลายซ้ายและขวาของทุกบรรทัด (กลางความสูงของบรรทัด) + บน/ล่างด้านละ 3 จุด; ปลายที่ติดบรรทัดเก็บ `row` คู่กับ `at` → บรรทัดสูงขึ้น/ตัวอักษรใหญ่ขึ้นลูกศรตามกลางบรรทัดเดิม; เพิ่ม/ลบบรรทัดด้านบน = ตามบรรทัดเดิมไป (แถวเดิมเป็น object เดิม หรือข้อความเดียวกันที่ใกล้ที่สุด กรณีข้อมูลมาจากห้องวาดร่วม); บรรทัดนั้นถูกลบ = ไปบรรทัดสุดท้ายที่เหลือ
- ปล่อยปลายลูกศร (ทั้งตอนสร้างและตอนลากจุดจับปลาย) ใกล้ × ของวัตถุปลายทาง ≤ 14 px บนจอ = ติดที่จุดนั้น (วงกลมฟ้า) ไม่งั้นทั้งวัตถุขึ้นกรอบฟ้า = `auto`; ทุกปลายที่ติดเก็บ `side` (ทิศที่ออกจากวัตถุ, คำนวณใหม่พร้อมตำแหน่ง)
- **ตามขณะลาก** (feedback “ตอนลากอยากให้อัปเดต”): ระหว่างลากย้าย/ย่อขยาย/ขยับด้วยลูกศร/พรีวิวคุณสมบัติ ลูกศรที่ติดอยู่ถูกจัดใหม่ในภาพทันที (`withLiveConnectors` บน displayNodes, ยกเว้นเส้นที่ถูกลากเอง) ค่าที่บันทึกยังมาจาก `withConnectorUpdates` ตอนปล่อย
- **รูปแบบเส้น** (feedback “ปรับ line แบบ draw.io ไม่ได้ เส้นตรงอย่างเดียว”): `route` = ตรง (ค่าเริ่มต้น ไม่มีฟิลด์) / หักฉาก `elbow` / โค้ง `curved` ที่แถบปรับค่าด่วนและแผง Properties (`connector-route.ts`): หักฉากออกจากวัตถุตาม `side` ยาว 20 แล้วเลี้ยวมุมฉาก (คนละแกน = มุมเดียว, แกนเดียวกัน = มีช่วงกลาง), โค้ง = Bézier ตามทิศเดียวกัน; ช่วงกลางของหักฉากมีจุดจับสีส้มลากเลื่อนได้ (`bend`, ดับเบิลคลิก = กลับกึ่งกลาง); ลูกศรที่ลากจากจุดเชื่อมเริ่มเป็นหักฉาก ส่วนเครื่องมือลูกศร/เส้นยังเป็นเส้นตรง; ขอบเขต (เลือก/ส่งออก) ใช้เส้นทางที่วาดจริง
- ข้อจำกัด: หักฉากไม่อ้อมวัตถุที่ขวาง (จุดเชื่อมตายตัวที่หันออกจากอีกฝั่งอาจลากผ่านวัตถุตัวเอง)

### แถบปรับค่าด่วน (quick properties)

เพิ่ม 2026-10-02: เลือกวัตถุ (เครื่องมือเลือก) แล้วมีแถบลอยหน้าตาเหมือนแถบเครื่องมือโปรด (`quick-properties.tsx`) ปุ่มตามชนิดที่เลือกทุกชิ้นรองรับ: สีเส้น, สีพื้น (มี “ไม่มีสีพื้น”), ความหนา (1/2/3/5/8), เส้นประ, สีหัวตาราง, สีตัวอักษร/สีภาพประกอบ, A−/A+ (×1.15 ต่อชิ้น), ตัวหนา, ธีมโค้ด แล้วตามด้วย ล็อก และ ลบ; สีเลือกจากแผง 10 สี + เลือกเอง; ใช้ตรรกะเดียวกับแผง Properties (`property-fields.ts`), หนึ่งคลิกหนึ่ง Undo
- ตำแหน่ง: เหนือกรอบที่เลือก (เลยจุดจับหมุน) ถ้าไม่พอไว้ด้านล่าง ไม่งั้นกลางบนของกระดาน — ไม่ทับวัตถุที่เลือกและแถบเครื่องมือโปรด; ลากที่จับไปวางเอง = อยู่ตรงนั้นเฉพาะการเลือกครั้งนี้ (ปรับค่าได้ไม่เด้ง) ยกเลิกการเลือกแล้วเลือกใหม่ = กลับไปวางอัตโนมัติใกล้วัตถุ (ปรับ 2026-10-02 ตาม feedback; ดับเบิลคลิกที่จับก็กลับได้)
- ซ่อนระหว่างลาก/ย่อขยาย/ขยับด้วยลูกศร/ลากกรอบเลือก และตอนพิมพ์ในข้อความ/ตาราง/โค้ด; อยู่บนกระดานจึงเป็นสีสว่างทุกธีม

### เมื่อการลากถูกขัดจังหวะ

ปรับ 2026-09-27: หน้าต่างเสียโฟกัส (เช่น แอปแชร์หน้าจอ), pointercancel, lost capture หรือกระดานเปลี่ยนขนาดระหว่างลาก = **เก็บสิ่งที่ทำถึงตอนนั้น** (เส้นปากกา, ตำแหน่งที่ย้าย/สำเนา ⌥ลาก, ขนาด/มุมจากจุดจับ) ไม่เด้งกลับ มีแต่ Esc ที่ยกเลิก; แถบแจ้งเตือน (บันทึกไม่สำเร็จ, อ่านอย่างเดียว, ฯลฯ) ลอยทับมุมขวาบนของกระดานแทนการดันกระดาน

### Snap และเส้นช่วยจัดแนว

เพิ่ม 2026-09-26: ระหว่างลากย้ายวัตถุ ขอบซ้าย/กลาง/ขวา และบน/กลาง/ล่างของกรอบที่ลากดูดเข้าเส้นเดียวกันของวัตถุอื่นในจอ (ระยะ 6 px บนจอ, ตัวใกล้สุดชนะ) พร้อมเส้นชมพูบอกแนว ถ้าไม่มีให้ดูด มุมซ้ายบนของกรอบเข้า grid ย่อยที่มองเห็น (10 หน่วยที่ 100%) Shift ล็อกแกนยังใช้ได้ (แกนที่ล็อกไม่ถูกดูด) กด ⌘/Ctrl ค้างหลังเริ่มลากเพื่อย้ายอิสระ (`src/domain/document/snap.ts`)

### Git widget

Insert จากเมนูเพิ่มวัตถุเป็น node เดียว ขนาด 1120 × 680 คูณ scale (ขั้น 3 กว้าง 1600; เปลี่ยนขั้นแล้วกล้องซูมออก/เลื่อนให้เห็นทั้งชิ้น) เลือกครั้งแรกแสดง Git panel ซึ่งเรียก pure actions ของ [Git spec](04-git-simulator.md) และกล้องซูมออก (ไม่ซูมเข้า) ให้เห็นทั้ง widget ในส่วนของกระดานที่แผง overlay ไม่บัง; widget ใหม่เลื่อนออกจากตำแหน่ง widget เดิมที่ซ้อนกัน เมื่อเลือก widget เดียว จะมี DOM overlay สำหรับแก้ไฟล์และปุ่มดู commit ทับตำแหน่งบนภาพ (ซ่อนระหว่างลาก/ปรับขนาด) Nodes ย่อยบนการ์ดไม่เป็น ordinary Canvas nodes และไม่ลบ commit circle ทีละอันผ่าน Delete

Clone/duplicate widget ต้อง copy state อย่างอิสระ เมื่อ widget ถูก Lock ต้องปลดล็อกก่อนทั้งการแก้ไฟล์ การดู commit และการเรียก Git actions โดยปลดล็อกผ่าน Objects panel เท่านั้นเช่นเดียวกับ node อื่น Objects panel ไม่เปิดทางเลือก widget ที่ยัง Lock อยู่

## 8. Keyboard และ focus

| Key | Action เมื่อ editor/canvas มี focus |
|---|---|
| V/H/P/R/O/A/T | Select/Hand/Pen/Rectangle/Ellipse/Arrow/Text |
| Shift+P / L / E | Highlighter / Line / Eraser (L และ E ใช้ได้ทั้งมีและไม่มี Shift) |
| คลิกขวา / ⌃คลิก | เมนูกระดาน (เพิ่ม 2026-09-26): มีวัตถุที่เลือก → ทำสำเนา, คัดลอก, นำขึ้นหน้าสุด/ส่งไปหลังสุด, ล็อก, ลบ; ไม่มี → วาง, เลือกทั้งหมด; เสมอ → “ล้างเส้นปากกา/ไฮไลต์ (N)” และ “ล้างสิ่งที่วาดทั้งหมด (N)” (เส้น รูปทรง เส้น/ลูกศร ข้อความ ภาพประกอบ ตาราง; ไม่ลบรูปภาพ ตัวจำลอง และวัตถุที่ล็อก) เป็น transaction เดียว Undo ได้; เครื่องมือเลือก: คลิกขวาที่วัตถุ = เลือกวัตถุนั้นก่อน; ⌃คลิกไม่วาดจุด; ใน editor DOM (ข้อความ/ไฟล์ Git) ใช้เมนูของเบราว์เซอร์ |
| 1 – 8 | เครื่องมือโปรดตามลำดับในแถบ (อ่าน `event.code` Digit1–8 จึงใช้ได้กับแป้นไทย) รูปภาพ = เปิดตัวเลือกไฟล์; ลำดับเครื่องมือโปรดสลับได้โดยลากไอคอนในแถบ (เกิน 6 px = ลาก คลิกเฉยๆ = เลือก) หรือ ⌥←/→ บนปุ่มที่โฟกัส เก็บใน localStorage |
| K | Laser pointer: จุดแดงตามเมาส์ + หางที่จางเองใน 0.7 วินาที วาดเป็นเส้นโค้งต่อเนื่อง (quadratic ผ่านจุดกึ่งกลาง, ไล่ความหนา/สีเป็นช่วง ไม่ใช่จุดต่อกัน) (SVG overlay, session-only) ไม่วาด ไม่เลือก ไม่เข้า Undo/Save/Export; จุดค้างเมื่อเมาส์นิ่งและหายเมื่อออกจากกระดาน |
| Cmd+Z / Cmd+Shift+Z | Undo / Redo |
| Cmd+S | Flush edit แล้วส่ง save queue ทันที; ระหว่าง active pointer gesture ให้ตั้ง `pendingSave` และรอ pointerup โดยไม่บังคับจบ stroke; ไม่เปิด Save Page ของ browser |
| Cmd+C/V/D/A/L | Internal copy/paste/duplicate/select all/lock |
| Backspace/Delete | ลบ selection ที่ unlocked เป็นหนึ่ง transaction |
| Arrow / Shift+Arrow | nudge 1 / 10 world units; key repeat ในชุดเดียวก่อน keyup เป็นหนึ่ง transaction |
| Escape | cancel draft/gesture → close popover → clear selection ตามบริบท |
| Space | pan ชั่วคราวและคืน tool หลังปล่อย |
| PageUp/PageDown | เปลี่ยน slide เมื่อไม่มี DOM editor/dialog รับ keys |
| ? | เปิด shortcut help |

ไม่ intercept copy/paste/delete/letters/undo ภายใน input/textarea/contenteditable ส่วน Modal ใช้ focus trap ของ Radix รองรับ Ctrl equivalents เมื่อไม่มี metaKey แต่ Mac เป็นเป้าหมายหลัก

Save/Export ระหว่าง gesture ให้รอ pointerup หรือ cancel ตามปุ่มของ UI ห้าม serialize preview ครึ่งทาง สำหรับ Cmd+S ใน gesture ที่ยังมี pointer กดอยู่ให้ตั้ง `pendingSave` แล้วทำหลัง pointerup โดยไม่บังคับจบ stroke

## 9. Bounds และ rendering performance

`getNodeBounds` คืน world AABB หลัง rotation รวม stroke และ arrow triangle ข้อความใช้ font metrics จริงและ ellipsis ไม่เปลี่ยน bounds ของ Text node ปกติ Git ใช้ full widget rect; opaque หรือ locked ก็รวมตามเดิม

ใช้ bounds เดียวกันใน marquee, Fit, export; ไม่รวม selection handles และ grid ส่วน bounds สำหรับ round caps ขยายด้วย strokeWidth/2 การ rotate กรอบ stroke ใช้ conservative AABB ที่ครอบครบได้แม้มี whitespace เพิ่มเล็กน้อย

Renderer ทำ viewport culling สำหรับ document nodes ด้วย margin 100 CSS px แต่ export สร้าง offscreen stage จาก nodes ทั้งหมด ไม่ส่งต่อเฉพาะ mounted nodes ใช้ memoized node views และ Zustand selectors เพื่อไม่ rerender panels ทุก pointer move ส่วน thumbnails debounce หลัง transaction และเก็บ local cache เท่านั้น

ไม่ cache bitmap ทุก vector node โดยอัตโนมัติ เพราะใช้ memory และทำ export เบลอได้ ต้องวัดก่อนเลือก cache บาง widget และ clear/recreate cache เมื่อ scale สำหรับ export

## 10. ลำดับงานและ acceptance

พัฒนาตามลำดับ: camera + geometry → Select/Hand → primitives → move/clone/lock → transforms + properties → history → text/images → Git adapter → teaching mode/thumbnail → performance ใช้ task IDs ใน [delivery](06-delivery-and-acceptance.md)

ตรวจรวม: zoom 10/100/800%, Retina, negative coordinates, rotate 45°, hit locked node, marquee mixed nodes, clone cancel, Undo หนึ่งครั้งต่อ gesture, ภาษาไทย IME, Escape คืน text เดิม, ภาพแนบ decode fail และ export นอก viewport ทั้ง Chromium/WebKit และแทร็กแพด Mac จริงตาม acceptance matrix

## แหล่งอ้างอิง

ตรวจเมื่อ 2026-09-24: [Konva Transformer](https://konvajs.org/docs/react/Transformer.html), [Free drawing](https://konvajs.org/docs/react/Free_Drawing.html), [Pointer-relative zoom](https://konvajs.org/docs/sandbox/Zooming_Relative_To_Pointer.html), [Undo/Redo](https://konvajs.org/docs/react/Undo-Redo.html), [Node bounds API](https://konvajs.org/api/Konva.Node.html)
