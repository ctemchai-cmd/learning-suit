import type { CarriedLine, FlowFrame, FlowTone, Hop, Mark } from "../data/model";
import { createInitialSshState } from "./initial";
import { KEYGEN_COMMAND, type Machine, type SshAction, type SshMachine, type SshOutcome, type SshState, type SshTransition, type SshView } from "./model";

// Pure scenarios of the SSH simulator (plan 07 §4c): the final state plus the frames the board plays.
// Places ("spots") a frame names: a / b (the laptop's edge), priv / pub / known (+ ":b" for laptop B) = files in ~/.ssh,
// scanner (GitHub's door), github (its edge), hostkey, repo, keys (SSH keys list), key:a / key:b (rows), thief.

const hop = (from: string, to: string, label: string, tone: FlowTone = "data", detail?: CarriedLine[]): Hop => ({ from, to, label, tone, ...(detail ? { detail } : {}) });
export const NAME: Record<Machine, string> = { a: "เครื่อง A", b: "เครื่อง B" };
/** Where a file of ~/.ssh is drawn: laptop A uses the plain name, laptop B adds “:b”. */
export const fileSpot = (machine: Machine, file: "priv" | "pub" | "known" | "ssh") => (machine === "a" ? file : `${file}:b`);
export const hasKeys = (state: SshState, machine: Machine) => state[machine].priv && state[machine].pub;
const patch = (state: SshState, machine: Machine, change: Partial<SshMachine>): SshState => ({ ...state, [machine]: { ...state[machine], ...change } });

class Flow {
  readonly frames: FlowFrame<SshState>[] = [];
  constructor(public state: SshState) {}
  step(move: Hop | null, caption: string, update?: (state: SshState) => SshState, marks: Mark[] = []): this {
    if (update) this.state = update(this.state);
    this.frames.push({ hop: move, caption, state: this.state, marks });
    return this;
  }
}
/** `success` stays success even when nothing is stored (testing the door twice changes no files). */
function finish(start: SshState, flow: Flow, outcome: SshOutcome, message: string): SshTransition {
  const changed = JSON.stringify(flow.state) !== JSON.stringify(start);
  return { nextState: changed ? flow.state : start, changed, outcome, message, frames: flow.frames };
}
const noop = (state: SshState, message: string, outcome: SshOutcome = "noop"): SshTransition => ({ nextState: state, changed: false, outcome, message, frames: [] });
const onlyInOthers = (state: SshState, what: string) => noop(state, `${what} ใช้ได้ในขั้น “เครื่องอื่น / กุญแจหาย”`, "rejected");

const PUBLIC_KEY_LINES: CarriedLine[] = [{ kind: "code", text: "ssh-ed25519 AAAAC3Nza…" }, { kind: "user", text: "you@example.com" }];
const PUBLIC_KEY_OUT = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5… you@example.com";

// ---------------------------------------------------------------------------
// Steps 2–3 — create the key pair, register the public key
// ---------------------------------------------------------------------------

function keygen(state: SshState, machine: Machine): SshTransition {
  const who = NAME[machine];
  if (hasKeys(state, machine)) return noop(state, `${who} มีคู่กุญแจอยู่แล้ว ไม่ต้องสร้างซ้ำ (สร้างใหม่จะได้ลายนิ้วมือคนละแบบ ต้องไปลงทะเบียนใหม่)`);
  const flow = new Flow(state);
  const ssh = fileSpot(machine, "ssh"), priv = fileSpot(machine, "priv"), pub = fileSpot(machine, "pub");
  flow.step(null, machine === "a" ? "รัน ssh-keygen: เครื่องเราสุ่มสร้างคู่กุญแจ ลงในโฟลเดอร์ ~/.ssh" : `${who} รัน ssh-keygen เพื่อสร้างคู่กุญแจของตัวเอง`,
    (s) => patch(s, machine, { cmd: KEYGEN_COMMAND, out: ["Generating public/private ed25519 key pair."] }), [{ spot: ssh, tone: "changed" }]);
  flow.step(null, "ได้ id_ed25519 = กุญแจลับ เปรียบเหมือนนิ้วจริงของเรา: อยู่ในเครื่องนี้เท่านั้นและไม่ส่งให้ใคร",
    (s) => patch(s, machine, { priv: true, out: ["Your identification has been saved in ~/.ssh/id_ed25519"] }), [{ spot: priv, tone: "new" }]);
  flow.step(null, "ได้ id_ed25519.pub = กุญแจสาธารณะ เปรียบเหมือนลายนิ้วมือ: แจกให้ GitHub ดูได้ ไม่เป็นอันตราย",
    (s) => patch(s, machine, { pub: true, out: ["Your public key has been saved in ~/.ssh/id_ed25519.pub"] }), [{ spot: pub, tone: "new" }]);
  return finish(state, flow, "success", `${who} สร้างคู่กุญแจแล้ว: id_ed25519 (ลับ) และ id_ed25519.pub (สาธารณะ)`);
}

function register(state: SshState, machine: Machine): SshTransition {
  const who = NAME[machine];
  if (!hasKeys(state, machine)) return noop(state, `${who} ยังไม่มีกุญแจให้ลงทะเบียน: ไปขั้น “สร้างคู่กุญแจ” ก่อน`, "rejected");
  if (state.registered.includes(machine)) return noop(state, `GitHub รู้จักลายนิ้วมือของ${who} แล้ว ไม่ต้องลงทะเบียนซ้ำ`);
  const flow = new Flow(state);
  flow.step(null, "เปิดไฟล์ .pub แล้วคัดลอกเนื้อหา: คัดลอกเฉพาะลายนิ้วมือ ไม่แตะกุญแจลับ",
    (s) => patch(s, machine, { cmd: "cat ~/.ssh/id_ed25519.pub", out: [PUBLIC_KEY_OUT] }), [{ spot: fileSpot(machine, "pub"), tone: "read" }]);
  flow.step(hop(fileSpot(machine, "pub"), "keys", ".pub", "data", PUBLIC_KEY_LINES), "วางลงที่ GitHub → Settings → SSH keys เหมือนแตะนิ้วลงทะเบียนที่เครื่องสแกนของประตู (ทำครั้งเดียว)",
    (s) => ({ ...s, registered: [...s.registered, machine] }), [{ spot: "keys", tone: "changed" }, { spot: `key:${machine}`, tone: "new" }]);
  flow.step(null, `GitHub จำลายนิ้วมือของ${who} ไว้แล้ว ต่อไปประตูจะเทียบกับลายนิ้วมือนี้ ✓`, undefined, [{ spot: `key:${machine}`, tone: "allowed" }]);
  return finish(state, flow, "success", `ลงทะเบียนกุญแจสาธารณะของ${who} กับ GitHub แล้ว`);
}

function revoke(state: SshState, machine: Machine): SshTransition {
  const who = NAME[machine];
  if (!state.registered.includes(machine)) return noop(state, `GitHub ไม่มีลายนิ้วมือของ${who} อยู่แล้ว ไม่มีอะไรให้ลบ`);
  const flow = new Flow(state);
  flow.step(null, `${who} หาย! เข้า GitHub → Settings → SSH keys แล้วลบกุญแจของเครื่องนี้ออก`, undefined, [{ spot: `key:${machine}`, tone: "blocked" }]);
  flow.step(null, `ลบแล้ว: เหมือนลบลายนิ้วมือนี้ออกจากระบบประตู ใครถือ${who} ไปก็เข้าไม่ได้อีก ✓`,
    (s) => ({ ...s, registered: s.registered.filter((item) => item !== machine) }), [{ spot: "keys", tone: "changed" }, { spot: `key:${machine}`, tone: "removed" }]);
  return finish(state, flow, "success", `ลบกุญแจของ${who} ออกจาก GitHub แล้ว: ต่อจากนี้${who} เข้าไม่ได้`);
}

// ---------------------------------------------------------------------------
// Step 4 — connect (the fingerprint scanner)
// ---------------------------------------------------------------------------

const DENIED_OUT = (mode: "test" | "push") => mode === "push"
  ? ["git@github.com: Permission denied (publickey).", "fatal: Could not read from remote repository."]
  : ["git@github.com: Permission denied (publickey)."];

function connect(state: SshState, machine: Machine, mode: "test" | "push"): SshTransition {
  const who = NAME[machine];
  const command = mode === "push" ? "git push" : "ssh -T git@github.com";
  const flow = new Flow(state);
  const priv = fileSpot(machine, "priv"), known = fileSpot(machine, "known");
  flow.step(hop(machine, "scanner", mode === "push" ? "git push" : "ssh -T", "request"), `${who} ขอเข้าประตูของ GitHub ผ่าน SSH`,
    (s) => patch(s, machine, { cmd: command, out: [] }));
  if (!state[machine].priv) {
    flow.step(hop("scanner", machine, "Permission denied", "blocked"),
      machine === "a" ? "GitHub: คุณคือใคร? ไม่มีลายนิ้วมือที่ลงทะเบียนไว้ ✗ Permission denied (publickey)"
        : "GitHub: คุณคือใคร? เครื่อง B ไม่มีนิ้วที่ตรงกับลายนิ้วมือที่ลงทะเบียนไว้ ✗ Permission denied (publickey)",
      (s) => patch(s, machine, { out: DENIED_OUT(mode) }), [{ spot: "scanner", tone: "blocked" }]);
    return finish(state, flow, "failed", machine === "a"
      ? "เข้าไม่ได้: เครื่องเรายังไม่มีกุญแจ GitHub จึงไม่รู้ว่าเราคือใคร (ไปขั้น “สร้างคู่กุญแจ”)"
      : "เครื่อง B เข้าไม่ได้: ไม่มีนิ้ว (กุญแจลับ) ที่ตรงกับลายนิ้วมือที่ลงทะเบียนไว้");
  }
  // First connection only: check this really is GitHub before touching the scanner.
  if (!state[machine].known) {
    flow.step(hop("hostkey", machine, "ลายนิ้วมือ GitHub", "request"),
      "ครั้งแรก: GitHub โชว์ลายนิ้วมือของตัวเอง ให้เช็กว่ามาถูกตึก (Are you sure you want to continue connecting?)",
      (s) => patch(s, machine, { out: ["The authenticity of host 'github.com' can't be established.", "Are you sure you want to continue connecting (yes/no)?"] }), [{ spot: "hostkey", tone: "read" }]);
    flow.step(hop(machine, known, "yes", "ok"), "ตอบ yes: เครื่องเราจดไว้ใน ~/.ssh/known_hosts ว่า “ใช่ GitHub ตัวจริง” ครั้งต่อไปไม่ต้องถามอีก ✓",
      (s) => patch(s, machine, { known: true, out: ["Warning: Permanently added 'github.com' (ED25519) to the list of known hosts."] }), [{ spot: known, tone: "new" }]);
  }
  if (!state.registered.includes(machine)) {
    flow.step(hop("scanner", machine, "Permission denied", "blocked"),
      `GitHub: ไม่มีลายนิ้วมือนี้ในระบบ ✗ Permission denied (publickey) — ต้องนำ .pub ของ${who} ไปลงทะเบียนก่อน`,
      (s) => patch(s, machine, { out: DENIED_OUT(mode) }), [{ spot: "scanner", tone: "blocked" }, { spot: "keys", tone: "blocked" }]);
    return finish(state, flow, "failed", `เข้าไม่ได้: GitHub ไม่มีลายนิ้วมือของ${who} (ยังไม่ได้ลงทะเบียน หรือถูกลบไปแล้ว) ไปขั้น “ลงทะเบียนกับ GitHub”`);
  }
  flow.step(hop("github", machine, "โจทย์สุ่ม", "request", [{ kind: "note", text: "โจทย์สุ่ม 7f3a9c…" }]), "เครื่องสแกนของ GitHub ขอให้แตะนิ้ว: ส่งโจทย์สุ่มมาให้เครื่องเรา");
  flow.step(null, "เครื่องเราใช้กุญแจลับเซ็นโจทย์อยู่ในเครื่อง: นิ้วไม่ได้ถูกส่งไปไหน ส่งแค่ผลการสแกน", undefined, [{ spot: priv, tone: "read" }]);
  flow.step(hop(machine, "scanner", "ลายเซ็น", "data", [{ kind: "code", text: "ลายเซ็น 9b1e42…" }, { kind: "pass", text: "ไม่มีกุญแจลับในก้อนนี้" }]),
    "ส่งกลับแค่ลายเซ็นของโจทย์ ไม่ใช่กุญแจลับ");
  flow.step(null, "ประตูเอาลายเซ็นไปเทียบกับกุญแจสาธารณะที่ลงทะเบียนไว้ ตรงกัน ✓ ประตูเปิด", undefined,
    [{ spot: "scanner", tone: "allowed" }, { spot: `key:${machine}`, tone: "allowed" }]);
  if (mode === "test") {
    flow.step(hop("scanner", machine, "Hi you!", "ok"), "GitHub: Hi you! You've successfully authenticated ✓ ประตูเปิดให้เราแล้ว",
      (s) => patch(s, machine, { out: ["Hi you! You've successfully authenticated,", "but GitHub does not provide shell access."] }));
    return finish(state, flow, "success", `ทดสอบผ่าน: GitHub ทักว่า Hi you! — ประตูเปิดให้${who}`);
  }
  flow.step(hop(machine, "repo", "โค้ด", "ok"), "ประตูเปิดแล้ว: โค้ดถูกส่งขึ้น repo ✓",
    (s) => ({ ...patch(s, machine, { out: ["To github.com:you/coffee-shop.git", "   main -> main"] }), pushes: Math.min(99, s.pushes + 1) }), [{ spot: "repo", tone: "new" }]);
  return finish(state, flow, "success", `git push สำเร็จ: ประตูเปิดให้${who} เพราะลายเซ็นตรงกับกุญแจสาธารณะที่ลงทะเบียนไว้`);
}

// ---------------------------------------------------------------------------
// Step 5 — other machines, a copied .pub
// ---------------------------------------------------------------------------

function thiefTry(state: SshState): SshTransition {
  if (!state.registered.includes("a")) return noop(state, "ยังไม่มีลายนิ้วมือของเครื่อง A บน GitHub ให้คัดลอก: ลงทะเบียนเครื่อง A ก่อน", "rejected");
  const flow = new Flow(state);
  flow.step(hop("keys", "thief", ".pub", "data", PUBLIC_KEY_LINES), "มีคนคัดลอก .pub ของเรามา: กุญแจสาธารณะใครก็เห็นได้ นั่นคือแค่ภาพลายนิ้วมือ",
    (s) => ({ ...s, thief: "copied" }));
  flow.step(hop("thief", "scanner", "ขอเข้า", "request"), "เขาเอา .pub ไปแจ้ง GitHub ว่า “ฉันคือเจ้าของ”");
  flow.step(hop("scanner", "thief", "โจทย์สุ่ม", "request", [{ kind: "note", text: "โจทย์สุ่ม 41c8d0…" }]), "เครื่องสแกนส่งโจทย์สุ่มมาให้เซ็นด้วยกุญแจลับ");
  flow.step(null, "เขามีแต่ภาพลายนิ้วมือ ไม่มีนิ้วจริง จึงเซ็นโจทย์ไม่ได้", undefined, [{ spot: "thief", tone: "blocked" }]);
  flow.step(hop("scanner", "thief", "Permission denied", "blocked"), "ประตูไม่เปิด ✗ ภาพถ่ายลายนิ้วมือสแกนไม่ผ่าน",
    (s) => ({ ...s, thief: "denied" }), [{ spot: "scanner", tone: "blocked" }]);
  return finish(state, flow, "failed", "คนที่คัดลอก .pub ไปเข้าไม่ได้: มีแค่ลายนิ้วมือ ไม่มีกุญแจลับที่เซ็นโจทย์ได้");
}

function setupB(state: SshState): SshTransition {
  if (hasKeys(state, "b") && state.registered.includes("b")) return noop(state, "เครื่อง B มีกุญแจของตัวเองและลงทะเบียนแล้ว");
  const generated = hasKeys(state, "b") ? null : keygen(state, "b");
  const flow = new Flow(generated ? generated.nextState : state);
  if (generated) flow.frames.push(...generated.frames);
  const registered = register(flow.state, "b");
  flow.frames.push(...registered.frames);
  flow.state = registered.nextState;
  return finish(state, flow, "success", "เครื่อง B สร้างกุญแจของตัวเองและลงทะเบียนแล้ว: แต่ละเครื่องมีกุญแจของตัวเอง");
}

function reset(state: SshState): SshTransition {
  const initial = createInitialSshState();
  if (JSON.stringify(initial) === JSON.stringify(state)) return noop(state, "เป็นค่าตั้งต้นอยู่แล้ว");
  const flow = new Flow(state).step(null, "เริ่มใหม่: ยังไม่มีกุญแจ GitHub ยังไม่รู้จักใคร", () => initial);
  return finish(state, flow, "success", "เริ่มใหม่แล้ว");
}

/** Applies one action in a lesson step. Never throws for user input; rejected actions change nothing. Laptop B and the copier only exist in the last step. */
export function applySshAction(state: SshState, action: SshAction, view: SshView): SshTransition {
  const others = view === "others";
  switch (action.type) {
    case "keygen": return action.machine === "b" && !others ? onlyInOthers(state, "เครื่อง B") : keygen(state, action.machine);
    case "register": return action.machine === "b" && !others ? onlyInOthers(state, "เครื่อง B") : register(state, action.machine);
    case "test": return action.machine === "b" && !others ? onlyInOthers(state, "เครื่อง B") : connect(state, action.machine, "test");
    case "push": return action.machine === "b" && !others ? onlyInOthers(state, "เครื่อง B") : connect(state, action.machine, "push");
    case "thief.try": return others ? thiefTry(state) : onlyInOthers(state, "การแอบใช้ .pub");
    case "revoke": return action.machine === "b" && !others ? onlyInOthers(state, "เครื่อง B") : revoke(state, action.machine);
    case "b.setup": return others ? setupB(state) : onlyInOthers(state, "เครื่อง B");
    case "reset": return reset(state);
  }
}
