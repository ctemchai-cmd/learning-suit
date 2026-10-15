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
  | 'NON_FAST_FORWARD' | 'COMMIT_LIMIT'
  // เพิ่ม 2026-10-15 (ดู “Merge จริงระดับบรรทัด”): 'AUTO_MERGED' | 'MERGE_CONFLICT' | 'MERGED' | 'MERGE_TAKEN' | 'MERGE_ABORTED'
  //   | 'MERGE_IN_PROGRESS' | 'NOT_MERGING' | 'UNRESOLVED_CONFLICT'  (DIVERGED ถูกยกเลิก);

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
| Pull | initialized, clean, remote HEAD มีค่า | fetch ก่อน integration ตามขั้นตอนด้านล่าง | dirty → `DIRTY_WORKTREE`; remote ว่าง → `REMOTE_EMPTY`; divergence → merge (`AUTO_MERGED` / `MERGE_CONFLICT`); กำลัง merging → `MERGE_IN_PROGRESS` |
| Reset | ไม่มี | แทน state ทั้งหมดด้วย initial fixture | state เท่ากับ initial → `NO_CHANGE` |

### Commit

ตรวจข้อความ → staged changes → commit limit ตามลำดับเพื่อให้ error precedence แน่นอน สร้าง `C${nextCommitNumber}` จาก index โดย copy ทั้งชื่อและเนื้อหา `index` ยังคง snapshot ที่เพิ่ง commit; working ไม่เปลี่ยน แม้จะต่างจาก index แล้วก็ตาม ไม่อัปเดต remote หรือ `originMainHead` ไม่มี timestamp/author/hash จริงในรุ่นนี้

### Ancestry และ Push

นิยาม `isAncestor(a,b,known)` ว่า a=b หรือไล่ parent จาก b (merge commit มีสอง parent: `parentId` และ `mergeParentId` เดินทั้งสองทาง) แล้วเจอ a โดยทุก node ต้องอยู่ใน known set; `null` ใช้เป็นฐานก่อนมี commit และถือเป็น ancestor ของทุก head ไม่มีการเดินจาก global registry แล้วเผย commit ที่เครื่องยังไม่รู้

Push ใช้ local known set ตรวจว่า remote HEAD เป็น ancestor ของ local HEAD หาก remote HEAD ไม่มีใน local known และ remote ไม่ว่าง ให้ reject non-FF ไม่แอบ fetch ให้ ผู้ใช้จะเข้าใจว่าต้อง Pull เพื่อรับข้อมูลก่อน

กรณี remote ว่างรับ ancestors ของ local HEAD ทั้งหมด กรณี HEAD เท่ากันไม่โอนข้อมูลใหม่ แต่อัปเดต `originMainHead` ของผู้ส่งให้ตรงหากยังล้าสมัย ผลเป็น `PUSHED` พร้อม changed=true เฉพาะที่เปลี่ยน tracking; ถ้าทุกค่าเท่าเดิมใช้ `NO_CHANGE` Working/index ของผู้ส่งอาจ dirty ได้เพราะ Push ส่ง commit เท่านั้น เครื่องอีกฝั่งไม่เปลี่ยนทุกกรณี

### Pull: fetch แล้ว fast-forward หรือ merge

1. ตรวจ initialized; ถ้ายังไม่ initialized ให้ `NOT_INITIALIZED`
2. ถ้า working/index ไม่ clean ให้ `DIRTY_WORKTREE` **ก่อน fetch** และไม่เปลี่ยนข้อมูลใด UI ระบุว่า “โหมดจำลองนี้ให้ Commit งานที่ค้างก่อน Pull” ไม่บอกว่าข้อจำกัดนี้ใช้กับ Git จริงทุกกรณี
3. ถ้า remote HEAD เป็น null ให้ `REMOTE_EMPTY` และไม่แก้ tracking
4. Fetch ancestors ของ remote HEAD เข้า local known IDs โดยคง commit ID และ snapshot เดิม แล้วตั้ง `originMainHead=remote.mainHead`
5. ถ้า local HEAD เท่ากับ remote HEAD หรือ remote HEAD เป็น ancestor ของ local HEAD: คง local HEAD/index/working ไว้ ผลเป็น `FETCHED_UP_TO_DATE` เมื่อ fetch เปลี่ยน state หรือ `NO_CHANGE` เมื่อไม่มีการเปลี่ยนเลย อย่าเลื่อนเครื่องที่ ahead ถอยหลัง
6. ถ้า local HEAD เป็น ancestor ของ remote HEAD: เลื่อน local HEAD ไป remote HEAD และตั้ง working/index เป็น snapshot ของหัวใหม่นั้น ผลเป็น `PULLED` ไม่มี commit ใหม่
7. ถ้าไม่เข้าเงื่อนไขข้างต้น (ประวัติแยก): เก็บผล fetch จากขั้น 4 แล้ว **merge `origin/main` เข้า `main`** แบบ 3-way ระดับบรรทัด (ดู “Merge จริงระดับบรรทัด” ด้านล่าง) — Git รวมให้เอง (`AUTO_MERGED`, สร้าง merge commit “Merge origin/main”) หรือหยุดที่ conflict (`MERGE_CONFLICT`, เข้าสถานะ merging, ไม่ Commit ให้) ครบ 200 commit → `COMMIT_LIMIT` (rejected แต่ยังเก็บ fetch)

(เดิมขั้นนี้คืน `DIVERGED` แล้วให้เลือก “เก็บไฟล์ของเรา/ของ GitHub” ทั้งไฟล์ — ยกเลิกแล้วเมื่อ 2026-10-15 เพราะไม่ตรงกับ Git จริงที่ผู้สอนต้องการสอน)

### Merge และใช้เวอร์ชัน GitHub (แก้ประวัติที่แยกกัน, เพิ่ม 2026-09-26)

- ~~`merge { machine, keep }`~~ ถูกแทนที่ด้วย Pull ที่ merge เอง + `mergeTake` / `mergeAbort` + Commit ระหว่าง merging (หัวข้อถัดไป)
- `resetToRemote { machine }` (“ทิ้งงานของเรา ใช้เวอร์ชัน GitHub”, เท่ากับ `git reset --hard origin/main`): ต้อง initialized และรู้ `originMainHead`; ทิ้ง working/index ที่ค้างด้วย เลื่อน main ไป origin ตั้ง working/index เป็น snapshot ของ origin และตัด known IDs ให้เหลือ ancestors ของ origin (commit ของเราที่ไม่มีใครรู้หายจากรายการ แต่ยังอยู่ใน registry จึง Undo คืนได้) ผล `RESET_TO_REMOTE` หรือ `NO_CHANGE` ถ้าตรงอยู่แล้ว; ถ้ากำลัง merging อยู่จะทิ้ง merge นั้นด้วย (ทางหนีของ Pull ที่ชน)
- Schema: `mergeParentId` optional ต้องมีอยู่จริง เลขน้อยกว่าตัวเอง ต่างจาก `parentId` และ `parentId` ต้องไม่เป็น null; known set ของทุก repository ต้องรวม parent ทั้งสองของทุก commit ที่รู้ เอกสารเก่าที่ไม่มี field นี้ยังอ่านได้

### Branch (ทางแยก, เพิ่ม 2026-10-05)

ขั้นบทเรียนที่ 4 `view: "branch"` ชื่อ "Branch (ทางแยก)" แสดงเฉพาะเครื่อง A + Git (ไม่มี GitHub) และวาดกราฟ commit เป็น lane

- **ข้อมูล (optional, เอกสารเก่าไม่มี = มีแค่ `main`, HEAD อยู่ที่ main):** `MachineRepository.branches?: Record<name, CommitId>` เฉพาะ branch อื่นนอกจาก `main` (≤ 20, ชื่อ 1–40 ตัว `[A-Za-z0-9._/-]` ไม่ใช่ `HEAD`/`main`/`__proto__`) และ `head?: string` (branch ปัจจุบัน ไม่เก็บเมื่อเป็น main; state ถูก normalize ให้ไม่มี `branches` ว่างหรือ `head: "main"`). `mainHead` ยังเป็นปลาย `main`. Commit graph ใช้ `parentId`/`mergeParentId` เดิม
- **Action ใหม่:** `branchCreate` (`git switch -c`: แตกจาก commit ปัจจุบันแล้วสลับไป; ปฏิเสธถ้ายังไม่มี commit — "ต้อง commit อย่างน้อยหนึ่งครั้งก่อนแตก branch"; ชื่อซ้ำ/ไม่ถูกต้อง/เกิน 20 ปฏิเสธ; งานที่ค้างติดไปด้วยเหมือน Git), `branchSwitch` (`git switch`: working+index เป็น snapshot ของปลาย branch; ปฏิเสธ `DIRTY_WORKTREE` เมื่อ working ≠ index หรือ index ≠ HEAD), `branchMerge` (`git merge <name>` เข้า branch ปัจจุบัน), `branchDelete` (`git branch -d`: ลบได้เฉพาะ branch ที่ไม่ใช่ main/ปัจจุบัน และรวมเข้า branch ปัจจุบันแล้ว; commit ยังอยู่ในประวัติ)
- **Commit** ขยับเฉพาะ branch ปัจจุบัน (`mainHead` เปลี่ยนเมื่ออยู่ที่ main เท่านั้น) นับรวมกับเพดาน 200 commit
- **Merge:** ถ้า branch ปัจจุบันเป็น ancestor ของอีกฝั่ง = fast-forward (ย้าย pointer + ไฟล์, ไม่มี commit ใหม่, `FAST_FORWARDED`); ถ้าอีกฝั่งเป็น ancestor ของปัจจุบัน = noop "Already up to date"; ไม่เช่นนั้น merge แบบ 3-way ระดับบรรทัดกับ common ancestor (commit เลขสูงสุดที่ทั้งสองฝั่งมี): แก้คนละบรรทัด = สร้าง merge commit เอง (`BRANCH_MERGED`, `parentId` = ปลายปัจจุบัน, `mergeParentId` = ปลาย branch ที่รวม, ข้อความ `Merge branch '<name>'`); แก้บรรทัดเดียวกัน = **conflict** (`MERGE_CONFLICT`, เข้าสถานะ merging) ไม่มี `keep` อีกแล้ว
- **Push / Pull / ใช้เวอร์ชัน GitHub ใช้กับ `main` เท่านั้น:** ถ้า HEAD อยู่ branch อื่นจะปฏิเสธ `NOT_ON_MAIN` พร้อมข้อความให้สลับไป main ก่อน (เลือกปฏิเสธแทน push เงียบ ๆ เพราะไฟล์ที่เห็นเป็นของ branch นั้น ผู้เริ่มเรียนจะสับสน) Push ส่ง `main` และบรรพบุรุษของมันเท่านั้น branch ที่ยังไม่ merge ไม่ถูกส่ง. ขั้น 1–3 ไม่มีปุ่มสร้าง/สลับ แต่เมื่อ HEAD ไม่ใช่ main จะมีการ์ด "อยู่ที่ branch X" พร้อมปุ่ม "สลับไป main"
- **ภาพ:** `main` เป็น lane 0; branch อื่นที่มี commit ของตัวเองได้ lane ถัดไปตามลำดับสร้าง (แตกออกจาก commit ต้นทางด้วยเส้นเฉียง), commit ที่ไม่อยู่ใน branch ใด (ฝั่ง GitHub ที่ fetch มา, branch ที่ลบแล้ว) อยู่ lane สุดท้าย. ป้ายชื่อ branch ที่ปลาย commit (main สีเข้ม, อื่น ๆ เขียว) และป้ายน้ำเงิน `HEAD → <branch>` + วงรอบ commit ปัจจุบัน + pill "คุณอยู่ที่ branch: X (HEAD)". ไฟล์ที่แสดงคือไฟล์ของ branch ปัจจุบัน
- **แผง (การ์ด 3 "Branch (ทางแยก)"):** ช่องชื่อ (แนะนำ `feature`, `feature-2`, …) + "สร้าง branch" (`git switch -c <name>`), ปุ่ม "สลับไป <name>" (`git switch`), "Merge <name> เข้า <current>" (`git merge`) ปุ่มเดียวทุกกรณี (ใต้ปุ่มบอกว่า Git รวมให้เอง / จะชนกัน), "ลบ branch <name>" (`git branch -d`) พร้อมข้อความเหตุผลเมื่อกดไม่ได้ และคำสั่งจริงใต้ปุ่มแต่ละอัน. "ทำต่อ": Add → Commit → (บน main ไม่มี branch) สร้าง branch → … → (บน branch ที่มีงานของตัวเอง) สลับไป main → Merge
- **Test:** GIT-09 (vitest: reducer, selectors, schema, lane layout) และ GIT-10 (Playwright)

### Merge จริงระดับบรรทัด และ conflict (เพิ่ม 2026-10-15)

เป้าหมายคือให้ผู้สอนโชว์ได้ว่า “แก้คนละบรรทัด → Git รวมให้เอง; แก้บรรทัดเดียวกัน → ต้องแก้ไฟล์เอง” เหมือน Git จริง ใช้กับทั้ง Pull ที่ประวัติแยก (merge `origin/main`) และ `branchMerge`

- **อัลกอริทึม** (`src/domain/git/merge3.ts`, pure): merge base = common ancestor ที่เลขสูงสุด (`mergeBase`, ใช้ known IDs หลัง fetch); diff3 — บรรทัดที่ base ใช้ร่วมกับทั้งสองฝั่งเป็นจุดยึด; ระหว่างจุดยึด ฝั่งที่ไม่เปลี่ยนรับของอีกฝั่ง, ผลเหมือนกันทั้งสองฝั่งเก็บครั้งเดียว (ไม่ conflict), นอกนั้น conflict (บรรทัดติดกันที่ต่างกันรวมเป็น hunk เดียวเหมือน Git; บรรทัดต้น/ท้ายที่สองฝั่งเหมือนกันถูกย้ายออกนอก hunk) ชื่อไฟล์ตามฝั่งที่เปลี่ยน (ours เมื่อเปลี่ยนทั้งคู่) ขึ้นบรรทัดใหม่ท้ายไฟล์ตามฝั่งที่เปลี่ยน
- **ไม่ conflict:** สร้าง merge commit ทันที (สองพ่อแม่, `Merge origin/main` / `Merge branch '<name>'`), working/index = ไฟล์ที่รวม; ผล `AUTO_MERGED` (Pull) / `BRANCH_MERGED`
- **conflict:** ไม่ Commit ให้ — `MachineRepository.merging?: { theirs: CommitId; label: string }` (label = ชื่อ branch หรือ `origin/main`; schema optional, เอกสารเก่าไม่กระทบ; ต้อง initialized, มี working+index, `theirs` อยู่ใน known, HEAD มี commit); working **และ** index ได้ไฟล์ที่มีเครื่องหมายแบบ Git (`<<<<<<< HEAD (ของเรา)` / `=======` / `>>>>>>> <label>`) ผล `MERGE_CONFLICT` (outcome success แต่แผงแสดงเป็นคำเตือนสีเหลือง) และช่อง Commit ถูกเติม “Merge …” ให้
- **Commit ระหว่าง merging:** ตรวจ message ก่อน แล้ว index ต้องไม่เหลือบรรทัด `<<<<<<<`/`=======`/`>>>>>>>` (ไม่งั้น `UNRESOLVED_CONFLICT` “ยังมีเครื่องหมาย conflict เหลืออยู่”) ไฟล์ที่เท่ากับ HEAD ก็ Commit ได้เพราะเป็น merge; ได้ commit ที่ `parentId` = ปลาย HEAD, `mergeParentId` = `merging.theirs`, ล้าง `merging`, ผล `MERGED`. Add ทำงานปกติ (index ← working) จึงต้อง Add ไฟล์ที่แก้แล้วก่อน
- **`mergeTake { machine, side }`** (ปุ่ม “ใช้ของเรา/ใช้ของอีกฝั่ง”): ใส่ไฟล์ HEAD หรือ `theirs` ลง working เท่านั้น (ไม่แตะ index) → ยังต้อง Add + Commit เอง; **`mergeAbort { machine }`** (“ยกเลิก merge”, `git merge --abort`): working/index = HEAD (merge เริ่มได้เฉพาะตอน clean จึงเท่ากับก่อน merge), ล้าง `merging`
- **ปฏิเสธขณะ merging** (`MERGE_IN_PROGRESS`, “กำลัง merge อยู่: แก้ไฟล์ให้เสร็จแล้ว Add + Commit หรือกด ‘ยกเลิก merge’ ก่อน”): Push, Pull, `branchSwitch`, `branchCreate`, `branchMerge`; `edit`/`stage`/`commit`/`mergeTake`/`mergeAbort`/`resetToRemote`/`branchDelete`/`reset` ใช้ได้
- **UI:** กล่องไฟล์ (overlay + ภาพบน canvas) ระบายพื้นหลังบรรทัด: เหลือง = เครื่องหมาย, เขียว = ของเรา, น้ำเงิน = ของอีกฝั่ง; pill “Staging” แสดง “⚠ ยังมี conflict” จนกว่าไฟล์ที่ Add จะสะอาด; ปุ่ม Add อธิบายว่า “ยังมีเครื่องหมาย conflict: แก้ไฟล์ก่อน แล้วค่อย Add”

### สลับ GitHub ↔ GitLab (เพิ่ม 2026-10-15)

`GitSimulatorNode.host?: "github" | "gitlab"` (schema optional, ไม่มี = GitHub; ชื่อและข้อความจาก `src/domain/hosting.ts` `hostOf(host)` ที่ใช้ร่วมกับตัวจำลอง SSH) ภายในยังใช้ id กลาง `remote` และฟิลด์เดิมทุกตัว ไม่เปลี่ยนชื่อ field. ชื่อ remote ส่งเข้า `describeGitTransition(action, transition, host)`, `getActionAvailability({ host })`, `machineDiagram(state, machine, host)`, `gitViewList(hostName)` และการวาดบน board ทั้งหมด (ค่าเริ่มต้น = GitHub จึงไม่กระทบเอกสาร/test เดิม). การสลับเป็นการแก้ node หนึ่ง transaction ไม่แตะ state ของ Git

### Merge Request / Pull Request (ขั้น 5 `review`, โบนัส, เพิ่ม 2026-10-15)

ขั้นบทเรียนที่ 5 `view: "review"` ชื่อ `${hostOf(host).mergeRequest} (ทีม)` ("Merge Request (ทีม)" บน GitLab, "Pull Request (ทีม)" บน GitHub — ห้าม hard-code) ใช้ layout เดียวกับขั้น 3 (A+Git ↔ remote ↔ B+Git, `gitHasMachineB`) และมีการ์ด MR ในกล่อง remote (ไฟล์ remote ย่อเหลือ 96px, การ์ด 118px, รายการ commit เหลือ ≥3 แถว)

- **Model (optional ทั้งคู่, เอกสารเก่าไม่กระทบ):** `remote.branches?: Record<branch, CommitId>` (branch อื่นที่ถูก Push ขึ้น remote, ≤20, ไม่มี `main`, ปลายต้องอยู่ใน `remote.knownCommitIds`) และ `remote.requests?: { id; source; target: "main"; title; status: "open"|"merged"|"closed"; author: MachineId; approvedBy: MachineId[] }[]` (≤ `GIT_LIMITS.requests` = 20, id = 1,2,3… ตามลำดับ, ผู้เขียนอนุมัติตัวเองไม่ได้, MR ที่ open ต้องมี branch ต้นทางอยู่บน remote)
- **การเปิดโหมด:** `push` และ `pull` มี flag `review?: boolean` ที่แผงใส่ให้เฉพาะขั้นนี้ (reducer ไม่รู้จัก view) ขั้น 2–4 ยังเป็นเดิมทุกอย่าง: Push จาก branch อื่น = `NOT_ON_MAIN` **ตัดสินใจ: ไม่เปิด Push branch ในขั้น 2–4** เพราะไม่มี remote branch ให้เห็นในขั้นเหล่านั้นและจะทำให้กราฟ remote สับสน
- **main ถูกป้องกัน** (`review` เท่านั้น): Push จาก main หลัง remote มี main แล้ว = `MAIN_PROTECTED` “main ถูกป้องกัน: ต้องแตก branch แล้วเปิด Merge Request” (Push main ครั้งแรกตอน remote ว่างยังทำได้ — เป็นจุดเริ่มโปรเจกต์) ปุ่ม Push ไม่ถูกปิด เพื่อให้ผู้สอนกดให้เห็นการปฏิเสธ
- **Push branch** (`git push -u origin <branch>`): จาก branch อื่น main ส่ง branch + commit ที่ remote ยังไม่มีขึ้นไป (`BRANCH_PUSHED`); remote ว่าง = `REMOTE_EMPTY`; ซ้ำ = `NO_CHANGE`; branch ที่ remote มีแล้วแต่ไม่ใช่ ancestor = `NON_FAST_FORWARD` การอนุมัติเดิมไม่ถูกล้างเมื่อ Push เพิ่ม (ตรงกับค่าเริ่มต้นของ GitHub/GitLab)
- **เปิด MR** `mrOpen { machine }`: ต้องอยู่ branch ที่ไม่ใช่ main (`MR_NEED_BRANCH`), branch ถูก Push แล้ว (`MR_NOT_PUSHED`), มีงานที่ main ไม่มี (`MR_NOTHING_NEW`), ยังไม่มี MR เปิดอยู่ของ branch นั้น (`MR_EXISTS`), ไม่เกิน 20 (`MR_LIMIT`) title = ข้อความ commit ปลาย branch ที่ Push; ปุ่ม “เปิด Merge Request: feature → main” (`GitHub`: Pull Request)
- **ตรวจ/อนุมัติ** `mrApprove { machine, id }`: เจ้าของอนุมัติเองไม่ได้ (`MR_SELF_APPROVE`), อนุมัติซ้ำ = `NO_CHANGE`; ปุ่ม “ดูการเปลี่ยนแปลง” แสดง diff ของ branch เทียบกับจุดที่แยกจาก main (ใช้ `lineDiff` เดิม, session เท่านั้น) และ “อนุมัติ (Approve)”
- **Merge** `mrMerge { machine, id }`: ต้องอนุมัติแล้ว (`MR_NOT_APPROVED`); ถ้า main ยังไม่ขยับ = fast-forward (`MR_FAST_FORWARDED`, ข้อความบอก); ถ้า main ขยับแล้วแก้คนละบรรทัด = merge commit สองพ่อแม่ “Merge branch '<b>' (!n)” บน remote (`MR_MERGED`); แก้บรรทัดเดียวกัน = `MR_CONFLICT` “ชนกับ main: ดึง main มา merge ใน branch แก้ conflict แล้ว Push ใหม่” (ไม่เปลี่ยนอะไร) สำเร็จแล้ว status = merged และ **ลบ branch ต้นทางบน remote เสมอ** (ข้อความบอก) คำนวณด้วย `requestInfo` (selectors) ตัวเดียวกับที่การ์ดบน board ใช้
- **ทางแก้ conflict (ใช้เครื่องมือ conflict เดิม):** บนเครื่องของเจ้าของ `git switch <branch>` แล้ว Pull (`review` อนุญาตบน branch = `git pull origin main`: fast-forward branch ถ้าทำได้ ไม่งั้น merge `origin/main` เข้า branch → `AUTO_MERGED` หรือ `MERGE_CONFLICT` → แก้ไฟล์ → Add → Commit → Push branch) แล้ว MR เปลี่ยนเป็น Merge ได้ (fast-forward)
- **Pipeline:** แสดงเพียงข้อความ “pipeline ✓ ผ่าน” บน MR ที่เปิดอยู่ (ผ่านเสมอ ไม่มี state)
- **Board:** การ์ด “Merge Request” ในกล่อง remote: `!1 feature → main`, chip (เปิดอยู่ / อนุมัติแล้ว / รวมแล้ว), เปิดโดย/อนุมัติโดย, pipeline, และ “Merge ได้ (fast-forward | สร้าง merge commit)” / “ชนกับ main” / “รอเพื่อนอนุมัติ”; รายการ commit ของ remote มี lane และป้ายของ branch ที่ Push
- **“ทำต่อ”** (`nextReviewStep`, ดูจากเครื่องที่เลือก): push main ครั้งแรก → สร้าง branch → แก้/Add/Commit → Push branch → เปิด MR → (เครื่องที่ไม่ใช่เจ้าของ) อนุมัติ → Merge → (เจ้าของ) สลับไป main → Pull; MR ที่ชนส่งเจ้าของกลับไป branch แล้ว Pull. การ์ดแผง: Add, Commit, Branch (แบบย่อ: สร้าง/สลับ), GitHub/GitLab (Push/Pull + คำสั่ง `git push -u origin <branch>`, `git pull origin main`), Merge Request

### Reset และการเริ่มบทเรียนใหม่

ปุ่มชื่อ **Reset demo** มี tooltip “เริ่มตัวอย่างใหม่ ย้อนกลับด้วย Undo ได้” ทำทันทีเป็นหนึ่ง transaction ไม่เพิ่ม dialog ยืนยัน ตั้ง counter กลับ 1 และล้าง commit registry ของ widget นั้น ผู้สอนใช้ Undo คืนทุกฝั่งได้ การแก้ divergence ใช้ Pull (merge) หรือ “ใช้เวอร์ชัน GitHub” (ไม่มี Rebase)

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
- **Commits**: รายการที่กว้าง (≥360) แสดงหนึ่งบรรทัด ข้อความซ้าย ป้ายขวา; รายการที่แคบกว่าแสดงสองบรรทัด ป้ายเล็กด้านบนและข้อความ commit ด้านล่าง (`commitListStyle`) ข้อความจึงไม่ถูกป้ายเบียดหาย วงกลมมี ID ข้างใน สีกำหนดจากหมายเลข (สีเดียวกัน = commit เดียวกันทุกการ์ด) ใหม่อยู่บน จำนวนวงเท่าที่พื้นที่ของรายการนั้นพอ (`commitRowLimit`: ขั้น 1 = 8, ขั้น 2 = 7/GitHub 5, ขั้น 3 = 6/GitHub 5; ภาพและปุ่มคลิกใช้ค่าเดียวกัน) + “+N ก่อนหน้า” เส้นเชื่อมไป parent (merge commit มีเส้นที่สองไป `mergeParentId`); lane แรกคือ first-parent ของ `main` ส่วน commit ที่รู้แต่ไม่อยู่บนเส้นนั้น (ระหว่าง merge ที่ชน หรือฝั่ง GitHub ที่ถูก merge เข้ามา) วางอีก lane จึงเห็นทางแยกและจุดที่รวมกลับ ป้าย `main` (ทึบ) และ `origin/main` (เส้นขอบ) ติดกับวงที่ชี้จริง
- **GitHub**: “เก็บ commit ที่ Push ขึ้นมา (แก้ไฟล์ตรงนี้ไม่ได้)”, pill `มี N commit`/`ยังว่าง`, กล่องโค้ดอ่านอย่างเดียวโทนเดียวกับ editor (tab ชื่อไฟล์ + ป้าย `C2 • main` หรือ `C2 • ดูอย่างเดียว` เมื่อคลิกดู commit) แสดงหลายบรรทัดพร้อมเลขบรรทัดและ “… อีก N บรรทัด”; ขณะเลือก widget มี textarea อ่านอย่างเดียววางทับให้เลื่อนดูทั้งไฟล์ ก่อน Push ครั้งแรกเป็นกล่องประ “ยังไม่มีไฟล์บน GitHub” และ Commits บน GitHub
- ลูกศร Push/Pull เชื่อมระหว่างการ์ดที่ระดับ Commits เท่านั้น เส้นและ animation อยู่ภายในกรอบ widget ไม่กระทบ bounds; ชื่อ widget และหมายเหตุหนึ่งบรรทัดท้ายภาพเปลี่ยนตามขั้น
- เครื่อง B ก่อน Clone แสดงกล่องประ “ยังไม่ได้ Clone” แทนทั้งไฟล์และ Git UI ต้องไม่แสดงเนื้อหาฝั่ง GitHub ในการ์ด B ก่อน Clone

Widget ขยับและ clone ทั้งชุด ปรับขนาดรักษาสัดส่วน ไม่หมุน เลือกได้เหมือน node ปกติ พิกัดภายในคงเดิมแล้วคูณ scale; ขั้นต่ำกว้าง 560 หน่วย และสูง 340 หน่วย Lock ป้องกันการเลือก transform การแก้ไฟล์ และ action ที่แก้ state ต้องปลดล็อกผ่าน Objects panel ก่อนเลือกเพื่อดู commit หรือใช้ action ไม่มีทางลัดสำหรับวัตถุ locked แยกจากระบบ selection กลาง

### แก้ไฟล์และดู commit บนกระดาน (DOM overlay)

เมื่อเลือก widget เดียวที่ไม่ล็อกด้วยเครื่องมือ Select จะมี DOM controls วางทับตำแหน่งเดียวกับภาพ (container ใช้ base coordinates ของ widget และ transform เดียวกับ canvas: translate ตามกล้อง, rotation, `zoom × scale` จึงตรงกันทุกระดับซูม) และซ่อนระหว่างลาก/ปรับขนาด/nudge ตำแหน่งทั้งหมดคำนวณจาก `widget-layout` ชุดเดียวกับที่วาด:

- **ไฟล์**: ช่องชื่อไฟล์ (ใน tab) และ textarea ของ working ตรงกล่อง “ไฟล์ที่แก้อยู่” ของเครื่องที่ initialized ใช้สี, ฟอนต์, ขนาด, ระยะบรรทัดและเลขบรรทัดชุดเดียวกับภาพ (`codeText`, `EDITOR`) จึงไม่มีอะไรขยับเมื่อเลือก widget; เลขบรรทัดเลื่อนตาม scroll ของ textarea (ชื่อสำหรับ assistive tech “ชื่อไฟล์บนเครื่อง A”, “แก้ไฟล์บนเครื่อง A”) เปิดเฉพาะเมื่อโปรเจกต์เขียนได้ ข้อผิดพลาด validation แสดงเป็น alert ในกล่องไฟล์
- **Commit**: ทุกแถวในรายการ Commits ของ repository ที่อยู่ในขั้นนั้น (A / GitHub / B) เป็นปุ่ม “ดูโค้ดของ C1 (เครื่อง A)” (`aria-pressed`) คลิกเพื่อแสดง snapshot ของ commit นั้นแบบ **อ่านอย่างเดียว** ในกล่องไฟล์ของเครื่องนั้น เป็น **diff เทียบ parent แรก** (บรรทัดเพิ่มพื้นเขียวและ +, บรรทัดลบพื้นแดงขีดฆ่าและ −, หน้าต่างเริ่มก่อนการเปลี่ยนแปลงแรก 2 บรรทัด, ป้าย `C3 · +N −M` บนแถบ tab ซึ่งย่อ tab ชื่อไฟล์ให้พอดีเสมอ; `lineDiff` ใน `domain/git/diff.ts` เป็น LCS รายบรรทัด) (หรือกล่องไฟล์ของ GitHub) พร้อมไฮไลต์แถว; คลิกแถวเดิมหรือกล่องไฟล์ (“กลับไปไฟล์ที่แก้อยู่”) เพื่อกลับ การดู commit ไม่ใช่ checkout: ไม่แก้ document ไม่เข้า history ไม่ถูก export และถูกล้างเมื่อ Undo/Redo/load/Reset; preview ของ commit ที่ repository ไม่รู้แล้วกลับไปแสดง working เอง ก่อนเปิด preview ให้ flush draft ของไฟล์ก่อน

### แผง Git (ด้านขวา)

เล็กที่สุดเท่าที่สอนได้ เรียงเป็นการ์ดเว้นระยะชัดเจน: หัวแผง, dropdown “ขั้นของบทเรียน” (native `<select>`: `1 · A → Git`, `2 · A → Git → GitHub`, `3 · A+Git → GitHub → B+Git` พร้อมคำอธิบายสั้นใต้ช่อง), (ขั้น 3) ปุ่มเลือกเครื่อง A/B ซึ่งเปลี่ยนตามอัตโนมัติเมื่อคลิกเข้าไปแก้ไฟล์หรือคลิก commit ของเครื่องนั้นบนกระดาน แล้วเป็นรายการขั้นตอนแบบมีหมายเลข: **① Add** (ปุ่ม Add), **② Commit** (ช่องข้อความ Commit มี label + ปุ่ม Commit; Enter = Commit) และตั้งแต่ขั้น 2 **③ GitHub** (Push/Pull คู่กัน); เครื่อง B ที่ยังไม่มี repo มีการ์ด Clone แทน การ์ดของ “ขั้นถัดไป” (`nextGitStep`: Add เมื่อไฟล์มีการแก้ที่ยังไม่ Add → Commit เมื่อมีของที่ Add แล้ว → Push เมื่อนำหน้า/Pull เมื่อตามหลังหรือประวัติแยก; ระหว่าง merging: แก้ไฟล์ (`resolve`) → Add → Commit) มีกรอบน้ำเงิน ป้าย “ทำต่อ” และปุ่มสีน้ำเงิน ต่อด้วยผลลัพธ์ล่าสุด (sticky ที่ขอบล่างของแผงจึงเห็นเสมอแม้การ์ดยาวเกินจอ) และปุ่ม Reset demo ขนาดเล็กชิดขวา แผงเปิดเองเมื่อเพิ่มหรือคลิกตัวจำลอง ทั้งแบบ docked, overlay (<1100 px) และโหมดสอน; ถ้าไม่ได้เลือก widget แท็บ Git เสนอ “เลือกตัวจำลอง Git ที่มีอยู่” ก่อนปุ่มเพิ่มตัวใหม่ และตัวใหม่จะไม่วางทับตำแหน่งตัวเดิม ไม่มี editor ไฟล์, preview staged/HEAD หรือ Inspect ในแผง ปุ่มที่ใช้ไม่ได้ปิดด้วย `aria-disabled` และเหตุผลอยู่ใต้ปุ่มในการ์ดเดียวกัน (อ่านได้ด้วย keyboard/screen reader ผ่าน `aria-describedby`) ส่วนเหตุผล “อ่านอย่างเดียว” แสดงครั้งเดียวด้านบน; reducer ยังต้องตรวจเองแม้ UI ปิดปุ่มแล้ว ทุก action flush draft ของไฟล์ก่อน แล้วอ่าน node ล่าสุดจาก store (ไม่ใช้ props ที่อาจเก่า)

ระหว่าง merging แสดงการ์ดสีเหลือง **“กำลัง merge: ไฟล์ชนกัน”** เหนือขั้นตอน ① พร้อมคำอธิบายบรรทัดเดียว “แก้ในไฟล์ให้เหลือแบบที่ต้องการ ลบเครื่องหมาย <<<<<<< ======= >>>>>>> แล้ว Add + Commit”, คำอธิบายสี (เขียว = ของเรา HEAD, น้ำเงิน = ของอีกฝั่ง, เหลือง = เครื่องหมาย), ปุ่มลัด “ใช้ของเรา” / “ใช้ของอีกฝั่ง” (`mergeTake`: ใส่ไฟล์ฝั่งนั้นลงกล่อง ยังต้อง Add + Commit เอง), ปุ่ม “ยกเลิก merge” (`git merge --abort`) และ (เมื่อ merge จาก Pull) ลิงก์ “ทิ้งงานของเรา ใช้เวอร์ชัน GitHub”

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
5. A Pull: SA กับ SB แก้บรรทัดเดียวกัน → `MERGE_CONFLICT`, success, changed=true; A known=[C1,C2,C3], origin=C3, main=C2 ยังไม่มี commit ใหม่, working/index = ไฟล์ที่มีเครื่องหมาย conflict, `merging={theirs:"C3",label:"origin/main"}`; remote/B ไม่เปลี่ยน
6. Undo ข้อ 5 คืน known=[C1,C2], origin=C1 ทั้งหมดภายในหนึ่ง Undo; Redo คืน fetch result เดิม
7. A Pull ซ้ำจากผลข้อ 5: `MERGE_IN_PROGRESS`, rejected, changed=false, ไม่มี history ใหม่ ทุกงานของ A/B ยังดูได้ใน repository ที่รู้ commit นั้น

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

ต่อจาก GIT-03 ข้อ 5 (A: main=C2, origin=C3, known C1–C3, merging): Commit ที่ยังมีเครื่องหมาย = `UNRESOLVED_CONFLICT`; แก้ไฟล์เองหรือ `mergeTake` แล้ว Add + Commit → C4 {parent C2, mergeParent C3, snapshot = ไฟล์ที่แก้}, ล้าง `merging`, A ahead 2 behind 0; Push ส่ง C2, C4 และ GitHub main=C4; B Pull fast-forward ไป C4. `mergeAbort` คืน working/index = HEAD. ระหว่าง merging Push/Pull/สลับ branch/สร้าง branch/merge ซ้ำ = `MERGE_IN_PROGRESS`; Pull ขณะมีงานค้างยัง `DIRTY_WORKTREE`. ใช้เวอร์ชัน GitHub → main=origin, working/index = snapshot ของ origin, ล้าง `merging`, known ตัดเหลือ ancestors ของ origin. Schema ปฏิเสธ mergeParent ที่ไม่รู้/ไม่มี/ไม่เก่ากว่า/ซ้ำ parent และ `merging` ที่ `theirs` ไม่อยู่ใน known / label ผิดรูป / เครื่องที่ยังไม่ clone. e2e GIT-08/GIT-11 ดูไฟล์ `tests/e2e/git.spec.ts`

### GIT-11 — แก้คนละบรรทัด Git รวมให้เอง; บรรทัดเดียวกันต้องแก้เอง (เพิ่ม 2026-10-15)

เครื่อง A และ B เริ่มจากไฟล์ 5 บรรทัด: B แก้บรรทัด 1 แล้ว Push, A แก้บรรทัด 5 แล้ว Commit → A Pull = `AUTO_MERGED` (merge commit สองพ่อแม่ ข้อความ “Merge origin/main”, ไฟล์มีทั้งสองการแก้, ข้อความ “Git รวมให้เอง: แก้คนละบรรทัด”) → Push ได้. รอบสอง: ทั้งคู่แก้บรรทัด 3 → Pull = `MERGE_CONFLICT` ไฟล์มี `<<<<<<< HEAD (ของเรา)` … `=======` … `>>>>>>> origin/main` (มีแถบสีในกล่องไฟล์) ปุ่ม Commit ปิดพร้อมเหตุผล “ยังมีเครื่องหมาย conflict เหลืออยู่” แล้ว “ยกเลิก merge” คืนไฟล์ → Pull ใหม่ → แก้ไฟล์เอง → Add → Commit (ช่องข้อความมี “Merge origin/main” ให้แล้ว) → Push → B Pull fast-forward (chromium + webkit)

### GIT-13 — Merge Request (เพิ่ม 2026-10-15)

vitest: Push main ใน review = `MAIN_PROTECTED` (ขั้นอื่นยัง `PUSHED`); Push branch ส่ง commit และ remote เก็บ branch; `mrOpen` ทุกกฎ; เจ้าของอนุมัติเอง = `MR_SELF_APPROVE`; Merge ก่อนอนุมัติ = `MR_NOT_APPROVED`; fast-forward / merge commit บน remote / `MR_CONFLICT`; ทางแก้ (pull main เข้า branch → แก้ → Push → Merge ได้); Pull บน branch; schema รับ/ปฏิเสธ `branches` `requests` และเอกสารเก่า. e2e (chromium + webkit): main ถูกป้องกัน → สร้าง branch → Push branch → เปิด MR → A อนุมัติเองไม่ได้ → B ดู diff + อนุมัติ → Merge (fast-forward, branch ถูกลบ) → B Pull, A สลับไป main + Pull; และ GitHub ใช้คำว่า Pull Request ทุกที่

### GIT-12 — สลับ GitHub ↔ GitLab (เพิ่ม 2026-10-15)

segmented control “GitHub | GitLab” ใต้หัวแผง เปลี่ยน `node.host` เป็นหนึ่ง transaction (“เปลี่ยนเป็น GitLab”) ชื่อ remote ใน board (การ์ด, ชื่อบนกรอบ, footer, สถานะ sync, “ยังไม่ได้ Clone”), dropdown ขั้นบทเรียน, ข้อความผลลัพธ์/เหตุผลปุ่ม, aria-label (“โค้ดบน GitLab (C1)”) เปลี่ยนตาม; Undo คืน host

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
- มากกว่า 6 commit แสดงวงล่าสุด 6 วงพร้อม “+N ก่อนหน้า” ถูกต้อง ไม่ทำให้ bounds ขยายออกนอก widget; commit เดียวกันสีเดียวกันทุกการ์ด และประวัติที่แยกแสดงเป็นทางแยก
- C3 บน A ก่อน fetch ใน GIT-03 ไม่มีในรายการ commit ของ A จึงดูไม่ได้ หลัง fetch ปรากฏเป็นทางแยกและดูได้ แม้ Pull ถูกปฏิเสธ

แหล่งอ้างอิง Git และวันที่ตรวจสอบอยู่ใน [ADR 0005](../adr/0005-git-teaching-simulator.md) เกณฑ์ integration ข้ามระบบและการบันทึกผลตรวจรับอยู่ใน [แผนส่งมอบ](06-delivery-and-acceptance.md)
