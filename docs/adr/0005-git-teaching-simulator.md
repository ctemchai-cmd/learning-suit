# ADR 0005: ตัวจำลอง Git สำหรับสอนด้วยภาพ

- สถานะการตัดสินใจ: **Accepted**
- วันที่ตัดสินใจและตรวจสอบแหล่งอ้างอิง: **2026-09-24**
- สถานะการพัฒนา: ดู [แผนส่งมอบ](../plan/06-delivery-and-acceptance.md) ซึ่งเป็นแหล่งสถานะงานแห่งเดียว
- สเปกที่ใช้พัฒนา: [ตัวจำลอง Git](../plan/04-git-simulator.md)

## บริบท

ผู้สอนต้องวาดซ้ำเพื่ออธิบายว่าการแก้ไฟล์ การเตรียมไฟล์เข้า staging การ Commit บนเครื่อง และการส่งขึ้น GitHub เป็นคนละขั้นตอน ผู้เรียนควรเห็นว่าเครื่อง A, GitHub และเครื่อง B มีข้อมูลต่างกันได้ และการ Commit ไม่ส่งงานให้อีกเครื่องโดยอัตโนมัติ

แอปต้องช่วยสื่อแนวคิดนี้บนกระดานเดียวกับภาพวาด บันทึกกลับมาแก้ไขได้ และ Export เป็นภาพบทเรียนได้ ความถูกต้องของ staged snapshot และประวัติที่แต่ละเครื่องรู้สำคัญกว่าการจำลองคำสั่ง Git ทุกชนิด

## ทางเลือกที่พิจารณา

| ทางเลือก | ข้อดี | ข้อจำกัด |
|---|---|---|
| วาดกล่องและลูกศรทั่วไป | สร้างง่ายและอิสระ | ผู้สอนยังต้องเปลี่ยนสถานะเอง ไม่มีการป้องกันภาพอธิบายผิด |
| เชื่อม GitHub หรือ repository จริง | สาธิตระบบจริงได้ | ต้องใช้บัญชี สิทธิ์ เครือข่าย และกระบวนการกู้คืน ไม่เหมาะกับการเริ่มบทเรียนซ้ำ |
| รัน Git ใน browser/WASM | ใกล้เคียงการทำงานจริง | ต้องจัดระบบไฟล์และแปลสถานะเป็นภาพ เพิ่มความซับซ้อนเกินบทเรียนรุ่นแรก |
| Pure simulation engine และ Canvas widget | ทดลองซ้ำและ Undo ได้ ทดสอบผลได้แน่นอน | ต้องระบุข้อจำกัดของแบบจำลองอย่างชัดเจน |

## การตัดสินใจ

เลือก pure simulation engine แยกจาก UI, Supabase และ renderer ตัวจำลองหนึ่งชุดเป็น `git-simulator` node บน Canvas เก็บ `GitSimulationState` ใน `node.state` มีเครื่อง A, GitHub และเครื่อง B เป็นหน่วยเดียวที่ย้าย ทำสำเนา Lock และบันทึกได้

รุ่นแรกมีหนึ่งไฟล์ข้อความ หนึ่ง branch ชื่อ `main` และ remote ชื่อ `origin` รองรับ Edit, Stage, Commit, Push, Clone, Pull, Inspect commit และ Reset demo (หมายเหตุ 2026-09-25: UI เรียก Stage ว่า **Add** ตามคำสั่ง `git add` และ Inspect เป็นการคลิกวง commit เพื่อดูโค้ดของ commit นั้นแบบอ่านอย่างเดียวในกล่องไฟล์ ไม่ใช่ checkout) ไม่มีการรันเนื้อหาไฟล์ ไม่มี GitHub API และไม่มีการเข้าถึง repository จริง

ข้อมูล commit เป็น immutable snapshot ของ `{ name, content }` พร้อม parent หนึ่งตัว ใช้ ID เพื่อการสอน `C1`, `C2`, … จากตัวนับภายใน widget ระบุใน UI ว่าเป็นหมายเลขจำลอง ไม่ใช่ Git object hash ไม่มีเวลาและค่าการสุ่มใน reducer จึงเล่น action เดิมจาก state เดิมแล้วได้ผลเดิม

`commits` เป็น registry ของทั้ง widget เพื่อลดการทำสำเนาข้อมูล แต่แต่ละเครื่องและ remote มี `knownCommitIds` ของตัวเอง Renderer และ action ต้องเคารพขอบเขตการมองเห็นนี้ เครื่อง A จึงไม่รู้ commit ใหม่ของ B เพียงเพราะ ID นั้นอยู่ใน registry กลาง

Stage คัดลอก working snapshot ไปที่ `index`; Commit อ่าน `index` และเลื่อน local `main` เท่านั้น หลัง Commit, `index` ยังเท่ากับ snapshot ของ HEAD ใหม่ ไม่ถูกล้างเป็น `null` และ working file ที่แก้หลัง Stage ยังคงอยู่ การเปรียบเทียบ working/index/HEAD สร้างสถานะ unstaged/staged โดยไม่ต้องบันทึก flag ซ้ำ แนวคิด staging และ commit snapshot อ้างอิง [Git Basic Snapshotting](https://git-scm.com/book/en/v2/Appendix-C%3A-Git-Commands-Basic-Snapshotting) และ [git-add](https://git-scm.com/docs/git-add)

Push ตรวจ ancestry กับ remote `main` และรับเฉพาะการสร้าง branch ครั้งแรกหรือ fast-forward ไม่มี force push การส่งสำเร็จไม่แก้ working file หรือ HEAD ของอีกเครื่อง ซึ่งสอดคล้องกับแนวคิดการอัปเดต remote branch ใน [git-push](https://git-scm.com/docs/git-push)

Pull เลือกโหมด **fast-forward only** อย่างชัดเจน: fetch commit และอัปเดต `origin/main` ก่อน แล้วจึงพยายามเลื่อน local `main` เมื่อประวัติแยกกัน ขั้น fetch ที่สำเร็จยังคงอยู่ แต่ HEAD, index และ working file เดิมไม่ถูกเขียนทับ หลัก fetch ตามด้วย integration และโหมด `--ff-only` อ้างอิง [git-pull](https://git-scm.com/docs/git-pull) รุ่นแรกเพิ่มข้อจำกัดเพื่อการสอนว่า working/index ต้องสะอาดก่อนเริ่ม Pull และ UI ต้องบอกว่านี่เป็นกติกาของตัวจำลอง

ผล action แยก `outcome` ออกจาก `changed` เพื่อรองรับกรณี Pull ถูกปฏิเสธแต่ fetch ทำให้ข้อมูลเปลี่ยน การเปลี่ยน state หนึ่ง action รวมเป็นหนึ่ง document transaction และ Undo ได้ทั้งชุด การ Inspect หรือ action ที่ไม่มีผลไม่สร้าง history

## ผลกระทบและข้อจำกัด

- ต้องทดสอบ reducer ด้วยสถานะจริงทุกขั้น รวม Stage แล้วแก้ต่อ, rejected Push และ rejected Pull ที่มีข้อมูล fetch ใหม่ ไม่ใช้เฉพาะภาพ snapshot ของ UI
- หนึ่ง widget เก็บหลายสำเนาของไฟล์ตามจำนวน commit เพื่อให้เปิดดูรุ่นเก่าได้ ขนาดถูกควบคุมด้วยข้อจำกัดไฟล์และขนาดเอกสารรวมใน [data contracts](../plan/02-architecture-and-data-contracts.md)
- ทุก widget เป็นบทเรียนอิสระ การ Clone วัตถุสร้าง state ที่แก้แยกจากต้นฉบับได้ แม้หมายเลข commit ภายในเหมือนกัน
- การวาด/ปรับขนาดใช้ Canvas ส่วนแก้เนื้อหาและดู commit ใช้ DOM controls (overlay บนกระดาน + แผงปุ่ม); Export วาดสรุป state ลง Canvas ไม่ถ่ายภาพ DOM
- “Save โปรเจกต์” เก็บข้อมูลบทเรียน ส่วน “Commit” และ “Push” เป็น action ภายในบทเรียน UI ต้องแสดงต่างบริบทกัน
- ไม่จำลองหลายไฟล์ การลบไฟล์ staging บางบรรทัด branches, merge, rebase, force push, reset ของ Git, detached HEAD, credentials หรือ network failure ของ GitHub จริง
- `Reset demo` เป็นคำสั่งของแอปเพื่อเริ่มบทเรียนใหม่ ไม่ใช่ `git reset`; Undo ของแอปย้อนทุกฝั่งได้และไม่ควรถูกอธิบายว่าเป็นพฤติกรรมของ Git จริง

## อัปเดต 2026-10-05: Branch อยู่ในขอบเขตแล้ว

ผู้สอนขอบทเรียน Branch จึงเพิ่มขั้นบทเรียนที่ 4 "Branch (ทางแยก)" ให้สร้าง สลับ Merge และลบ branch ได้ (เฉพาะเครื่อง A, ไฟล์เดียวเหมือนเดิม) ข้อห้ามเรื่อง branch ก่อนหน้านี้จึงไม่ใช้กับขั้นนี้ ส่วน Push/Pull/Clone ยังทำงานกับ `main` เท่านั้น (ปฏิเสธเมื่อ HEAD อยู่ branch อื่น) และไม่มี remote branch รายละเอียดดู [สเปก §Branch](../plan/04-git-simulator.md)

## เงื่อนไขทบทวน

ทบทวน ADR ก่อนเพิ่มหลายไฟล์หรือหลาย parent ของ commit เพราะกระทบ snapshot, ancestry, UI และ archive schema หากต้องเชื่อม GitHub จริง ให้ทำ ADR แยกสำหรับสิทธิ์และขอบเขตการแก้ repository โดยไม่เปลี่ยนความหมายของ simulator เดิมเงียบ ๆ

## เอกสารอ้างอิง

ตรวจสอบจากเอกสารทางการวันที่ **2026-09-24**:

- [Git Basic Snapshotting](https://git-scm.com/book/en/v2/Appendix-C%3A-Git-Commands-Basic-Snapshotting): แนวคิด working directory, index และ snapshot
- [git-add](https://git-scm.com/docs/git-add) และ [git-commit](https://git-scm.com/docs/git-commit): ขอบเขตเนื้อหาที่ Stage และ Commit
- [git-push](https://git-scm.com/docs/git-push): ancestry และการปฏิเสธ non-fast-forward
- [git-pull](https://git-scm.com/docs/git-pull): fetch ตามด้วย integration และ `--ff-only`
- [git-clone](https://git-scm.com/docs/git-clone): สำเนา repository และ remote-tracking branch

ค่าตั้งต้น การจำกัดไฟล์ หน้าตา และข้อความใน UI เป็นการตัดสินใจของ Learning Suit ตาม [สเปกตัวจำลอง](../plan/04-git-simulator.md) ไม่ใช่ข้อกำหนดของ Git
