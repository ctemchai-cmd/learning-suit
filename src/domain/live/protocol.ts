import { applyDocumentCommand, type DocumentTransaction } from "../document/commands";
import type { ProjectContent } from "../document/model";

// Shared drawing room (plan 08). The teacher's editor is the authority: every change goes to it, it validates and
// numbers it, then everyone applies the same transaction in the same order. Students see their own change at once
// (optimistic) and line it up again when the teacher's numbered copy arrives.

export type LiveRole = "host" | "guest";
export type Participant = { id: string; name: string; role: LiveRole; color: string };

export type LiveMessage =
  | { kind: "hello"; from: string; name: string }
  | { kind: "snapshot"; to: string; epoch: string; seq: number; content: ProjectContent; slideId: string | null; hostName: string }
  | { kind: "op"; from: string; opId: string; transaction: DocumentTransaction }
  | { kind: "applied"; epoch: string; seq: number; opId: string; author: string; transaction: DocumentTransaction }
  | { kind: "reject"; to: string; opId: string; reason: string }
  | { kind: "cursor"; from: string; slideId: string; x: number; y: number }
  | { kind: "slide"; slideId: string }
  | { kind: "asset-request"; from: string; assetId: string }
  | { kind: "asset"; to: string; assetId: string; mime: string; data: string | null }
  | { kind: "closed" }
  /** Teacher heartbeat: who is in charge and how far the numbering got (lets students notice missed changes). */
  | { kind: "host-alive"; epoch: string; seq: number };

/** Largest change a student may send (one pen stroke with many points fits easily). */
export const MAX_GUEST_TRANSACTION_BYTES = 512 * 1024;
const COLORS = ["#E11D48", "#2563EB", "#16A34A", "#D97706", "#7C3AED", "#0891B2", "#DB2777", "#65A30D", "#EA580C", "#4F46E5"];
export const participantColor = (id: string) => COLORS[[...id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % COLORS.length];

/**
 * What a student may change (the reason when not): objects on the slides (draw, move, edit, delete, order) —
 * not slides, the lesson title, locks, or images (they need the teacher's storage).
 */
export function guestPermission(transaction: DocumentTransaction): string | null {
  if (!transaction?.commands?.length) return "ไม่มีรายการ";
  if (JSON.stringify(transaction).length > MAX_GUEST_TRANSACTION_BYTES) return "รายการใหญ่เกินไป";
  for (const command of transaction.commands) {
    switch (command.type) {
      case "nodes.insert":
        if (command.nodes.some((node) => node.type === "image")) return "ผู้เรียนแทรกรูปภาพไม่ได้";
        if (command.nodes.some((node) => node.locked)) return "ผู้เรียนล็อกวัตถุไม่ได้";
        break;
      case "nodes.replace": case "nodes.remove": case "nodes.reorder":
        break;
      case "nodes.lock": return "เฉพาะครูที่ล็อกหรือปลดล็อกวัตถุได้";
      case "slide.insert": case "slide.remove": case "slide.update": case "slide.reorder": return "เฉพาะครูที่จัดการสไลด์ได้";
      case "project.rename": return "เฉพาะครูที่เปลี่ยนชื่อบทเรียนได้";
      case "assets.register": return "ผู้เรียนแทรกรูปภาพไม่ได้";
      default: return "รายการที่ไม่รู้จัก";
    }
  }
  return null;
}

type Pending = { opId: string; transaction: DocumentTransaction };

/**
 * A student's copy of the lesson: `confirmed` = everything the teacher numbered so far, `pending` = my changes
 * not confirmed yet, `content` = confirmed + pending (what the screen shows).
 */
export class GuestReplica {
  confirmed: ProjectContent;
  seq: number;
  pending: Pending[] = [];
  content: ProjectContent;

  constructor(content: ProjectContent, seq: number) {
    this.confirmed = content;
    this.content = content;
    this.seq = seq;
  }

  /** My change, shown at once. Returns the new content, or null when it does not apply. */
  local(opId: string, transaction: DocumentTransaction): ProjectContent | null {
    const result = applyDocumentCommand(this.content, transaction);
    if (!result.changed) return null;
    this.pending.push({ opId, transaction });
    this.content = result.content;
    return this.content;
  }

  /** A numbered change from the teacher. "gap" = a number was missed: ask for a fresh copy. */
  applied(seq: number, opId: string, transaction: DocumentTransaction): "ok" | "gap" | "old" {
    if (seq <= this.seq) return "old";
    if (seq !== this.seq + 1) return "gap";
    const result = applyDocumentCommand(this.confirmed, transaction);
    // The teacher validated it on the same document: a failure means the copies drifted apart.
    if (result.status === "invalid") return "gap";
    this.confirmed = result.content;
    this.seq = seq;
    this.pending = this.pending.filter((item) => item.opId !== opId);
    this.rebase();
    return "ok";
  }

  /** The teacher refused one of my changes: take it back. */
  rejected(opId: string): void {
    this.pending = this.pending.filter((item) => item.opId !== opId);
    this.rebase();
  }

  /** My unconfirmed changes again on top of the latest confirmed document (dropping those that no longer apply). */
  private rebase(): void {
    let content = this.confirmed;
    this.pending = this.pending.filter((item) => {
      const result = applyDocumentCommand(content, item.transaction);
      if (result.status === "invalid") return false;
      content = result.content;
      return true;
    });
    this.content = content;
  }

  /** A fresh copy from the teacher (join, or after a gap); unconfirmed changes are re-applied on top. */
  reset(content: ProjectContent, seq: number): void {
    this.confirmed = content;
    this.seq = seq;
    this.rebase();
  }
}
