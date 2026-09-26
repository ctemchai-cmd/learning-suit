import type { CommitId, GitAction, GitTransition, RepositoryId } from "./model";
import type { FileValidationError, MessageValidationError } from "./selectors";

/** Thai UI copy for simulator results. Commit / Push / Pull are simulated lesson actions, not the app's cloud save. */

export const DIVERGED_MESSAGE = "รับข้อมูลจาก GitHub แล้ว แต่ประวัติแยกกัน (ต่างคนต่าง Commit) เลือก Merge เพื่อรวมประวัติ หรือใช้เวอร์ชันของ GitHub";
export const DIRTY_WORKTREE_MESSAGE = "โหมดจำลองนี้ให้ Commit งานที่ค้างก่อน Pull";
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
      return action.type === "merge" ? "Commit งานที่ค้างก่อน Merge" : DIRTY_WORKTREE_MESSAGE;
    case "NON_FAST_FORWARD":
      return `GitHub ปฏิเสธ Push: GitHub มี commit ที่${where} ยังไม่มี ให้ Pull เพื่อรับข้อมูลก่อน (ไม่มี force push)`;
    case "DIVERGED":
      return DIVERGED_MESSAGE;
  }
}
