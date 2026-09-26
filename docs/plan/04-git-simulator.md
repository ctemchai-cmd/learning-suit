# 04 — ตัวจำลอง Git: เครื่อง A ↔ GitHub ↔ เครื่อง B

เอกสารนี้กำหนด behavior, reducer และเกณฑ์ตรวจรับของตัวช่วยสอน Git ตาม [ADR 0005](../adr/0005-git-teaching-simulator.md) ให้พัฒนา logic ก่อน UI แล้วต่อเข้าระบบ document transaction ที่กำหนดใน [Canvas editor](03-canvas-editor.md)

งานและสถานะทั้งหมดอยู่ใน [แผนส่งมอบ](06-delivery-and-acceptance.md) โดยเอกสารนี้เป็นสเปก ไม่ใช่รายการติดตามสถานะซ้ำ

## 1. ผลลัพธ์ที่ผู้สอนต้องทำได้

เพิ่มตัวจำลองบนสไลด์หนึ่งชุด เลือกเครื่อง A หรือ B แก้ไฟล์บนกระดาน Add (Stage), Commit และส่งผ่าน GitHub ให้ผู้เรียนเห็นว่าข้อมูลเปลี่ยนฝั่งใด ครูวาดลูกศรหรือคำอธิบายเพิ่มรอบ widget ได้ และ Save แล้วเปิดต่อจากสถานะเดิมได้

บทเรียนหลักคือ A ทำ C1 → Push → B Clone → B ทำ C2 → Push → A Pull ทุกฝั่งต้องแสดง commit ID เดิมเมื่อรับข้อมูล ไม่สร้าง commit ใหม่จาก Push, Clone หรือ Pull

รุ่นแรกจำลองเฉพาะหนึ่งไฟล์ข้อความและ `main` ไม่มี GitHub API, terminal, network request ของ action Git หรือการรัน HTML ของตัวอย่าง การทดสอบคำสั่งจึงทำได้แม้แอป offline

## 2. Data contracts และ invariants

ให้ประกาศประเภทของ simulator ใน domain module และอ้างจาก `GitSimulatorNode.state` ใน [data contracts](02-architecture-and-data-contracts.md) ห้ามมี type อีกชุดหนึ่งเฉพาะ renderer

```ts
type MachineId = 'A' | 'B';
type CommitId = string; // runtime format: C + positive integer เช่น C1

type FileSnapshot = {
  name: string;
  content: string;
};

type GitCommit = {
  id: CommitId;
  parentId: CommitId | null;
  message: string;
  snapshot: FileSnapshot;
};

type MachineRepository = {
  initialized: boolean;
  working: FileSnapshot | null;
  index: FileSnapshot | null;
  mainHead: CommitId | null;
  originMainHead: CommitId | null;
  knownCommitIds: CommitId[];
};

type RemoteRepository = {
  mainHead: CommitId | null;
  knownCommitIds: CommitId[];
};

type GitSimulationState = {
  version: 1;
  commits: Record<CommitId, GitCommit>;
  machines: { A: MachineRepository; B: MachineRepository };
  remote: RemoteRepository;
  nextCommitNumber: number;
};
```

`FileSnapshot` เปรียบเทียบค่าทั้ง `name` และ `content` แบบตรงตัว ไม่ trim เนื้อหาไฟล์ `index` หมายถึงเนื้อหาที่เตรียมไว้สำหรับ commit ไม่ใช่ list ของสิ่งที่ยังรอ commit หลัง Commit มันจึงยังมี snapshot เดิมและเท่ากับ HEAD ใหม่

กติกาตรวจข้อมูลเมื่อ import/load:

- `version` ต้องเป็น `1`; IDs ใน registry ตรงกับ `commit.id`, ไม่มี parent หายหรือ cycle และ parent ต้องมีเลขน้อยกว่า child
- ทุก HEAD ที่ไม่ใช่ `null` ต้องอยู่ใน `knownCommitIds` ของ repository นั้น `originMainHead` ที่ไม่ใช่ `null` ต้องอยู่ใน known IDs ของเครื่องนั้นเช่นกัน
- known IDs เป็น set ไม่มีซ้ำ เก็บเรียงตามเลขหลัง `C` และมี ancestors ครบ ห้ามใช้ lexical sort ที่ทำให้ C10 อยู่ก่อน C2
- Registry อาจมี commit ที่อีกเครื่องยังไม่รู้ การ render, การดู commit และการหา ancestry ฝั่งเครื่องต้องใช้เฉพาะ known IDs ของเครื่องนั้น การรับจาก remote ใช้เฉพาะ ancestors ที่ remote รู้
- `initialized:false` ต้องมี working/index/heads เป็น `null` และ known IDs ว่าง เครื่อง A เป็น `initialized:true` เสมอ ส่วน B เปลี่ยนเป็น true หลัง Clone เท่านั้น
- เครื่องที่ initialized ต้องมี working snapshot; `index:null` ใช้ได้เฉพาะก่อน Stage ครั้งแรกเมื่อ HEAD ยังเป็น `null` เมื่อ HEAD มีค่า index ต้องเป็น snapshot เสมอ
- `nextCommitNumber` เป็นจำนวนเต็มบวก มากกว่าหมายเลขสูงสุดใน registry หลัง Reset เป็น 1; reducer เพิ่มค่านี้เฉพาะเมื่อ Commit สำเร็จ
- จำกัด 200 commits ต่อ widget ตรวจทั้งการโหลด/import และการ Commit; เมื่อเต็มแจ้งให้เริ่ม widget ใหม่หรือ Reset demo โดยไม่ทิ้งข้อมูลเดิมอัตโนมัติ
- ข้อมูล snapshot เป็น immutable value ไม่แชร์ mutable object ระหว่าง working, index และ commit; ทั้ง reducer และ test ต้องไม่แก้ input state
- ชื่อไฟล์ trim รอบนอก ยาว 1–120 Unicode code points ห้าม `/`, `\` และ control character; เนื้อหายาวไม่เกิน 64 KiB แบบ UTF-8 ชื่อเป็น label ของไฟล์จำลอง ไม่ใช่ path จริง
- ข้อความ Commit trim รอบนอก ยาว 1–200 Unicode code points ไม่รับบรรทัดใหม่ ไม่จำกัดว่าเป็นภาษาใด; ใช้ข้อจำกัดขนาดเอกสารรวมจาก [data contracts](02-architecture-and-data-contracts.md) เพิ่มเติม

### สถานะที่คำนวณ ไม่บันทึกซ้ำ

กำหนด `headSnapshot(machine)` เป็น snapshot ของ `mainHead` หรือ `null` และเปรียบเทียบ snapshot ด้วยกติกาข้างต้น:

```text
hasUnstaged = working != index
hasStaged   = index != headSnapshot
isClean     = !hasUnstaged && !hasStaged
```

ก่อน Stage ครั้งแรก UI แสดง “ไฟล์ใหม่ ยังไม่ Add” หลัง Commit แสดง “ไม่มีการเปลี่ยนแปลง” เมื่อ clean ต้องไม่แสดงว่า staging ว่างเพียงเพราะไม่มีการเปลี่ยนแปลงเมื่อเทียบ HEAD

สถานะ ahead/behind บนการ์ดเครื่องคำนวณเทียบ `originMainHead` ที่เครื่องนั้นรู้ล่าสุด ไม่อ่าน remote `mainHead` สดโดยอัตโนมัติ ใส่ caption “เทียบ GitHub ล่าสุดที่เครื่องนี้รู้” หาก tracking เป็น `null` ให้แสดง “ยังไม่รู้สถานะ GitHub” ไม่แสดง behind จากข้อมูลลับของอีกฝั่ง

### สถานะเริ่มต้นที่แน่นอน

ใช้ fixture นี้เป็นผลของ `createInitialGitState()` และ Reset; content ลงท้ายด้วย LF หนึ่งตัว:

```json
{
  "version": 1,
  "commits": {},
  "machines": {
    "A": {
      "initialized": true,
      "working": {
        "name": "main.py",
        "content": "print(\"Hello World\")\n"
      },
      "index": null,
      "mainHead": null,
      "originMainHead": null,
      "knownCommitIds": []
    },
    "B": {
      "initialized": false,
      "working": null,
      "index": null,
      "mainHead": null,
      "originMainHead": null,
      "knownCommitIds": []
    }
  },
  "remote": { "mainHead": null, "knownCommitIds": [] },
  "nextCommitNumber": 1
}
```

## 3. Reducer และการเชื่อม history

```ts
type GitAction =
  | { type: 'edit'; machine: MachineId; file: FileSnapshot }
  | { type: 'stage'; machine: MachineId }
  | { type: 'commit'; machine: MachineId; message: string }
  | { type: 'push'; machine: MachineId }
  | { type: 'clone'; machine: 'B' }
  | { type: 'pull'; machine: MachineId }
  | { type: 'reset' };

type GitResultCode =
  | 'EDITED' | 'STAGED' | 'COMMITTED' | 'PUSHED' | 'CLONED'
  | 'PULLED' | 'FETCHED_UP_TO_DATE' | 'RESET' | 'NO_CHANGE'
  | 'NOT_INITIALIZED' | 'INVALID_FILE' | 'INVALID_MESSAGE'
  | 'NOTHING_STAGED' | 'NO_LOCAL_COMMITS' | 'REMOTE_EMPTY'
  | 'ALREADY_INITIALIZED' | 'DIRTY_WORKTREE'
  | 'NON_FAST_FORWARD' | 'DIVERGED' | 'COMMIT_LIMIT';

type GitTransition = {
  nextState: GitSimulationState;
  outcome: 'success' | 'noop' | 'rejected';
  changed: boolean;
  code: GitResultCode;
  affectedCommitIds: CommitId[];
  transfer: null | {
    from: MachineId | 'remote';
    to: MachineId | 'remote';
    commitIds: CommitId[];
  };
};

declare function applyGitAction(
  state: GitSimulationState,
  action: GitAction,
): GitTransition;
```

Reducer รับ state ที่ผ่าน schema validation แล้ว จัดการ domain input ที่ไม่ถูกต้องเป็น `rejected` ไม่ throw เพื่อควบคุม UI ตามปกติ Invalid imported state ถูกปฏิเสธก่อนเข้าถึง reducer ตามกระบวนการ load/import กลาง ไม่ต้องซ่อม Git graph เงียบ ๆ

`nextState` เป็น state เดิมเมื่อไม่เปลี่ยนข้อมูล; `changed` อิงค่าจริงไม่ใช่ชื่อ action ผล `outcome:'rejected'` สามารถมี `changed:true` ได้เฉพาะ Pull ที่ fetch แล้วพบ divergence ส่วน `noop` ต้องมี `changed:false` ทุกครั้ง รหัส `FETCHED_UP_TO_DATE` ใช้ success เมื่อ tracking/known IDs เปลี่ยนแต่ local HEAD ไม่เลื่อน; ถ้าไม่มีการเปลี่ยนใดเลยใช้ `NO_CHANGE`

`affectedCommitIds` เรียงหมายเลขเพิ่ม ใช้แสดง commit ใหม่หรือ commit ที่ HEAD เลื่อนไปถึง `transfer` มีเฉพาะ Push/Clone/Pull เมื่อมี commit ที่ส่งใหม่จริงและแสดงทิศทางได้ การ fetch tracking ที่ไม่ส่ง commit ใหม่ไม่ต้องมี animation การ Reject Push ไม่มี transfer

เมื่อ `changed:true` ให้แทน `node.state` ผ่าน `applyDocumentCommand` หนึ่ง transaction โดยรวมขั้น fetch/integration ไว้ใน action เดียว Undo ย้อนทั้งชุดและ Redo คืน state ที่บันทึกใน history ไม่รัน reducer ซ้ำ ไม่มี network หรือ animation side effect ใน reducer

commit preview, selected machine, commit message input, scroll และผลข้อความล่าสุดเป็น session state ไม่อยู่ใน `GitSimulationState` และไม่เพิ่ม history เมื่อ Undo/Redo/load/Reset ให้ล้างผลข้อความล่าสุด, animation และ commit preview เพื่อไม่แสดงความสำเร็จของ action ที่ถูกย้อนแล้ว

## 4. กติกาแต่ละ action

ทุก action ที่มี machine ยกเว้น Clone ต้องตรวจ `initialized` ก่อน ส่วน Reset ใช้ได้เสมอ Validation failure ไม่ใช้ commit number และไม่แก้ state

| Action | Preconditions | การเปลี่ยนข้อมูล | No-op / error |
|---|---|---|---|
| Edit | initialized และ file valid | เปลี่ยน working เท่านั้น | ค่าเดิม → `NO_CHANGE`; ชื่อ/ขนาดผิด → `INVALID_FILE` |
| Stage | initialized | deep copy working ไป index | working เท่ากับ index → `NO_CHANGE` |
| Commit | initialized, message valid, index ต่างจาก HEAD, commits ยังไม่ครบ 200 | สร้าง commit จาก index, parent=local HEAD, เพิ่ม local known IDs, เลื่อน local HEAD, เพิ่ม counter | message ผิด → `INVALID_MESSAGE`; index null/เท่า HEAD → `NOTHING_STAGED`; เต็ม → `COMMIT_LIMIT` |
| Push | initialized, local HEAD มีค่า | รับ ancestors ของ local HEAD ที่ remote ยังไม่มี, เลื่อน remote HEAD, อัปเดต originMainHead ของผู้ส่ง | ไม่มี local HEAD → `NO_LOCAL_COMMITS`; non-FF → `NON_FAST_FORWARD` |
| Clone | B ยังไม่ initialized, remote HEAD มีค่า | รับ ancestors ของ remote HEAD, B working/index=remote HEAD snapshot, heads ทั้งสอง=remote HEAD | B มี repo แล้ว → `ALREADY_INITIALIZED`; remote ว่าง → `REMOTE_EMPTY` |
| Pull | initialized, clean, remote HEAD มีค่า | fetch ก่อน integration ตามขั้นตอนด้านล่าง | dirty → `DIRTY_WORKTREE`; remote ว่าง → `REMOTE_EMPTY`; divergence → `DIVERGED` |
| Reset | ไม่มี | แทน state ทั้งหมดด้วย initial fixture | state เท่ากับ initial → `NO_CHANGE` |

### Commit

ตรวจข้อความ → staged changes → commit limit ตามลำดับเพื่อให้ error precedence แน่นอน สร้าง `C${nextCommitNumber}` จาก index โดย copy ทั้งชื่อและเนื้อหา `index` ยังคง snapshot ที่เพิ่ง commit; working ไม่เปลี่ยน แม้จะต่างจาก index แล้วก็ตาม ไม่อัปเดต remote หรือ `originMainHead` ไม่มี timestamp/author/hash จริงในรุ่นนี้

### Ancestry และ Push

นิยาม `isAncestor(a,b,known)` ว่า a=b หรือไล่ parent จาก b (merge commit มีสอง parent: `parentId` และ `mergeParentId` เดินทั้งสองทาง) แล้วเจอ a โดยทุก node ต้องอยู่ใน known set; `null` ใช้เป็นฐานก่อนมี commit และถือเป็น ancestor ของทุก head ไม่มีการเดินจาก global registry แล้วเผย commit ที่เครื่องยังไม่รู้

Push ใช้ local known set ตรวจว่า remote HEAD เป็น ancestor ของ local HEAD หาก remote HEAD ไม่มีใน local known และ remote ไม่ว่าง ให้ reject non-FF ไม่แอบ fetch ให้ ผู้ใช้จะเข้าใจว่าต้อง Pull เพื่อรับข้อมูลก่อน

กรณี remote ว่างรับ ancestors ของ local HEAD ทั้งหมด กรณี HEAD เท่ากันไม่โอนข้อมูลใหม่ แต่อัปเดต `originMainHead` ของผู้ส่งให้ตรงหากยังล้าสมัย ผลเป็น `PUSHED` พร้อม changed=true เฉพาะที่เปลี่ยน tracking; ถ้าทุกค่าเท่าเดิมใช้ `NO_CHANGE` Working/index ของผู้ส่งอาจ dirty ได้เพราะ Push ส่ง commit เท่านั้น เครื่องอีกฝั่งไม่เปลี่ยนทุกกรณี

### Pull: fetch แล้ว fast-forward only

1. ตรวจ initialized; ถ้ายังไม่ initialized ให้ `NOT_INITIALIZED`
2. ถ้า working/index ไม่ clean ให้ `DIRTY_WORKTREE` **ก่อน fetch** และไม่เปลี่ยนข้อมูลใด UI ระบุว่า “โหมดจำลองนี้ให้ Commit งานที่ค้างก่อน Pull” ไม่บอกว่าข้อจำกัดนี้ใช้กับ Git จริงทุกกรณี
3. ถ้า remote HEAD เป็น null ให้ `REMOTE_EMPTY` และไม่แก้ tracking
4. Fetch ancestors ของ remote HEAD เข้า local known IDs โดยคง commit ID และ snapshot เดิม แล้วตั้ง `originMainHead=remote.mainHead`
5. ถ้า local HEAD เท่ากับ remote HEAD หรือ remote HEAD เป็น ancestor ของ local HEAD: คง local HEAD/index/working ไว้ ผลเป็น `FETCHED_UP_TO_DATE` เมื่อ fetch เปลี่ยน state หรือ `NO_CHANGE` เมื่อไม่มีการเปลี่ยนเลย อย่าเลื่อนเครื่องที่ ahead ถอยหลัง
6. ถ้า local HEAD เป็น ancestor ของ remote HEAD: เลื่อน local HEAD ไป remote HEAD และตั้ง working/index เป็น snapshot ของหัวใหม่นั้น ผลเป็น `PULLED` ไม่มี commit ใหม่
7. ถ้าไม่เข้าเงื่อนไขข้างต้น: คืน `DIVERGED` และเก็บผล fetch จากขั้น 4 แต่ไม่เปลี่ยน HEAD/index/working ผล changed ขึ้นกับ fetch มีข้อมูลใหม่หรือไม่

การรับข้อมูลจาก GitHub ไม่เท่ากับยอมรวมประวัติ การแจ้ง divergence ต้องอธิบายว่า “รับข้อมูลจาก GitHub แล้ว แต่ประวัติแยกกัน (ต่างคนต่าง Commit) เลือก Merge เพื่อรวมประวัติ หรือใช้เวอร์ชันของ GitHub” ไม่แสดงว่าทุกอย่างถูกยกเลิก

### Merge และใช้เวอร์ชัน GitHub (แก้ประวัติที่แยกกัน, เพิ่ม 2026-09-26)

- `merge { machine, keep: "ours" | "theirs" }`: ต้อง initialized, clean (`DIRTY_WORKTREE` = “Commit งานที่ค้างก่อน Merge”), รู้ `originMainHead` แล้ว (ไม่รู้ → `REMOTE_EMPTY` “ให้ Pull ก่อน”) และแยกจริง (ถ้า origin เป็น ancestor ของ main หรือกลับกัน → `NO_CHANGE`); ครบ 200 commit → `COMMIT_LIMIT` สร้าง `C${n}` ที่มี `parentId = mainHead`, `mergeParentId = originMainHead`, ข้อความอัตโนมัติ “Merge งานจาก GitHub (ใช้ไฟล์ของเรา/ใช้ไฟล์จาก GitHub)” และ snapshot ของฝั่งที่เลือก (ตัวจำลองมีไฟล์เดียวที่ทั้งสองฝั่งแก้ จึงแทน conflict resolution ด้วยการเลือกฝั่ง ไม่ทำ 3-way merge ระดับบรรทัด) เลื่อน main และตั้ง working/index เป็น snapshot นั้น ผล `MERGED`; หลังจากนั้น Push เป็น fast-forward เพราะ commit ของ GitHub เป็น ancestor แล้ว
- `resetToRemote { machine }` (“ทิ้งงานของเรา ใช้เวอร์ชัน GitHub”, เท่ากับ `git reset --hard origin/main`): ต้อง initialized และรู้ `originMainHead`; ทิ้ง working/index ที่ค้างด้วย เลื่อน main ไป origin ตั้ง working/index เป็น snapshot ของ origin และตัด known IDs ให้เหลือ ancestors ของ origin (commit ของเราที่ไม่มีใครรู้หายจากรายการ แต่ยังอยู่ใน registry จึง Undo คืนได้) ผล `RESET_TO_REMOTE` หรือ `NO_CHANGE` ถ้าตรงอยู่แล้ว
- Schema: `mergeParentId` optional ต้องมีอยู่จริง เลขน้อยกว่าตัวเอง ต่างจาก `parentId` และ `parentId` ต้องไม่เป็น null; known set ของทุก repository ต้องรวม parent ทั้งสองของทุก commit ที่รู้ เอกสารเก่าที่ไม่มี field นี้ยังอ่านได้

### Reset และการเริ่มบทเรียนใหม่

ปุ่มชื่อ **Reset demo** มี tooltip “เริ่มตัวอย่างใหม่ ย้อนกลับด้วย Undo ได้” ทำทันทีเป็นหนึ่ง transaction ไม่เพิ่ม dialog ยืนยัน ตั้ง counter กลับ 1 และล้าง commit registry ของ widget นั้น ผู้สอนใช้ Undo คืนทุกฝั่งได้ การแก้ divergence ใช้ Merge หรือ “ใช้เวอร์ชัน GitHub” ด้านบน (ไม่มี Rebase/branch)

## 5. Canvas widget และแผงควบคุม

### ตำแหน่งและภาพที่ Export ได้

ใช้ base coordinates 1120×680 ในขั้น 1–2 และ **1600×680 ในขั้น 3** (ปรับตาม feedback ว่าคอลัมน์แคบจนข้อความถูกตัด) คูณ `scale` แบบ uniform; ขนาดมาจาก `gitBaseSize(view)` ใน domain ที่เดียว ทั้ง bounds/transform/hit test/export/overlay อ่านค่านี้ เปลี่ยนขั้นแล้ว widget ขยาย/หดไปทางขวา (top-left คงที่) และกล้องซูมออกหรือเลื่อนให้เห็นทั้งชิ้น หลักการออกแบบ (ปรับ 2026-09-25 ตาม feedback ว่าภาพรกและเข้าใจยาก): **ในแต่ละเครื่อง ไฟล์ที่แก้อยู่อยู่ซ้าย และ Git อยู่ขวา** ใช้รูปทรงสื่อแทนคำ (ปรับ 2 วันเดียวกัน) **แก้ไฟล์ตรงกล่องไฟล์บนกระดาน** และ **คลิกวง commit เพื่อดูโค้ดของ commit นั้น** แผงด้านขวาเหลือเฉพาะปุ่ม UI ใช้คำว่า **Add** แทน Stage (action ใน reducer ยังชื่อ `stage`)

#### ขั้นของบทเรียน (`view` ของ node)

| `view` | ตัวเลือกใน dropdown ของ Git panel | บนกระดาน |
|---|---|---|
| `local` (ค่าเริ่มต้นของ widget ใหม่) | `A → Git` | การ์ดเครื่อง A เต็มความกว้าง: ซ้าย “ไฟล์ที่แก้อยู่”, ลูกศร `Add` ไปขวา “Git ของเครื่อง A” (Staging → ลูกศร `Commit` → Commits) ไม่มี GitHub, ไม่มี pill สถานะ GitHub และไม่แสดงป้าย `origin/main`; panel ซ่อน Push/Pull |
| `remote` | `A → Git → GitHub` | การ์ด A (ไฟล์ซ้าย/Git ขวา) + การ์ด GitHub (Git อย่างเดียว) ลูกศร `Push →` / `← Pull` ระหว่างกัน; panel เพิ่ม Push/Pull |
| `full` (เอกสารเก่าที่ไม่มี `view`) | `A+Git → GitHub → B+Git` | A (ไฟล์/Git) + GitHub + B (ไฟล์/Git) ลูกศร Push/Pull ทั้งสองฝั่ง และฝั่ง B เขียน `Clone` จนกว่า B จะ Clone แล้วจึงเป็น `Pull`; panel มีปุ่มเลือกเครื่อง A/B; แต่ละเครื่องใช้เลย์เอาต์ขนาดเต็มแบบขั้น 2 (ไม่มีคอลัมน์ย่อ) |

การเปลี่ยนขั้นเป็น document transaction (`nodes.replace` เปลี่ยน `view` อย่างเดียว) Undo ได้ ต้อง flush draft ของ working file ก่อน และ state ของ Git ทั้งหมดยังเก็บครบแม้ขั้นนั้นไม่แสดง B/GitHub

#### องค์ประกอบ

- **ไฟล์ที่แก้อยู่ (ซ้าย)**: วาดเป็น code editor ขนาดเล็กโทนมืด (แถบ tab ชื่อไฟล์ + เลขบรรทัด ยกเว้นคอลัมน์แคบในขั้น 3) เนื้อหาหลายบรรทัดเท่าที่พื้นที่พอ (บอก “… อีก N บรรทัด”; บรรทัดว่างท้ายไฟล์มีเลขบรรทัดเหมือน editor), สถานะหนึ่งบรรทัดพร้อมสัญลักษณ์ `✎ ไฟล์ใหม่ ยังไม่ Add` / `✎ แก้แล้ว ยังไม่ Add` / `✓ ไม่มีการแก้ใหม่` และกรอบส้มเมื่อมีงานค้าง ขณะพิมพ์บนกระดาน ภาพใช้ projected state จึงเปลี่ยนสถานะทันที; ขณะดู commit กล่องนี้เป็นสีน้ำเงิน หัวข้อ “โค้ดของ C1 (ดูอย่างเดียว)” และบอกให้คลิกซ้ำเพื่อกลับ
- **Git ของเครื่อง (ขวา)**: pill เทียบ `origin/main` ที่เครื่องนั้นรู้ (`✓ ตรงกับ GitHub`, `↑ N commit ยังไม่ Push`, `↓ ตามหลัง GitHub N commit`, `↕ ประวัติแยกกับ GitHub`, `? ยังไม่รู้สถานะ GitHub`, `ยังไม่มี commit`), Staging “สิ่งที่ Add แล้ว” (`○ ยังว่าง` / `● มีไฟล์รอ Commit` กรอบน้ำเงิน / `✓ ตรงกับ commit ล่าสุด`), ลูกศร Commit และรายการ Commits
- **Commits**: รายการที่กว้าง (≥360) แสดงหนึ่งบรรทัด ข้อความซ้าย ป้ายขวา; รายการที่แคบกว่าแสดงสองบรรทัด ป้ายเล็กด้านบนและข้อความ commit ด้านล่าง (`commitListStyle`) ข้อความจึงไม่ถูกป้ายเบียดหาย วงกลมมี ID ข้างใน สีกำหนดจากหมายเลข (สีเดียวกัน = commit เดียวกันทุกการ์ด) ใหม่อยู่บน จำนวนวงเท่าที่พื้นที่ของรายการนั้นพอ (`commitRowLimit`: ขั้น 1 = 8, ขั้น 2 = 7/GitHub 5, ขั้น 3 = 6/GitHub 5; ภาพและปุ่มคลิกใช้ค่าเดียวกัน) + “+N ก่อนหน้า” เส้นเชื่อมไป parent (merge commit มีเส้นที่สองไป `mergeParentId`); lane แรกคือ first-parent ของ `main` ส่วน commit ที่รู้แต่ไม่อยู่บนเส้นนั้น (หลัง Pull ที่ DIVERGED หรือฝั่ง GitHub ที่ถูก merge เข้ามา) วางอีก lane จึงเห็นทางแยกและจุดที่รวมกลับ ป้าย `main` (ทึบ) และ `origin/main` (เส้นขอบ) ติดกับวงที่ชี้จริง
- **GitHub**: “เก็บ commit ที่ Push ขึ้นมา (แก้ไฟล์ตรงนี้ไม่ได้)”, pill `มี N commit`/`ยังว่าง`, กล่องโค้ดอ่านอย่างเดียวโทนเดียวกับ editor (tab ชื่อไฟล์ + ป้าย `C2 • main` หรือ `C2 • ดูอย่างเดียว` เมื่อคลิกดู commit) แสดงหลายบรรทัดพร้อมเลขบรรทัดและ “… อีก N บรรทัด”; ขณะเลือก widget มี textarea อ่านอย่างเดียววางทับให้เลื่อนดูทั้งไฟล์ ก่อน Push ครั้งแรกเป็นกล่องประ “ยังไม่มีไฟล์บน GitHub” และ Commits บน GitHub
- ลูกศร Push/Pull เชื่อมระหว่างการ์ดที่ระดับ Commits เท่านั้น เส้นและ animation อยู่ภายในกรอบ widget ไม่กระทบ bounds; ชื่อ widget และหมายเหตุหนึ่งบรรทัดท้ายภาพเปลี่ยนตามขั้น
- เครื่อง B ก่อน Clone แสดงกล่องประ “ยังไม่ได้ Clone” แทนทั้งไฟล์และ Git UI ต้องไม่แสดงเนื้อหาฝั่ง GitHub ในการ์ด B ก่อน Clone

Widget ขยับและ clone ทั้งชุด ปรับขนาดรักษาสัดส่วน ไม่หมุน เลือกได้เหมือน node ปกติ พิกัดภายในคงเดิมแล้วคูณ scale; ขั้นต่ำกว้าง 560 หน่วย และสูง 340 หน่วย Lock ป้องกันการเลือก transform การแก้ไฟล์ และ action ที่แก้ state ต้องปลดล็อกผ่าน Objects panel ก่อนเลือกเพื่อดู commit หรือใช้ action ไม่มีทางลัดสำหรับวัตถุ locked แยกจากระบบ selection กลาง

### แก้ไฟล์และดู commit บนกระดาน (DOM overlay)

เมื่อเลือก widget เดียวที่ไม่ล็อกด้วยเครื่องมือ Select จะมี DOM controls วางทับตำแหน่งเดียวกับภาพ (container ใช้ base coordinates ของ widget และ transform เดียวกับ canvas: translate ตามกล้อง, rotation, `zoom × scale` จึงตรงกันทุกระดับซูม) และซ่อนระหว่างลาก/ปรับขนาด/nudge ตำแหน่งทั้งหมดคำนวณจาก `widget-layout` ชุดเดียวกับที่วาด:

- **ไฟล์**: ช่องชื่อไฟล์ (ใน tab) และ textarea ของ working ตรงกล่อง “ไฟล์ที่แก้อยู่” ของเครื่องที่ initialized ใช้สี, ฟอนต์, ขนาด, ระยะบรรทัดและเลขบรรทัดชุดเดียวกับภาพ (`codeText`, `EDITOR`) จึงไม่มีอะไรขยับเมื่อเลือก widget; เลขบรรทัดเลื่อนตาม scroll ของ textarea (ชื่อสำหรับ assistive tech “ชื่อไฟล์บนเครื่อง A”, “แก้ไฟล์บนเครื่อง A”) เปิดเฉพาะเมื่อโปรเจกต์เขียนได้ ข้อผิดพลาด validation แสดงเป็น alert ในกล่องไฟล์
- **Commit**: ทุกแถวในรายการ Commits ของ repository ที่อยู่ในขั้นนั้น (A / GitHub / B) เป็นปุ่ม “ดูโค้ดของ C1 (เครื่อง A)” (`aria-pressed`) คลิกเพื่อแสดง snapshot ของ commit นั้นแบบ **อ่านอย่างเดียว** ในกล่องไฟล์ของเครื่องนั้น เป็น **diff เทียบ parent แรก** (บรรทัดเพิ่มพื้นเขียวและ +, บรรทัดลบพื้นแดงขีดฆ่าและ −, หน้าต่างเริ่มก่อนการเปลี่ยนแปลงแรก 2 บรรทัด, ป้าย `C3 · +N −M` บนแถบ tab ซึ่งย่อ tab ชื่อไฟล์ให้พอดีเสมอ; `lineDiff` ใน `domain/git/diff.ts` เป็น LCS รายบรรทัด) (หรือกล่องไฟล์ของ GitHub) พร้อมไฮไลต์แถว; คลิกแถวเดิมหรือกล่องไฟล์ (“กลับไปไฟล์ที่แก้อยู่”) เพื่อกลับ การดู commit ไม่ใช่ checkout: ไม่แก้ document ไม่เข้า history ไม่ถูก export และถูกล้างเมื่อ Undo/Redo/load/Reset; preview ของ commit ที่ repository ไม่รู้แล้วกลับไปแสดง working เอง ก่อนเปิด preview ให้ flush draft ของไฟล์ก่อน

### แผง Git (ด้านขวา)

เล็กที่สุดเท่าที่สอนได้ เรียงเป็นการ์ดเว้นระยะชัดเจน: หัวแผง, dropdown “ขั้นของบทเรียน” (native `<select>`: `1 · A → Git`, `2 · A → Git → GitHub`, `3 · A+Git → GitHub → B+Git` พร้อมคำอธิบายสั้นใต้ช่อง), (ขั้น 3) ปุ่มเลือกเครื่อง A/B ซึ่งเปลี่ยนตามอัตโนมัติเมื่อคลิกเข้าไปแก้ไฟล์หรือคลิก commit ของเครื่องนั้นบนกระดาน แล้วเป็นรายการขั้นตอนแบบมีหมายเลข: **① Add** (ปุ่ม Add), **② Commit** (ช่องข้อความ Commit มี label + ปุ่ม Commit; Enter = Commit) และตั้งแต่ขั้น 2 **③ GitHub** (Push/Pull คู่กัน); เครื่อง B ที่ยังไม่มี repo มีการ์ด Clone แทน การ์ดของ “ขั้นถัดไป” (`nextGitStep`: Add เมื่อไฟล์มีการแก้ที่ยังไม่ Add → Commit เมื่อมีของที่ Add แล้ว → Push เมื่อนำหน้า/Pull เมื่อตามหลัง; ไม่เน้นเมื่อประวัติแยก) มีกรอบน้ำเงิน ป้าย “ทำต่อ” และปุ่มสีน้ำเงิน ต่อด้วยผลลัพธ์ล่าสุด (sticky ที่ขอบล่างของแผงจึงเห็นเสมอแม้การ์ดยาวเกินจอ) และปุ่ม Reset demo ขนาดเล็กชิดขวา แผงเปิดเองเมื่อเพิ่มหรือคลิกตัวจำลอง ทั้งแบบ docked, overlay (<1100 px) และโหมดสอน; ถ้าไม่ได้เลือก widget แท็บ Git เสนอ “เลือกตัวจำลอง Git ที่มีอยู่” ก่อนปุ่มเพิ่มตัวใหม่ และตัวใหม่จะไม่วางทับตำแหน่งตัวเดิม ไม่มี editor ไฟล์, preview staged/HEAD หรือ Inspect ในแผง ปุ่มที่ใช้ไม่ได้ปิดด้วย `aria-disabled` และเหตุผลอยู่ใต้ปุ่มในการ์ดเดียวกัน (อ่านได้ด้วย keyboard/screen reader ผ่าน `aria-describedby`) ส่วนเหตุผล “อ่านอย่างเดียว” แสดงครั้งเดียวด้านบน; reducer ยังต้องตรวจเองแม้ UI ปิดปุ่มแล้ว ทุก action flush draft ของไฟล์ก่อน แล้วอ่าน node ล่าสุดจาก store (ไม่ใช้ props ที่อาจเก่า)

เมื่อเครื่องที่เลือกมีประวัติแยกกับ `origin/main` ที่รู้ (ขั้น 2–3) แสดงการ์ดสีเหลือง **“ประวัติแยกกัน”** เหนือขั้นตอน ① พร้อมปุ่ม “Merge: เก็บไฟล์ของเรา” (น้ำเงินเมื่อเป็นขั้นถัดไป), “Merge: ใช้ไฟล์จาก GitHub” และลิงก์ “ทิ้งงานของเรา ใช้เวอร์ชัน GitHub” (tooltip บอกว่า Undo ได้) `nextGitStep` คืน `merge` เมื่อ ahead และ behind พร้อมกัน

ขณะมี working draft ให้คำนวณความพร้อมของปุ่มจาก **projected state** ที่แทน working ด้วย draft ที่ผ่าน validation แล้ว โดยยังไม่เปลี่ยน document เช่น หลัง Commit แล้วพิมพ์เนื้อหาใหม่ ปุ่ม Add ต้องเปิดทันทีเมื่อ draft ต่างจาก index และ Pull ต้องปิดเมื่อ projected state ไม่ clean ปุ่ม Commit ยังอ่าน index ที่มีอยู่จริง ไม่ถือว่า working draft ถูก Add โดยอัตโนมัติ การเปลี่ยนชื่อไฟล์อย่างเดียวใช้กติกาเดียวกัน

draft ของไฟล์เก็บเป็น `pendingEdit` ชนิด `git-file` ใน editor store (แหล่งเดียวที่ทั้ง textarea, ภาพบนกระดาน และแผงอ่าน) และมี flusher เดียวที่ลงทะเบียนโดย editor: Flush เป็น Edit transaction เมื่อ blur, Cmd/Ctrl+Enter (หรือ Enter ในช่องชื่อไฟล์), กด action, เปลี่ยนขั้น/เครื่อง/slide/selection, เปิด preview, Save หรือ Export หนึ่งช่วงการแก้ไขเป็นหนึ่ง Undo; action ที่กดต่อมาสร้าง transaction แยกจาก Edit หากข้อมูลเปลี่ยน **Escape ออกจากกล่องโดยเก็บสิ่งที่พิมพ์** (flush เป็น Edit แล้ว blur; ย้อนด้วย Undo หนึ่งครั้ง) ต่างจาก text node บนกระดาน เพราะจาก UX audit ครูใช้ Esc เพื่อ “ออก” และการทิ้งโค้ดที่พิมพ์โดยไม่มี Undo คือข้อมูลหาย; การทิ้ง draft ทำผ่านปุ่ม “ยกเลิกการแก้” ในกล่องแจ้งข้อผิดพลาด ในกล่องโค้ด Tab/Shift+Tab เพิ่ม/ลดการเยื้อง 4 ช่องของบรรทัดที่เลือก (caret เดียว = แทรก 4 ช่อง) และ Enter คงการเยื้องเดิม (+1 ระดับหลัง `:`) ผ่านคำสั่งแก้ไขของเบราว์เซอร์เพื่อให้ Cmd+Z ในช่องยังใช้ได้ เมื่อ action ถูก reject หลัง flush แล้ว Edit ที่สำเร็จยังคงอยู่และ Undo ได้ อย่าย้อนการพิมพ์ที่ถูกต้องเพียงเพราะ action ถัดมาทำไม่ได้ widget ที่หายไปหรือเครื่องที่ยังไม่ initialized ทำให้ทิ้ง draft

หาก draft ไม่ผ่าน validation ให้แสดงเหตุผลในกล่องไฟล์พร้อมปุ่ม “ยกเลิกการแก้” คง draft และ focus ช่องที่ผิด (Esc ก็ไม่ปิด) และยกเลิก action, navigation, preview, Save หรือ Export ที่รอ flush ครั้งนั้น ไม่แก้ document ไม่ตัดข้อความ ไม่เริ่ม reducer กับค่าเก่า และไม่ทิ้ง draft ผู้ใช้แก้จน valid หรือกด “ยกเลิกการแก้” ได้ ปุ่ม Git ที่ต้อง flush ใช้ไม่ได้ระหว่าง draft invalid

การกู้ DOM draft ระหว่างพิมพ์ใช้ IndexedDB ตาม [persistence](05-persistence-security-and-export.md): debounce 500 ms แยกจาก document transaction, reload เลือก widget และคืน draft ในกล่องไฟล์บนกระดาน, cloud รอ flush และสถานะต้องไม่บอกว่าข้อความ draft บันทึกบน cloud แล้ว ไม่ dispatch Edit ทุกตัวอักษรเพื่อทำ autosave

ขณะ composition ยังไม่จบห้าม flush หรือ dispatch Edit/Add/Commit จาก Enter ให้รอ `compositionend` (blur ระหว่าง composition จะ flush หลังจบ) Enter ในช่อง commit message ใช้ Commit เมื่อไม่อยู่ระหว่าง composition การ Enter ปกติใน textarea ของไฟล์ขึ้นบรรทัดใหม่ คีย์ลัด canvas ไม่ทำงานเมื่อพิมพ์ใน input/textarea

Commit message เป็น session input ไม่บันทึกลงโปรเจกต์จน Commit; สำเร็จแล้วล้าง input, reject แล้วคงไว้ ส่วน working edit บันทึกเป็น Drawing info ของ node ไม่ใช่ภาพ

### ผลลัพธ์และ animation

แสดงข้อความผล action ใต้ปุ่ม ใช้ `aria-live="polite"` ไม่เปิด modal เมื่อ reject ปกติ ความสำเร็จใช้ข้อความเฉพาะ เช่น “สร้าง C2 บนเครื่อง B แล้ว” และ “ส่ง C2 ขึ้น GitHub แล้ว” พร้อมคำอธิบายว่าเครื่องอื่นรับข้อมูลเมื่อ Clone/Pull ไม่สรุปจาก tracking ของ B ว่า A รู้/ไม่รู้ commit ใดอยู่จริง

เมื่อมี `transfer` ให้แสดงจุดวิ่งบนลูกศร 900 ms (ช้าพอให้เห็นบนโปรเจกเตอร์) หลัง state commit ข้อมูลเปลี่ยนครั้งเดียวก่อนเริ่ม animation กด action ต่อได้โดย cancel animation เก่า ผู้ใช้ `prefers-reduced-motion` ได้รับข้อความผลโดยไม่มีการเคลื่อนไหว Export จับ final state ไม่มีจุดที่กำลังวิ่งหรือ selection

## 6. Save, Clone, Export และขอบเขตโมดูล

- Git state อยู่ใน document JSONB ตาม [persistence](05-persistence-security-and-export.md) ไม่มีตาราง commit แยกและไม่มีภาพกระดานใน DB
- Save/Load/Archive round trip ต้องรักษา known sets, index, working, heads, IDs และ counter ไม่สร้าง initial state ทับ node ที่โหลดแล้ว
- Copy/Option+drag ของ widget เปลี่ยน node ID และแยก state ที่แก้ได้อิสระ คง C1/C2 เดิมภายในสำเนา เพราะ commit ID มีขอบเขตเฉพาะ widget
- Duplicate slide รวม widget state แบบเดียวกัน ไม่แชร์ store ของ simulator ระหว่างสองสไลด์
- PNG/PDF ใช้ renderer ของ widget เดียวกับ editor ตาม final document state; file content เป็น plain canvas text ไม่มี iframe, HTML evaluation หรือ screenshot ของ DOM panel/overlay และไม่แสดง commit preview
- `getNodeBounds` คืนกรอบ widget ที่คูณ scale รวมเส้นขอบ ภาพภายใน clip อยู่ในกรอบนั้น จึงคำนวณ export padding ได้แน่นอน
- Domain module ไม่มี import React/Konva/Supabase; UI dispatch document command ที่บรรจุผล reducer ไม่มี reducer ถูกเรียกจาก render function

ลำดับพัฒนาภายใน milestone Git: types/schema/fixture → snapshot equality/ancestry/selectors → reducer และ unit tests → static Canvas renderer → DOM overlay/panel และ document transaction → history/save/export integration → browser acceptance ในหัวข้อถัดไป

## 7. Fixtures และเกณฑ์ตรวจรับ

ใช้ initial JSON ในหัวข้อ 2 เป็น input แล้วสร้างสถานการณ์ด้วย action sequences ด้านล่าง Expected results ต้องเขียนจากข้อกำหนดแต่ละขั้นอย่างอิสระ ไม่เรียก reducer ตัวเดียวกันมาสร้าง expected output เพื่อเทียบกับตัวเอง ตรวจ fields และ snapshot ที่ระบุอย่างชัดเจน ใช้ข้อความสั้นต่อไปนี้เพื่อให้ตรวจได้ตรงตัว:

```text
S1 = { name: 'index.html', content: '<h1>รุ่นหนึ่ง</h1>\n' }
S2 = { name: 'index.html', content: '<h1>รุ่นสองจาก B</h1>\n' }
SA = { name: 'index.html', content: '<h1>งานต่อของ A</h1>\n' }
SB = { name: 'index.html', content: '<h1>งานต่อของ B</h1>\n' }
```

### GIT-01 — บทเรียน A → GitHub → B → GitHub → A

1. Initial → Edit A=S1 → Stage A → Commit A message=`first version`: ได้ C1 parent=null, A known=[C1], A HEAD=C1, A index/working=S1; remote HEAD=null และ B ยังไม่มี repo
2. Push A: remote known=[C1], remote HEAD=C1, A origin=C1; B ทุกค่าเท่าเดิม
3. Clone B: B initialized=true, known=[C1], main/origin=C1, index/working=S1; registry มี C1 ตัวเดิม
4. Edit B=S2 → Stage B → Commit B message=`update on B`: ได้ C2 parent=C1, B HEAD=C2; remote/A ยัง C1
5. Push B: remote known=[C1,C2], HEAD=C2, B origin=C2; A known=[C1], main/origin=C1 และ working=S1
6. Pull A: A known=[C1,C2], main/origin=C2, working/index=S2; nextCommitNumber=3 และ registry มีเพียง C1/C2

### GIT-02 — Stage แล้วแก้ไฟล์ต่อก่อน Commit

Initial → Edit A=S1 → Stage A → Edit A=SA → Commit A message=`stage snapshot`: C1.snapshot=S1, A index=S1, working=SA, hasStaged=false, hasUnstaged=true กด Commit ซ้ำโดยไม่ Stage ได้ `NOTHING_STAGED` และ counter ไม่เพิ่ม Stage A อีกครั้งแล้ว Commit สร้าง C2.snapshot=SA

### GIT-03 — Push ถูกปฏิเสธและ Pull รับข้อมูลก่อนพบ divergence

เริ่มหลัง GIT-01 ข้อ 3 ที่ทุกฝั่งรู้ C1:

1. A Edit=SA → Stage → Commit `A change`: C2 parent=C1, A main=C2 และ origin=C1
2. B Edit=SB → Stage → Commit `B change`: C3 parent=C1, B main=C3 และ origin=C1
3. B Push: remote main=C3 และ known=[C1,C3]; A ยัง known=[C1,C2]
4. A Push: `NON_FAST_FORWARD`, rejected, changed=false; state ทุกส่วนต้องเท่ากับก่อน Push และ A ไม่แอบรู้ C3
5. A Pull: `DIVERGED`, rejected, changed=true; A known=[C1,C2,C3], origin=C3 แต่ main=C2, working/index=SA; remote/B ไม่เปลี่ยน
6. Undo ข้อ 5 คืน known=[C1,C2], origin=C1 ทั้งหมดภายในหนึ่ง Undo; Redo คืน fetch result เดิม
7. A Pull ซ้ำจากผลข้อ 5: `DIVERGED`, changed=false, ไม่มี history ใหม่ ทุกงานของ A/B ยังดูได้ใน repository ที่รู้ commit นั้น

### GIT-04 — Working/index ไม่สะอาดก่อน Pull

เริ่มหลัง GIT-01 ข้อ 5 ที่ A ยัง C1 และ GitHub เป็น C2: Edit A=SA แล้ว Pull → `DIRTY_WORKTREE`, changed=false, A known ยัง [C1], origin ยัง C1 ทำอีก fixture โดย Edit แล้ว Stage แต่ยังไม่ Commit ผลเหมือนกันทั้งสองกรณี ห้าม fetch ก่อนตรวจ dirty

### GIT-05 — เครื่อง ahead ไม่ถูกดึงย้อน

เริ่มหลัง GIT-01 ข้อ 3 ให้ A ทำ C2 จาก SA แต่ยังไม่ Push จากนั้น A Pull → `NO_CHANGE` เพราะ remote ยัง C1 และ A tracking รู้ C1 อยู่แล้ว A main=C2 และ working/index=SA เช่นเดิม ไม่มี C3 ถ้าใช้ fixture ที่ A tracking=null แต่มี known ancestors ครบ ให้ Pull เปลี่ยน origin เป็น C1 แล้วได้ `FETCHED_UP_TO_DATE`, changed=true โดยไม่เปลี่ยน local HEAD

### GIT-06 — Validation และ no-op

| การทดลอง | ผลที่ต้องได้ |
|---|---|
| Commit เริ่มต้นด้วยข้อความว่าง | `INVALID_MESSAGE`, state/counter คงเดิม |
| Commit เริ่มต้นด้วยข้อความ valid | `NOTHING_STAGED` |
| Push ก่อนมี Commit | `NO_LOCAL_COMMITS` |
| Clone ตอน remote ว่าง | `REMOTE_EMPTY`, B ยังไม่ initialized |
| Edit/Stage/Commit/Push/Pull บน B ก่อน Clone | `NOT_INITIALIZED` |
| Clone B ซ้ำ | `ALREADY_INITIALIZED`, ไฟล์ B เดิมไม่เปลี่ยน |
| Stage snapshot ที่เท่า index | `NO_CHANGE`, ไม่มี history |
| Push/Pull ที่ไม่มี state เปลี่ยน | `NO_CHANGE`, ไม่มี history/animation |
| Rename เป็น `lesson.html` → Stage → Commit | commit ใหม่บันทึกชื่อใหม่; parent ยังเก็บชื่อเดิม |
| ชื่อมี slash, เกิน 120 code points หรือเนื้อหาเกิน 64 KiB | `INVALID_FILE`, ไม่ตัดเนื้อหาเงียบ ๆ |
| มี 200 commits แล้ว Stage เนื้อหาใหม่และ Commit | `COMMIT_LIMIT`, staged/working/counter คงเดิม |
| Input state ถูก freeze แล้วส่งทุก action | reducer ไม่แก้ input หรือ throw เพราะ mutation |
| state+action เดิมเรียกสองครั้ง | deep-equal result ไม่มีเวลาหรือสุ่มแทรก |

### GIT-08 — แก้ประวัติที่แยกกัน (เพิ่ม 2026-09-26)

ต่อจาก GIT-03 ข้อ 5 (A: main=C2, origin=C3, known C1–C3): Merge ฝั่งเรา → C4 {parent C2, mergeParent C3, snapshot SA}, A ahead 2 behind 0; Push ส่ง C2, C4 และ GitHub main=C4; B Pull fast-forward ไป C4 และได้ SA. Merge ฝั่ง GitHub → snapshot ของ C3. Merge ขณะไม่แยก = `NO_CHANGE`, มีงานค้าง = `DIRTY_WORKTREE`, ยังไม่เคย fetch = `REMOTE_EMPTY`. ใช้เวอร์ชัน GitHub → main=origin, working/index = snapshot ของ origin, known ตัดเหลือ ancestors ของ origin, ทำซ้ำ = `NO_CHANGE`. Schema ปฏิเสธ mergeParent ที่ไม่รู้/ไม่มี/ไม่เก่ากว่า/ซ้ำ parent. e2e: Push ถูกปฏิเสธ → Pull → การ์ดประวัติแยก → preview commit แสดง `+N −M` → Merge → Push → B Pull; Undo 3 ครั้งแล้ว “ทิ้งงานของเรา” ได้ไฟล์ของ GitHub

### GIT-07 — UI, history และการเก็บข้อมูล

- ทำ GIT-01 โดยแก้ไฟล์ในกล่องบนกระดานและกด Add/Commit/Push/Pull/Clone ในแผง ด้วยภาษาไทย; focus ใน textarea และ IME ไม่เปลี่ยน canvas tool; widget ใหม่เริ่มที่ `main.py` = `print("Hello World")`
- หลัง Commit พิมพ์ working ใหม่บนกระดานโดยยังไม่ blur แล้วกด Add ได้ทันที จากนั้น index ตรง draft; ชื่อไฟล์ invalid แล้วพยายามเปลี่ยน slide/preview/Save ต้องอยู่ editor เดิมพร้อม draft/error โดย document และ Git state ไม่เปลี่ยน; Escape ในกล่องไฟล์คืนเนื้อหาเดิม
- คลิก C1 แสดงโค้ดของ C1 แบบอ่านอย่างเดียว คลิกซ้ำกลับไปไฟล์ที่แก้อยู่ document ไม่เปลี่ยนและไม่มี history ใหม่
- Edit ช่วงเดียว Undo หนึ่งครั้ง; Add/Commit/Push/Pull อย่างละหนึ่ง Undo เมื่อ state เปลี่ยน Save ของแอปไม่สร้าง simulated commit
- Reset กลับ exact initial JSON; Undo Reset คืนทุก commit และ counter; Redo Reset คืน initial
- Clone widget แล้ว Commit เพิ่มในสำเนา ต้นฉบับไม่เปลี่ยน; duplicate slide มีผลเดียวกัน
- Lock widget เลือก ลาก แก้ไฟล์ ดู commit หรือใช้ Git action ไม่ได้; ปลดล็อกผ่าน Objects panel แล้วทำต่อได้
- Save → reload → workflow ทำต่อจาก staged snapshot เดิม รวมกรณี working ต่างจาก staged และ origin ล้ากว่า remote
- PNG/PDF แสดง A/B/GitHub ตาม current state และ known sets ไม่มี DOM controls หรือ commit preview; archive round trip คืน state deep-equal
- มากกว่า 6 commit แสดงวงล่าสุด 6 วงพร้อม “+N ก่อนหน้า” ถูกต้อง ไม่ทำให้ bounds ขยายออกนอก widget; commit เดียวกันสีเดียวกันทุกการ์ด และ DIVERGED แสดงเป็นทางแยก
- C3 บน A ก่อน fetch ใน GIT-03 ไม่มีในรายการ commit ของ A จึงดูไม่ได้ หลัง fetch ปรากฏเป็นทางแยกและดูได้ แม้ Pull ถูกปฏิเสธ

แหล่งอ้างอิง Git และวันที่ตรวจสอบอยู่ใน [ADR 0005](../adr/0005-git-teaching-simulator.md) เกณฑ์ integration ข้ามระบบและการบันทึกผลตรวจรับอยู่ใน [แผนส่งมอบ](06-delivery-and-acceptance.md)
