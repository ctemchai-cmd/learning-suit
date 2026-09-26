# 03 — Canvas editor: interactions, geometry และ history

ข้อกำหนดนี้ทำให้การวาด เลือก Lock และ Clone ใช้คล่องบน Mac อ่าน [data contracts](02-architecture-and-data-contracts.md) ก่อน implement และใช้ [ADR 0002](../adr/0002-custom-canvas-and-document-model.md) เป็นเหตุผลการแยก model/renderer

## 1. Renderer และ coordinate system

Stage มีขนาดเท่า viewport ที่มองเห็น ใช้ ResizeObserver ไม่สร้าง canvas bitmap ขนาดเท่าโลกทั้งใบ ภายในแยกอย่างน้อย background/grid layer (ไม่รับ hit), document layer, transient preview และ selection overlay ทุก node renderer รับข้อมูลจาก document เท่านั้น

Grid พื้นหลัง (ปรับ 2026-09-26 ตาม feedback ให้เหมือน draw.io): เส้นย่อยเส้นประทุก 20 หน่วยโลก และเส้นหลักทึบทุก 5 เส้นย่อย (100 หน่วย) ผูกกับพิกัดโลก เมื่อซูมออกจนเส้นย่อยห่างกันน้อยกว่า 10 px ระยะจะคูณ 5 ต่อไปเรื่อยๆ วาดเป็นเส้นบน screen space ใน layer ที่ไม่รับ hit และไม่ถูก export

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
- คลิกของรูปทรงที่ขยับน้อยกว่า 12 px ยังนับเป็นคลิก (แทร็กแพดขยับระหว่างคลิก) และคลิกที่สองจำจากตอนกด (`hadPending`) ไม่พึ่ง state ที่อาจยังไม่อัปเดต (ปรับ 2026-09-26 ตาม feedback “คลิกครั้งที่ 2 ไม่หยุดวาด”)
- Rect/Ellipse/Line/Arrow วาดแบบ **กดค้าง-ลาก-ปล่อย** ได้ด้วย (เพิ่ม 2026-09-26 ตาม feedback “คลิกวาดไม่ได้ ต้องคลิกหลายที” — เดิมการลากถูกทิ้งเงียบๆ): ลากเกิน 6 px เริ่ม preview (แถบบอก “ปล่อยเพื่อจบ”) ปล่อยแล้วได้รูปทรง; ถ้าคลิกจุดแรกไว้แล้วค่อยลาก จะเริ่มจากจุดแรกนั้น
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

### Git widget

Insert จากเมนูเพิ่มวัตถุเป็น node เดียว ขนาด 1120 × 680 คูณ scale (ขั้น 3 กว้าง 1600; เปลี่ยนขั้นแล้วกล้องซูมออก/เลื่อนให้เห็นทั้งชิ้น) เลือกครั้งแรกแสดง Git panel ซึ่งเรียก pure actions ของ [Git spec](04-git-simulator.md) และกล้องซูมออก (ไม่ซูมเข้า) ให้เห็นทั้ง widget ในส่วนของกระดานที่แผง overlay ไม่บัง; widget ใหม่เลื่อนออกจากตำแหน่ง widget เดิมที่ซ้อนกัน เมื่อเลือก widget เดียว จะมี DOM overlay สำหรับแก้ไฟล์และปุ่มดู commit ทับตำแหน่งบนภาพ (ซ่อนระหว่างลาก/ปรับขนาด) Nodes ย่อยบนการ์ดไม่เป็น ordinary Canvas nodes และไม่ลบ commit circle ทีละอันผ่าน Delete

Clone/duplicate widget ต้อง copy state อย่างอิสระ เมื่อ widget ถูก Lock ต้องปลดล็อกก่อนทั้งการแก้ไฟล์ การดู commit และการเรียก Git actions โดยปลดล็อกผ่าน Objects panel เท่านั้นเช่นเดียวกับ node อื่น Objects panel ไม่เปิดทางเลือก widget ที่ยัง Lock อยู่

## 8. Keyboard และ focus

| Key | Action เมื่อ editor/canvas มี focus |
|---|---|
| V/H/P/R/O/A/T | Select/Hand/Pen/Rectangle/Ellipse/Arrow/Text |
| Shift+P / L / E | Highlighter / Line / Eraser (L และ E ใช้ได้ทั้งมีและไม่มี Shift) |
| 1 – 8 | เครื่องมือโปรดตามลำดับในแถบ (อ่าน `event.code` Digit1–8 จึงใช้ได้กับแป้นไทย) รูปภาพ = เปิดตัวเลือกไฟล์; ลำดับเครื่องมือโปรดสลับได้โดยลากไอคอนในแถบ (เกิน 6 px = ลาก คลิกเฉยๆ = เลือก) หรือ ⌥←/→ บนปุ่มที่โฟกัส เก็บใน localStorage |
| K | Laser pointer: จุดแดงตามเมาส์ + หางที่จางเองใน 0.7 วินาที (SVG overlay, session-only) ไม่วาด ไม่เลือก ไม่เข้า Undo/Save/Export; จุดค้างเมื่อเมาส์นิ่งและหายเมื่อออกจากกระดาน |
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
