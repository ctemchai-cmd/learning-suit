import type { CommitId, GitAction, GitTransition, RepositoryId } from "./model";
import { currentBranch, type BranchNameError, type FileValidationError, type MessageValidationError } from "./selectors";

/** Thai UI copy for simulator results. Commit / Push / Pull are simulated lesson actions, not the app's cloud save. */

export const DIVERGED_MESSAGE = "รับข้อมูลจาก GitHub แล้ว แต่ประวัติแยกกัน (ต่างคนต่าง Commit) เลือก Merge เพื่อรวมประวัติ หรือใช้เวอร์ชันของ GitHub";
export const DIRTY_WORKTREE_MESSAGE = "โหมดจำลองนี้ให้ Commit งานที่ค้างก่อน Pull";
export const BRANCH_IDEA = "branch คือทางแยกให้ลองของใหม่ โดย main ไม่โดนกระทบ";
export const DIRTY_SWITCH_MESSAGE = "Commit งานที่ค้างก่อนสลับ branch (ไม่เช่นนั้นงานที่ยังไม่ Commit จะหาย)";
export const NOT_ON_MAIN_MESSAGE = "ตอนนี้ไม่ได้อยู่ที่ main: Push / Pull ในตัวจำลองนี้ใช้กับ main เท่านั้น สลับไป main ก่อน";
export const NEED_COMMIT_FOR_BRANCH_MESSAGE = "ต้อง commit อย่างน้อยหนึ่งครั้งก่อนแตก branch";
export const RESET_TOOLTIP = "เริ่มตัวอย่างใหม่ ย้อนกลับด้วย Undo ได้";

export function repositoryLabel(repository: RepositoryId): string {
  return repository === "remote" ? "GitHub" : `เครื่อง ${repository}`;
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
export function describeGitTransition(action: GitAction, transition: GitTransition): string {
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
      if (!sent.length) return `GitHub มี ${repo?.mainHead ?? ""} อยู่แล้ว อัปเดต origin/main ของ${where} ให้ตรงกัน`;
      return `ส่ง ${commitList(sent)} ขึ้น GitHub แล้ว เครื่องอื่นจะได้รับเมื่อ Clone หรือ Pull`;
    }
    case "CLONED":
      return `Clone จาก GitHub มาที่${where} แล้ว (main = ${repo?.mainHead ?? ""})`;
    case "PULLED":
      return `Pull แล้ว: ${where} เลื่อน main ไป ${repo?.mainHead ?? ""} และได้ไฟล์ตาม commit นั้น`;
    case "FETCHED_UP_TO_DATE":
      return `รับข้อมูลจาก GitHub แล้ว origin/main = ${repo?.originMainHead ?? ""} ${where} ไม่ต้องเลื่อน main`;
    case "MERGED": {
      const id = transition.affectedCommitIds[0] ?? repo?.mainHead ?? "";
      const merged = id ? state.commits[id]?.mergeParentId ?? "" : "";
      const side = action.type === "merge" && action.keep === "theirs" ? "ไฟล์จาก GitHub" : "ไฟล์ของเรา";
      return `สร้าง ${id} รวมประวัติกับ ${merged} ของ GitHub แล้ว (เก็บ${side}) กด Push ได้เลย`;
    }
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
      const side = action.type === "branchMerge" && action.keep ? ` (ไฟล์ชนกัน เก็บไฟล์${action.keep === "theirs" ? `ของ ${name}` : `ของ ${here}`})` : "";
      return `สร้าง ${id} รวม ${name} เข้า ${here} แล้ว${side} เป็น merge commit ที่มีสองพ่อแม่`;
    }
    case "BRANCH_DELETED": {
      const name = action.type === "branchDelete" ? action.name : "";
      return `ลบ branch ${name} แล้ว (commit ของมันยังอยู่ในประวัติ เพราะรวมเข้า ${repo ? currentBranch(repo) : "main"} แล้ว)`;
    }
    case "RESET_TO_REMOTE":
      return `${where} ทิ้งงานของตัวเองแล้ว ใช้เวอร์ชันของ GitHub (main = ${repo?.mainHead ?? ""}) ย้อนกลับด้วย Undo ได้`;
    case "RESET":
      return `เริ่มตัวอย่างใหม่แล้ว ย้อนกลับด้วย Undo ได้`;
    case "NO_CHANGE":
      switch (action.type) {
        case "edit": return "ไฟล์เหมือนเดิม ไม่มีการเปลี่ยนแปลง";
        case "stage": return "ไฟล์ตรงกับที่ Add ไว้แล้ว ไม่มีอะไรใหม่ให้ Add";
        case "push": return `GitHub มีประวัติล่าสุดของ${where} อยู่แล้ว ไม่มีอะไรต้องส่ง`;
        case "pull": return `${where} ทันกับ GitHub ล่าสุดแล้ว ไม่มีอะไรใหม่`;
        case "merge": return `${where} ไม่ได้แยกกับ GitHub ไม่ต้อง Merge`;
        case "resetToRemote": return `${where} ตรงกับเวอร์ชันของ GitHub อยู่แล้ว`;
        case "reset": return "ตัวอย่างอยู่ในสถานะเริ่มต้นอยู่แล้ว";
        case "branchSwitch": return `คุณอยู่ที่ branch ${action.name} อยู่แล้ว`;
        case "branchMerge": return `Already up to date: ${repo ? currentBranch(repo) : "branch นี้"} มีงานของ ${action.name} ครบแล้ว ไม่ต้อง Merge`;
        default: return "ไม่มีการเปลี่ยนแปลง";
      }
    case "NOT_INITIALIZED":
      return `${where} ยังไม่มี repository ให้ Clone จาก GitHub ก่อน`;
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
      if (action.type === "clone") return "GitHub ยังไม่มี commit ให้ Clone ให้เครื่อง A Push ก่อน";
      if (action.type === "merge" || action.type === "resetToRemote") return `${where} ยังไม่รู้เวอร์ชันของ GitHub ให้ Pull ก่อน`;
      return "GitHub ยังไม่มี commit ให้ Pull";
    case "ALREADY_INITIALIZED":
      return `${where} มี repository แล้ว ไม่ต้อง Clone ซ้ำ`;
    case "DIRTY_WORKTREE":
      if (action.type === "branchSwitch") return DIRTY_SWITCH_MESSAGE;
      return action.type === "merge" || action.type === "branchMerge" ? "Commit งานที่ค้างก่อน Merge" : DIRTY_WORKTREE_MESSAGE;
    case "NON_FAST_FORWARD":
      return `GitHub ปฏิเสธ Push: GitHub มี commit ที่${where} ยังไม่มี ให้ Pull เพื่อรับข้อมูลก่อน (ไม่มี force push)`;
    case "DIVERGED":
      return DIVERGED_MESSAGE;
    case "INVALID_BRANCH_NAME": return "ชื่อ branch ต้องยาว 1–40 ตัวอักษร ใช้ได้เฉพาะ A–Z a–z 0–9 . _ / - และห้ามใช้ชื่อ HEAD";
    case "BRANCH_EXISTS": return "มี branch ชื่อนี้อยู่แล้ว ลองชื่ออื่น";
    case "BRANCH_NOT_FOUND": return "ไม่พบ branch นี้";
    case "BRANCH_LIMIT": return "สร้าง branch ได้ไม่เกิน 20 อัน (ไม่นับ main) ลบอันที่รวมแล้วก่อน";
    case "NEED_COMMIT_FOR_BRANCH": return NEED_COMMIT_FOR_BRANCH_MESSAGE;
    case "SAME_BRANCH": return "เลือก branch อื่นมา Merge เข้า branch ที่อยู่";
    case "MERGE_CONFLICT": {
      const name = action.type === "branchMerge" ? action.name : "";
      return `ไฟล์ถูกแก้ไม่เหมือนกันทั้งสองฝั่ง (ชนกัน) เลือกเก็บไฟล์ของฝั่งเรา หรือใช้ไฟล์จาก ${name}`;
    }
    case "BRANCH_NOT_MERGED": {
      const name = action.type === "branchDelete" ? action.name : "";
      return `ลบ branch ${name} ไม่ได้: ยังมีงานที่ยังไม่ได้ Merge เข้า branch ที่อยู่ (git branch -d ปฏิเสธ)`;
    }
    case "CANNOT_DELETE_BRANCH":
      return action.type === "branchDelete" && action.name === "main" ? "main ลบไม่ได้" : "ลบ branch ที่กำลังอยู่ไม่ได้ สลับไป branch อื่นก่อน";
    case "NOT_ON_MAIN": return NOT_ON_MAIN_MESSAGE;
  }
}
