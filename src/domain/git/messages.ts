import { hostOf, type HostId } from "../hosting";
import type { CommitId, GitAction, GitTransition, RepositoryId } from "./model";
import { currentBranch, headCommitId, type BranchNameError, type FileValidationError, type MessageValidationError } from "./selectors";

/** Thai UI copy for simulator results. Commit / Push / Pull are simulated lesson actions, not the app's cloud save. */

export const MERGE_HINT = "แก้ในไฟล์ให้เหลือแบบที่ต้องการ ลบเครื่องหมาย <<<<<<< ======= >>>>>>> แล้ว Add + Commit";
export const MERGING_BLOCKED_MESSAGE = "กำลัง merge อยู่: แก้ไฟล์ให้เสร็จแล้ว Add + Commit หรือกด “ยกเลิก merge” ก่อน";
export const UNRESOLVED_CONFLICT_MESSAGE = "ยังมีเครื่องหมาย conflict เหลืออยู่ (<<<<<<< ======= >>>>>>>) ลบให้หมดแล้ว Add ก่อน Commit";
export const DIRTY_WORKTREE_MESSAGE = "โหมดจำลองนี้ให้ Commit งานที่ค้างก่อน Pull";
export const BRANCH_IDEA = "branch คือทางแยกให้ลองของใหม่ โดย main ไม่โดนกระทบ";
export const DIRTY_SWITCH_MESSAGE = "Commit งานที่ค้างก่อนสลับ branch (ไม่เช่นนั้นงานที่ยังไม่ Commit จะหาย)";
export const NOT_ON_MAIN_MESSAGE = "ตอนนี้ไม่ได้อยู่ที่ main: Push / Pull ในตัวจำลองนี้ใช้กับ main เท่านั้น สลับไป main ก่อน";
export const NEED_COMMIT_FOR_BRANCH_MESSAGE = "ต้อง commit อย่างน้อยหนึ่งครั้งก่อนแตก branch";
export const RESET_TOOLTIP = "เริ่มตัวอย่างใหม่ ย้อนกลับด้วย Undo ได้";

export function repositoryLabel(repository: RepositoryId, host?: HostId): string {
  return repository === "remote" ? hostOf(host).name : `เครื่อง ${repository}`;
}

function commitList(ids: CommitId[]): string {
  if (ids.length <= 3) return ids.join(", ");
  return `${ids.length} commit (${ids[0]}–${ids[ids.length - 1]})`;
}

export function describeFileValidationError(error: FileValidationError): string {
  switch (error) {
    case "name-empty": return "ชื่อไฟล์ต้องมีอย่างน้อย 1 ตัวอักษร";
    case "name-too-long": return "ชื่อไฟล์ยาวได้ไม่เกิน 120 ตัวอักษร";
    case "name-invalid-character": return "ชื่อไฟล์ห้ามมี / \\ หรืออักขระควบคุม (เป็นชื่อไฟล์จำลอง ไม่ใช่ path)";
    case "content-too-large": return "เนื้อหาไฟล์ต้องไม่เกิน 64 KiB";
  }
}

export function describeMessageValidationError(error: MessageValidationError): string {
  switch (error) {
    case "message-empty": return "พิมพ์ข้อความ Commit ก่อน";
    case "message-too-long": return "ข้อความ Commit ยาวได้ไม่เกิน 200 ตัวอักษร";
    case "message-newline": return "ข้อความ Commit ต้องอยู่ในบรรทัดเดียว";
  }
}

export function describeBranchNameError(error: BranchNameError): string {
  switch (error) {
    case "branch-empty": return "พิมพ์ชื่อ branch ก่อน";
    case "branch-too-long": return "ชื่อ branch ยาวได้ไม่เกิน 40 ตัวอักษร";
    case "branch-invalid-character": return "ชื่อ branch ใช้ได้เฉพาะ A–Z a–z 0–9 . _ / - (ไม่มีเว้นวรรค)";
    case "branch-reserved": return "ชื่อ HEAD เป็นชื่อสงวน ใช้เป็นชื่อ branch ไม่ได้";
    case "branch-exists": return "มี branch ชื่อนี้อยู่แล้ว";
  }
}

/** Human readable Thai result for one reducer transition. Pure: derived only from the action and transition. */
export function describeGitTransition(action: GitAction, transition: GitTransition, hostId?: HostId): string {
  const H = hostOf(hostId).name;
  const MR = hostOf(hostId).mergeRequest;
  const machine = action.type === "reset" ? null : action.machine;
  const where = machine ? repositoryLabel(machine) : "";
  const state = transition.nextState;
  const repo = machine ? state.machines[machine] : null;

  switch (transition.code) {
    case "EDITED":
      return `แก้ไฟล์ ${repo?.working?.name ?? ""} บน${where} แล้ว (ยังไม่ได้ Add)`;
    case "STAGED":
      return `Add ไฟล์ ${repo?.index?.name ?? ""} บน${where} แล้ว พร้อม Commit`;
    case "COMMITTED": {
      const id = transition.affectedCommitIds[0] ?? repo?.mainHead ?? "";
      const branch = repo ? currentBranch(repo) : "main";
      if (branch !== "main") return `สร้าง ${id} บน branch ${branch} แล้ว (main ยังเหมือนเดิม)`;
      return `สร้าง ${id} บน${where} แล้ว (อยู่ในเครื่องนี้เท่านั้น จนกว่าจะ Push)`;
    }
    case "PUSHED": {
      const sent = transition.transfer?.commitIds ?? [];
      if (!sent.length) return `${H} มี ${repo?.mainHead ?? ""} อยู่แล้ว อัปเดต origin/main ของ${where} ให้ตรงกัน`;
      return `ส่ง ${commitList(sent)} ขึ้น ${H} แล้ว เครื่องอื่นจะได้รับเมื่อ Clone หรือ Pull`;
    }
    case "CLONED":
      return `Clone จาก ${H} มาที่${where} แล้ว (main = ${repo?.mainHead ?? ""})`;
    case "PULLED":
      return `Pull แล้ว: ${where} เลื่อน ${repo ? currentBranch(repo) : "main"} ไป ${repo ? headCommitId(repo) ?? "" : ""} และได้ไฟล์ตาม commit นั้น`;
    case "FETCHED_UP_TO_DATE":
      return `รับข้อมูลจาก ${H} แล้ว origin/main = ${repo?.originMainHead ?? ""} ${where} ไม่ต้องเลื่อน main`;
    case "MERGED": {
      // The learner's Commit finished a conflicted merge.
      const commit = state.commits[transition.affectedCommitIds[0] ?? ""];
      const pushHint = commit?.mergeParentId && commit.mergeParentId === repo?.originMainHead ? " กด Push ได้เลย" : "";
      return `สร้าง ${commit?.id ?? ""} จบการ merge แล้ว (รวม ${commit?.parentId ?? ""} กับ ${commit?.mergeParentId ?? ""} เป็น merge commit สองพ่อแม่)${pushHint}`;
    }
    case "AUTO_MERGED": {
      const commit = state.commits[transition.affectedCommitIds.at(-1) ?? ""];
      return `Git รวมให้เอง: แก้คนละบรรทัด ไม่ชนกัน สร้าง ${commit?.id ?? ""} รวมกับ ${commit?.mergeParentId ?? ""} ของ ${H} แล้ว กด Push ได้เลย`;
    }
    case "MERGE_CONFLICT": {
      const from = action.type === "branchMerge" ? action.name : "origin/main";
      return `ไฟล์ชนกัน: แก้บรรทัดเดียวกันกับ ${from} Git ใส่เครื่องหมายไว้ในไฟล์ให้แล้ว แต่ยังไม่ Commit ให้ ทำตามกรอบ “กำลัง merge” ด้านบน`;
    }
    case "MERGE_ABORTED":
      return `ยกเลิก merge แล้ว ไฟล์และ Staging กลับเป็นเหมือนก่อน merge (git merge --abort)`;
    case "MERGE_TAKEN":
      return `ใส่ไฟล์ของ${action.type === "mergeTake" && action.side === "theirs" ? "อีกฝั่ง" : "เรา"}ลงในไฟล์แล้ว (ยังไม่ได้ Add) ต่อไป Add แล้ว Commit`;
    case "MERGE_IN_PROGRESS": return MERGING_BLOCKED_MESSAGE;
    case "NOT_MERGING": return "ตอนนี้ไม่ได้อยู่ระหว่าง merge";
    case "UNRESOLVED_CONFLICT": return UNRESOLVED_CONFLICT_MESSAGE;
    case "BRANCH_PUSHED": {
      const name = repo ? currentBranch(repo) : "";
      const sent = transition.transfer?.commitIds ?? [];
      return `ส่ง branch ${name} ขึ้น ${H} แล้ว${sent.length ? ` (${commitList(sent)})` : ""} ${H} เก็บ branch นี้ไว้ข้าง main ต่อไปเปิด ${MR} ให้เพื่อนร่วมทีมตรวจ`;
    }
    case "MAIN_PROTECTED": return `main ถูกป้องกัน: ต้องแตก branch แล้วเปิด ${MR} (${H} ไม่ให้ Push เข้า main ตรง ๆ)`;
    case "MR_OPENED": {
      const request = state.remote.requests?.at(-1);
      return `เปิด ${MR} !${request?.id ?? ""}: ${request?.source ?? ""} → main แล้ว รอเพื่อนร่วมทีมดูการเปลี่ยนแปลงและอนุมัติ (Approve)`;
    }
    case "MR_APPROVED": return `${where} อนุมัติ !${action.type === "mrApprove" ? action.id : ""} แล้ว ตอนนี้ Merge เข้า main ได้`;
    case "MR_MERGED": {
      const id = action.type === "mrMerge" ? action.id : 0;
      const source = state.remote.requests?.find((request) => request.id === id)?.source ?? "";
      return `Merge !${id} แล้ว: ${H} สร้าง merge commit ${transition.affectedCommitIds[0] ?? ""} บน main และลบ branch ${source} บน ${H} ให้ (main เปลี่ยนแล้ว: ทั้งสองเครื่อง git switch main แล้ว git pull)`;
    }
    case "MR_FAST_FORWARDED": {
      const id = action.type === "mrMerge" ? action.id : 0;
      const source = state.remote.requests?.find((request) => request.id === id)?.source ?? "";
      return `Merge !${id} แล้ว (fast-forward: main ยังไม่ขยับจึงแค่เลื่อนไป ${transition.affectedCommitIds[0] ?? ""} ไม่สร้าง commit ใหม่) และลบ branch ${source} บน ${H} ให้ (ทั้งสองเครื่อง git switch main แล้ว git pull)`;
    }
    case "MR_NEED_BRANCH": return `ต้องอยู่ที่ branch ที่แตกจาก main (ไม่ใช่ main) จึงเปิด ${MR} ได้`;
    case "MR_NOT_PUSHED": return `ต้อง Push branch ขึ้น ${H} ก่อนเปิด ${MR}`;
    case "MR_NOTHING_NEW": return `branch นี้ยังไม่มีงานที่ main ไม่มี ต้อง Commit งานใหม่แล้ว Push ก่อนเปิด ${MR}`;
    case "MR_EXISTS": return `branch นี้มี ${MR} ที่เปิดอยู่แล้ว`;
    case "MR_LIMIT": return `เปิด ${MR} ได้ไม่เกิน 20 อัน กด Reset demo เพื่อเริ่มใหม่`;
    case "MR_NOT_FOUND": return `ไม่พบ ${MR} ที่เปิดอยู่`;
    case "MR_SELF_APPROVE": return `อนุมัติ ${MR} ของตัวเองไม่ได้: ต้องให้เพื่อนร่วมทีม (อีกเครื่อง) ตรวจแล้วกด อนุมัติ`;
    case "MR_NOT_APPROVED": return `ต้องมีคนอนุมัติ (Approve) ก่อนจึง Merge ได้`;
    case "MR_CONFLICT": return "ชนกับ main: ดึง main มา merge ใน branch แก้ conflict แล้ว Push ใหม่ (git switch <branch> แล้ว git pull origin main)";
    case "BRANCH_CREATED": {
      const name = action.type === "branchCreate" ? action.name.trim() : "";
      return `สร้าง branch ${name} จาก ${transition.affectedCommitIds[0] ?? ""} แล้วสลับไปอยู่ที่นั่น (HEAD → ${name}) ${BRANCH_IDEA}`;
    }
    case "SWITCHED": {
      const name = repo ? currentBranch(repo) : "";
      return `สลับไป branch ${name} แล้ว (HEAD → ${name}) ไฟล์ที่แก้อยู่เปลี่ยนเป็นของ ${transition.affectedCommitIds[0] ?? name}`;
    }
    case "FAST_FORWARDED": {
      const name = action.type === "branchMerge" ? action.name : "";
      const here = repo ? currentBranch(repo) : "";
      return `Fast-forward: ${here} ไม่มีงานใหม่ที่ ${name} ไม่มี จึงแค่เลื่อน ${here} ไปที่ ${transition.affectedCommitIds[0] ?? ""} (ไม่สร้าง commit ใหม่)`;
    }
    case "BRANCH_MERGED": {
      const id = transition.affectedCommitIds[0] ?? "";
      const name = action.type === "branchMerge" ? action.name : "";
      const here = repo ? currentBranch(repo) : "";
      return `Git รวมให้เอง: แก้คนละบรรทัด ไม่ชนกัน สร้าง ${id} รวม ${name} เข้า ${here} แล้ว เป็น merge commit ที่มีสองพ่อแม่`;
    }
    case "BRANCH_DELETED": {
      const name = action.type === "branchDelete" ? action.name : "";
      return `ลบ branch ${name} แล้ว (commit ของมันยังอยู่ในประวัติ เพราะรวมเข้า ${repo ? currentBranch(repo) : "main"} แล้ว)`;
    }
    case "RESET_TO_REMOTE":
      return `${where} ทิ้งงานของตัวเองแล้ว ใช้เวอร์ชันของ ${H} (main = ${repo?.mainHead ?? ""}) ย้อนกลับด้วย Undo ได้`;
    case "RESET":
      return `เริ่มตัวอย่างใหม่แล้ว ย้อนกลับด้วย Undo ได้`;
    case "NO_CHANGE":
      switch (action.type) {
        case "edit": return "ไฟล์เหมือนเดิม ไม่มีการเปลี่ยนแปลง";
        case "stage": return "ไฟล์ตรงกับที่ Add ไว้แล้ว ไม่มีอะไรใหม่ให้ Add";
        case "push": return `${H} มีประวัติล่าสุดของ${where} อยู่แล้ว ไม่มีอะไรต้องส่ง`;
        case "pull": return `${where} ทันกับ ${H} ล่าสุดแล้ว ไม่มีอะไรใหม่`;
        case "mergeTake": return "ไฟล์เหมือนกับฝั่งนั้นอยู่แล้ว";
        case "mrApprove": return `${where} อนุมัติ ${MR} นี้ไปแล้ว`;
        case "resetToRemote": return `${where} ตรงกับเวอร์ชันของ ${H} อยู่แล้ว`;
        case "reset": return "ตัวอย่างอยู่ในสถานะเริ่มต้นอยู่แล้ว";
        case "branchSwitch": return `คุณอยู่ที่ branch ${action.name} อยู่แล้ว`;
        case "branchMerge": return `Already up to date: ${repo ? currentBranch(repo) : "branch นี้"} มีงานของ ${action.name} ครบแล้ว ไม่ต้อง Merge`;
        default: return "ไม่มีการเปลี่ยนแปลง";
      }
    case "NOT_INITIALIZED":
      return `${where} ยังไม่มี repository ให้ Clone จาก ${H} ก่อน`;
    case "INVALID_FILE":
      return action.type === "edit" ? "ชื่อไฟล์หรือเนื้อหาไม่ถูกต้อง ยังไม่ได้แก้ไฟล์" : "ไฟล์ไม่ถูกต้อง";
    case "INVALID_MESSAGE":
      return "ข้อความ Commit ต้องยาว 1–200 ตัวอักษรและอยู่ในบรรทัดเดียว";
    case "NOTHING_STAGED":
      return "ยังไม่มีการเปลี่ยนแปลงที่ Add ไว้ ให้กด Add ก่อน Commit";
    case "COMMIT_LIMIT":
      return "ตัวจำลองนี้มีครบ 200 commit แล้ว ให้เพิ่มตัวจำลองใหม่หรือกด Reset demo";
    case "NO_LOCAL_COMMITS":
      return `${where} ยังไม่มี commit ให้ Push`;
    case "REMOTE_EMPTY":
      if (action.type === "clone") return `${H} ยังไม่มี commit ให้ Clone ให้เครื่อง A Push ก่อน`;
      if (action.type === "push") return `ต้อง Push main ขึ้น ${H} ก่อน (ตอนนี้ ${H} ยังว่าง) แล้วค่อย Push branch`;
      if (action.type === "resetToRemote") return `${where} ยังไม่รู้เวอร์ชันของ ${H} ให้ Pull ก่อน`;
      return `${H} ยังไม่มี commit ให้ Pull`;
    case "ALREADY_INITIALIZED":
      return `${where} มี repository แล้ว ไม่ต้อง Clone ซ้ำ`;
    case "DIRTY_WORKTREE":
      if (action.type === "branchSwitch") return DIRTY_SWITCH_MESSAGE;
      return action.type === "branchMerge" ? "Commit งานที่ค้างก่อน Merge" : DIRTY_WORKTREE_MESSAGE;
    case "NON_FAST_FORWARD":
      return `${H} ปฏิเสธ Push: ${H} มี commit ที่${where} ยังไม่มี ให้ Pull เพื่อรับข้อมูลก่อน (ไม่มี force push)`;
    case "INVALID_BRANCH_NAME": return "ชื่อ branch ต้องยาว 1–40 ตัวอักษร ใช้ได้เฉพาะ A–Z a–z 0–9 . _ / - และห้ามใช้ชื่อ HEAD";
    case "BRANCH_EXISTS": return "มี branch ชื่อนี้อยู่แล้ว ลองชื่ออื่น";
    case "BRANCH_NOT_FOUND": return "ไม่พบ branch นี้";
    case "BRANCH_LIMIT": return "สร้าง branch ได้ไม่เกิน 20 อัน (ไม่นับ main) ลบอันที่รวมแล้วก่อน";
    case "NEED_COMMIT_FOR_BRANCH": return NEED_COMMIT_FOR_BRANCH_MESSAGE;
    case "SAME_BRANCH": return "เลือก branch อื่นมา Merge เข้า branch ที่อยู่";
    case "BRANCH_NOT_MERGED": {
      const name = action.type === "branchDelete" ? action.name : "";
      return `ลบ branch ${name} ไม่ได้: ยังมีงานที่ยังไม่ได้ Merge เข้า branch ที่อยู่ (git branch -d ปฏิเสธ)`;
    }
    case "CANNOT_DELETE_BRANCH":
      return action.type === "branchDelete" && action.name === "main" ? "main ลบไม่ได้" : "ลบ branch ที่กำลังอยู่ไม่ได้ สลับไป branch อื่นก่อน";
    case "NOT_ON_MAIN": return NOT_ON_MAIN_MESSAGE;
  }
}
