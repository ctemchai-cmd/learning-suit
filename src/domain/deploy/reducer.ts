import type { FlowFrame, FlowTone, Hop, Mark } from "../data/model";
import { createInitialDeployState } from "./initial";
import {
  DEPLOY_LIMITS, SITE_URL,
  type Deployment, type DeployAction, type DeployOutcome, type DeployState, type DeployTransition, type DeployView,
} from "./model";

// Pure scenarios of the deploy simulator (plan 07 §4): the final state plus the frames the board plays.
// Some flows depend on the lesson step (e.g. the secret key is only drawn from step 3 on), so the step is an input.

const codePoints = (value: string) => [...value].length;
const hop = (from: string, to: string, label: string, tone: FlowTone = "data"): Hop => ({ from, to, label, tone });

class Flow {
  readonly frames: FlowFrame<DeployState>[] = [];
  constructor(public state: DeployState) {}
  step(move: Hop | null, caption: string, update?: (state: DeployState) => DeployState, marks: Mark[] = []): this {
    if (update) this.state = update(this.state);
    this.frames.push({ hop: move, caption, state: this.state, marks });
    return this;
  }
}
function finish(start: DeployState, flow: Flow, outcome: DeployOutcome, message: string): DeployTransition {
  const changed = outcome !== "rejected" && JSON.stringify(flow.state) !== JSON.stringify(start);
  return { nextState: changed ? flow.state : start, changed, outcome: outcome === "success" && !changed ? "noop" : outcome, message, frames: flow.frames };
}
const noop = (state: DeployState, message: string, outcome: DeployOutcome = "noop"): DeployTransition => ({ nextState: state, changed: false, outcome, message, frames: [] });

export const deploymentOf = (state: DeployState, id: number | null) => (id === null ? null : state.deployments.find((item) => item.id === id) ?? null);
const setFriend = (state: DeployState, title: string, lines: string[], tone: DeployState["friend"]["tone"]): DeployState => ({ ...state, friend: { title, lines, tone } });

// ---------------------------------------------------------------------------
// Step 1 — open the site on the laptop
// ---------------------------------------------------------------------------

function localStart(state: DeployState): DeployTransition {
  if (state.local.running) return noop(state, "เซิร์ฟเวอร์ในเครื่องเปิดอยู่แล้ว");
  const flow = new Flow(state);
  flow.step(hop("code", "server", `โค้ดรุ่น ${state.code.rev}`), "เปิดเซิร์ฟเวอร์ในเครื่อง: โหลดโค้ดจากเครื่องเรา",
    (s) => ({ ...s, local: { ...s.local, running: true } }), [{ spot: "server", tone: "new" }]);
  flow.step(hop("server", "browser", "localhost:3000", "ok"),
    state.code.broken ? "browser ในเครื่องเปิด localhost:3000 ได้ แต่โค้ดมีข้อผิดพลาด (ตอน Build จะเจอ)" : "browser ในเครื่องเปิด localhost:3000 เห็นเว็บ ✓",
    (s) => ({ ...s, local: { ...s.local, showing: s.code.rev } }), [{ spot: "browser", tone: "new" }]);
  return finish(state, flow, "success", "เปิดเว็บในเครื่องแล้ว (localhost:3000)");
}

function localStop(state: DeployState): DeployTransition {
  if (!state.local.running) return noop(state, "เซิร์ฟเวอร์ในเครื่องปิดอยู่แล้ว");
  const flow = new Flow(state).step(null, "ปิดเซิร์ฟเวอร์ในเครื่อง: localhost เปิดไม่ได้แล้ว",
    (s) => ({ ...s, local: { running: false, showing: null }, laptop: { lines: [] } }), [{ spot: "server", tone: "removed" }]);
  return finish(state, flow, "success", "ปิดเซิร์ฟเวอร์ในเครื่องแล้ว");
}

function codeEdit(state: DeployState, raw: string, broken: boolean): DeployTransition {
  const title = raw.trim();
  if (!title || codePoints(title) > DEPLOY_LIMITS.titleCodePoints) return noop(state, `ชื่อหน้าเว็บต้องมี 1–${DEPLOY_LIMITS.titleCodePoints} ตัวอักษร`, "rejected");
  if (title === state.code.title && broken === state.code.broken) return noop(state, "โค้ดเหมือนเดิม");
  const rev = state.code.rev + 1;
  const flow = new Flow(state);
  flow.step(null, broken ? `แก้โค้ดเป็นรุ่น ${rev} แต่พิมพ์ผิดไว้หนึ่งจุด (ข้อผิดพลาด)` : `แก้โค้ดเป็นรุ่น ${rev}: หัวเว็บเป็น “${title}”`,
    (s) => ({ ...s, code: { rev, title, broken } }), [{ spot: "code", tone: broken ? "blocked" : "changed" }]);
  if (state.local.running) {
    flow.step(hop("code", "server", `รุ่น ${rev}`), "เซิร์ฟเวอร์ในเครื่องเห็นไฟล์เปลี่ยน");
    flow.step(hop("server", "browser", "รีเฟรชเอง", "ok"), "หน้าเว็บในเครื่องอัปเดตทันที ✓ แต่ยังไม่มีใครอื่นเห็น",
      (s) => ({ ...s, local: { ...s.local, showing: rev } }), [{ spot: "browser", tone: "changed" }]);
  }
  return finish(state, flow, "success", `แก้โค้ดเป็นรุ่น ${rev} แล้ว${state.github.rev !== null ? " (ยังไม่ได้ส่งขึ้น GitHub)" : ""}`);
}

function friendLocalhost(state: DeployState): DeployTransition {
  const flow = new Flow(state);
  flow.step(hop("friend", "localhostGate", "localhost:3000", "request"), "เพื่อนพิมพ์ localhost:3000 ในมือถือของตัวเอง");
  flow.step(hop("localhostGate", "friend", "ไม่พบเว็บ", "blocked"), "localhost แปลว่า “เครื่องของตัวเอง” มือถือเพื่อนจึงหาเว็บในเครื่องเราไม่เจอ ✗",
    (s) => setFriend(s, "เปิดไม่ได้", ["localhost:3000", "ไม่พบเว็บไซต์"], "error"), [{ spot: "localhostGate", tone: "blocked" }]);
  return finish(state, flow, "failed", "มือถือเพื่อนเปิด localhost ของเราไม่ได้");
}

// ---------------------------------------------------------------------------
// Step 2 — GitHub → Vercel → public URL
// ---------------------------------------------------------------------------

/** Keeps the list short: drops the oldest deployments that are not live. */
function trimDeployments(list: Deployment[], production: number | null): Deployment[] {
  const next = [...list];
  while (next.length > DEPLOY_LIMITS.deployments) {
    const index = next.findIndex((item) => item.id !== production);
    next.splice(index, 1);
  }
  return next;
}

/** GitHub tells Vercel → Build → (success) new deployment becomes Production; (failure) the live site stays. */
function build(flow: Flow, view: DeployView, trigger: string) {
  const { github, keys, nextDeployment: id, production } = flow.state;
  const rev = github.rev!;
  flow.step(hop("github", "vercel", trigger, "request"), "GitHub แจ้ง Vercel ให้สร้างเว็บรุ่นใหม่อัตโนมัติ");
  flow.step(hop("vercel", "build", `Build รุ่น ${rev}`, "request"), "Vercel กำลัง Build: แปลงโค้ดเป็นเว็บที่พร้อมใช้งาน");
  const deployment: Deployment = { id, rev, title: github.title, ok: !github.broken, hasKey: keys.vercel };
  if (github.broken) {
    flow.step(hop("build", "vercel", "✗ Build ล้ม", "blocked"),
      `Build ล้ม: โค้ดรุ่น ${rev} มีข้อผิดพลาด ✗ เว็บจริงยังเป็น${production ? `รุ่นเดิม (D${production})` : "แบบเดิม (ยังไม่มีเว็บ)"}`,
      (s) => ({ ...s, deployments: trimDeployments([...s.deployments, deployment], s.production), nextDeployment: id + 1 }),
      [{ spot: "build", tone: "blocked" }, { spot: `deploy:${id}`, tone: "blocked" }]);
    return;
  }
  const keyNote = view === "env" || view === "overall" ? (keys.vercel ? " (มีกุญแจฐานข้อมูล)" : " (ไม่มีกุญแจฐานข้อมูล!)") : "";
  flow.step(hop("build", `deploy:${id}`, `D${id} พร้อม`, "ok"), `Build ผ่าน ✓ ได้ Deployment D${id}${keyNote}`,
    (s) => ({ ...s, deployments: trimDeployments([...s.deployments, deployment], s.production), nextDeployment: id + 1 }),
    [{ spot: "build", tone: "allowed" }, { spot: `deploy:${id}`, tone: "new" }]);
  flow.step(hop(`deploy:${id}`, "url", "ใช้งานจริง", "ok"), `D${id} กลายเป็นเว็บจริงที่ ${SITE_URL} ทุกคนเปิดได้`,
    (s) => ({ ...s, production: id }), [{ spot: "url", tone: "changed" }, { spot: `deploy:${id}`, tone: "new" }]);
}

function push(state: DeployState, view: DeployView): DeployTransition {
  const { code } = state;
  if (state.github.rev === code.rev) return noop(state, `โค้ดรุ่น ${code.rev} ส่งขึ้น GitHub ไปแล้ว ลองแก้โค้ดก่อน`);
  const flow = new Flow(state);
  if (view === "env" || view === "overall") {
    flow.step(hop("envfile", "gitignore", "กุญแจ", "blocked"), "กุญแจใน .env.local ไม่ถูกส่งขึ้น GitHub (อยู่ใน .gitignore) ✓ ปลอดภัย",
      undefined, [{ spot: "gitignore", tone: "blocked" }]);
  }
  flow.step(hop("code", "github", `โค้ดรุ่น ${code.rev}`), `ส่งโค้ดรุ่น ${code.rev} ขึ้น GitHub`,
    (s) => ({ ...s, github: { rev: code.rev, title: code.title, broken: code.broken } }), [{ spot: "github", tone: "new" }]);
  build(flow, view, "เริ่ม Build");
  const latest = flow.state.deployments.at(-1)!;
  return finish(state, flow, latest.ok ? "success" : "failed", latest.ok ? `Deploy สำเร็จ: D${latest.id} ออนไลน์แล้ว` : `Build ล้ม: เว็บจริงยังเป็นรุ่นเดิม`);
}

function redeploy(state: DeployState, view: DeployView): DeployTransition {
  if (state.github.rev === null) return noop(state, "ยังไม่มีโค้ดบน GitHub ให้ Deploy ส่งโค้ดขึ้นก่อน", "rejected");
  const flow = new Flow(state);
  build(flow, view, "Deploy ใหม่");
  const latest = flow.state.deployments.at(-1)!;
  return finish(state, flow, latest.ok ? "success" : "failed", latest.ok ? `Deploy ใหม่สำเร็จ: D${latest.id}${latest.hasKey ? " มีกุญแจแล้ว" : ""}` : "Build ล้ม: เว็บจริงยังเป็นรุ่นเดิม");
}

function friendVisit(state: DeployState): DeployTransition {
  const flow = new Flow(state);
  flow.step(hop("friend", "url", "เปิดเว็บ", "request"), `เพื่อนเปิด ${SITE_URL}`);
  const live = deploymentOf(state, state.production);
  if (!live) {
    flow.step(hop("url", "friend", "ไม่พบเว็บ", "blocked"), "ยังไม่มีเว็บจริง: ต้องส่งโค้ดขึ้นและ Deploy ให้ผ่านก่อน ✗",
      (s) => setFriend(s, "เปิดไม่ได้", [SITE_URL, "ยังไม่มีเว็บไซต์"], "error"), [{ spot: "url", tone: "blocked" }]);
    return finish(state, flow, "failed", "ยังไม่มีเว็บจริงให้เปิด");
  }
  flow.step(hop("url", "friend", live.title, "ok"), `ได้หน้าเว็บจาก D${live.id} (รุ่น ${live.rev}) ✓ ใครก็เปิดได้จากทุกที่`,
    (s) => setFriend(s, live.title, [SITE_URL, `รุ่น ${live.rev} · D${live.id}`], "ok"), [{ spot: "url", tone: "read" }]);
  return finish(state, flow, "success", `เพื่อนเห็นเว็บรุ่น ${live.rev} (D${live.id})`);
}

function rollback(state: DeployState): DeployTransition {
  const current = state.production;
  const previous = [...state.deployments].reverse().find((item) => item.ok && current !== null && item.id < current);
  if (!previous) return noop(state, "ไม่มีรุ่นก่อนหน้าที่ใช้งานได้ให้ย้อน", "rejected");
  const flow = new Flow(state).step(hop(`deploy:${previous.id}`, "url", "ย้อนกลับ", "ok"),
    `ย้อนเว็บจริงกลับไปใช้ D${previous.id} (รุ่น ${previous.rev}) ทันที ไม่ต้อง Build ใหม่`,
    (s) => ({ ...s, production: previous.id }), [{ spot: `deploy:${previous.id}`, tone: "changed" }, { spot: "url", tone: "changed" }]);
  return finish(state, flow, "success", `ย้อนกลับไปใช้ D${previous.id} แล้ว`);
}

// ---------------------------------------------------------------------------
// Step 3 — the secret key (env)
// ---------------------------------------------------------------------------

function setVercelKey(state: DeployState, on: boolean): DeployTransition {
  if (state.keys.vercel === on) return noop(state, on ? "ใส่กุญแจบน Vercel ไว้แล้ว" : "บน Vercel ยังไม่มีกุญแจ");
  const flow = new Flow(state).step(on ? hop("envfile", "vercelEnv", "กุญแจ") : null,
    on ? "ใส่กุญแจฐานข้อมูลในหน้าตั้งค่าของ Vercel แล้ว ต้อง Deploy ใหม่ถึงจะใช้ได้" : "ลบกุญแจออกจาก Vercel: Deploy ครั้งถัดไปจะไม่มีกุญแจ",
    (s) => ({ ...s, keys: { ...s.keys, vercel: on } }), [{ spot: "vercelEnv", tone: on ? "new" : "removed" }]);
  return finish(state, flow, "success", on ? "ใส่กุญแจบน Vercel แล้ว กด Deploy ใหม่" : "ลบกุญแจออกจาก Vercel แล้ว");
}

function friendOrder(state: DeployState, raw: string, view: DeployView): DeployTransition {
  const item = raw.trim() || "ลาเต้";
  if (state.orders.length >= DEPLOY_LIMITS.orders) return noop(state, `สาธิตได้ไม่เกิน ${DEPLOY_LIMITS.orders} ออเดอร์ กด “เริ่มใหม่”`, "rejected");
  const flow = new Flow(state);
  flow.step(hop("friend", "url", `สั่ง${item}`), `เพื่อนสั่ง${item}บนเว็บจริง`);
  const live = deploymentOf(state, state.production);
  if (!live) {
    flow.step(hop("url", "friend", "ไม่พบเว็บ", "blocked"), "ยังไม่มีเว็บจริง: ต้อง Deploy ก่อน ✗",
      (s) => setFriend(s, "เปิดไม่ได้", [SITE_URL, "ยังไม่มีเว็บไซต์"], "error"), [{ spot: "url", tone: "blocked" }]);
    return finish(state, flow, "failed", "ยังไม่มีเว็บจริงให้สั่ง");
  }
  flow.step(hop("url", "vercel", "บันทึกออเดอร์", "request"), `เว็บ (D${live.id}) ส่งออเดอร์ไปที่เซิร์ฟเวอร์ของ Vercel`);
  if (!live.hasKey) {
    flow.step(hop("vercel", "supabase", "ไม่มีกุญแจ", "blocked"), `ต่อฐานข้อมูลไม่ได้: D${live.id} ไม่มีกุญแจ (ลืมใส่ใน Vercel) ✗`,
      undefined, [{ spot: "supabase", tone: "blocked" }, { spot: "vercelEnv", tone: "blocked" }]);
    flow.step(hop("vercel", "friend", "เกิดข้อผิดพลาด", "blocked"), "เว็บออนไลน์อยู่ แต่บันทึกออเดอร์ไม่ได้ ✗ ในเครื่องใช้ได้เพราะมี .env.local",
      (s) => setFriend(s, "เกิดข้อผิดพลาด", ["บันทึกออเดอร์ไม่สำเร็จ", "ต่อฐานข้อมูลไม่ได้"], "error"));
    return finish(state, flow, "failed", "เว็บจริงต่อฐานข้อมูลไม่ได้: ใส่กุญแจบน Vercel แล้ว Deploy ใหม่");
  }
  if (view === "overall") {
    flow.step(hop("vercel", "rls", `${item} + กุญแจ`, "request"), "ใช้กุญแจจากการตั้งค่า Vercel ต่อฐานข้อมูล แล้วผ่านด่านกฎสิทธิ์");
    flow.step(hop("rls", "orders", item, "ok"), "กฎสิทธิ์อนุญาต: ลูกค้าเพิ่มออเดอร์ของตัวเองได้ ✓ บันทึกลงตาราง",
      (s) => ({ ...s, orders: [...s.orders, item] }), [{ spot: "rls", tone: "allowed" }, { spot: "orders", tone: "new" }]);
  } else {
    flow.step(hop("vercel", "supabase", `${item} + กุญแจ`, "ok"), "ใช้กุญแจจากการตั้งค่า Vercel ต่อฐานข้อมูลได้ ✓ บันทึกออเดอร์",
      (s) => ({ ...s, orders: [...s.orders, item] }), [{ spot: "supabase", tone: "new" }]);
  }
  flow.step(hop(view === "overall" ? "orders" : "supabase", "friend", "✓ สั่งแล้ว", "ok"), "ออเดอร์ถูกบันทึกในฐานข้อมูล เพื่อนเห็นว่าสั่งสำเร็จ ✓",
    (s) => setFriend(s, "สั่งสำเร็จ", [`${item} ✓`, `ออเดอร์ที่ ${s.orders.length}`], "ok"));
  return finish(state, flow, "success", `บันทึกออเดอร์ “${item}” ผ่านเว็บจริงแล้ว`);
}

function localOrder(state: DeployState, raw: string): DeployTransition {
  const item = raw.trim() || "ลาเต้";
  if (!state.local.running) return noop(state, "เปิดเว็บในเครื่องก่อน", "rejected");
  if (state.orders.length >= DEPLOY_LIMITS.orders) return noop(state, `สาธิตได้ไม่เกิน ${DEPLOY_LIMITS.orders} ออเดอร์ กด “เริ่มใหม่”`, "rejected");
  const flow = new Flow(state);
  // An order sends data (the app shows “saving”), not a request to read.
  flow.step(hop("browser", "server", `สั่ง${item}`), `ลองสั่ง${item}บนเว็บในเครื่อง`);
  if (!state.keys.local) {
    flow.step(hop("envfile", "server", "ไม่มีกุญแจ", "blocked"), "เซิร์ฟเวอร์หากุญแจใน .env.local ไม่เจอ", undefined, [{ spot: "envfile", tone: "blocked" }]);
    flow.step(hop("server", "supabase", "ไม่มีกุญแจ", "blocked"), "ต่อฐานข้อมูลไม่ได้: ไม่มีกุญแจ ✗", undefined, [{ spot: "supabase", tone: "blocked" }]);
    flow.step(hop("server", "browser", "เกิดข้อผิดพลาด", "blocked"), "เว็บในเครื่องบันทึกออเดอร์ไม่ได้ ✗",
      (s) => ({ ...s, laptop: { lines: ["บันทึกไม่สำเร็จ ✗"] } }));
    return finish(state, flow, "failed", "ไม่มีกุญแจใน .env.local เว็บในเครื่องจึงต่อฐานข้อมูลไม่ได้");
  }
  flow.step(hop("envfile", "server", "กุญแจ"), "เซิร์ฟเวอร์อ่านกุญแจจาก .env.local", undefined, [{ spot: "envfile", tone: "allowed" }]);
  flow.step(hop("server", "supabase", `${item} + กุญแจ`, "ok"), "ใช้กุญแจต่อฐานข้อมูล บันทึกออเดอร์ ✓",
    (s) => ({ ...s, orders: [...s.orders, item] }), [{ spot: "supabase", tone: "new" }]);
  flow.step(hop("supabase", "browser", "✓ สั่งแล้ว", "ok"), "เว็บในเครื่องบันทึกออเดอร์ได้ ✓",
    (s) => ({ ...s, laptop: { lines: [`สั่ง${item}แล้ว ✓`] } }));
  return finish(state, flow, "success", `ในเครื่องบันทึก “${item}” ได้ (มีกุญแจใน .env.local)`);
}

function setLocalKey(state: DeployState, on: boolean): DeployTransition {
  if (state.keys.local === on) return noop(state, on ? "มีกุญแจใน .env.local อยู่แล้ว" : "ใน .env.local ไม่มีกุญแจอยู่แล้ว");
  const flow = new Flow(state).step(null, on ? "ใส่กุญแจฐานข้อมูลลงไฟล์ .env.local ในเครื่อง" : "เอากุญแจออกจาก .env.local",
    (s) => ({ ...s, keys: { ...s.keys, local: on } }), [{ spot: "envfile", tone: on ? "new" : "removed" }]);
  return finish(state, flow, "success", on ? "ใส่กุญแจใน .env.local แล้ว" : "เอากุญแจออกจาก .env.local แล้ว");
}

/** Chains several actions into one flow (frames concatenated, one final state). */
function chain(state: DeployState, view: DeployView, actions: DeployAction[], message: string): DeployTransition {
  let current = state;
  const frames: FlowFrame<DeployState>[] = [];
  for (const action of actions) {
    const result = applyDeployAction(current, action, view);
    if (result.outcome === "rejected") return result;
    frames.push(...result.frames);
    current = result.nextState;
  }
  const changed = JSON.stringify(current) !== JSON.stringify(state);
  return { nextState: changed ? current : state, changed, outcome: changed ? "success" : "noop", message: changed ? message : "เว็บพร้อมใช้งานอยู่แล้ว", frames };
}

function prepare(state: DeployState, view: DeployView): DeployTransition {
  const actions: DeployAction[] = [];
  if (state.code.broken) actions.push({ type: "code.edit", title: state.code.title, broken: false });
  if (!state.keys.vercel) actions.push({ type: "env.setVercel", on: true });
  const live = deploymentOf(state, state.production);
  const codeChanged = state.code.broken || state.github.rev !== state.code.rev;
  if (codeChanged) actions.push({ type: "push" });
  else if (!live || !live.hasKey) actions.push({ type: "redeploy" });
  return chain(state, view, actions, "เว็บจริงพร้อมใช้งานและมีกุญแจฐานข้อมูลแล้ว");
}

function reset(state: DeployState): DeployTransition {
  const initial = createInitialDeployState();
  if (JSON.stringify(initial) === JSON.stringify(state)) return noop(state, "เป็นค่าตั้งต้นอยู่แล้ว");
  const flow = new Flow(state).step(null, "เริ่มใหม่: กลับไปก่อน Deploy ครั้งแรก", () => initial);
  return finish(state, flow, "success", "เริ่มใหม่แล้ว");
}

/** Applies one action in a lesson step. Never throws for user input; rejected actions change nothing. */
export function applyDeployAction(state: DeployState, action: DeployAction, view: DeployView): DeployTransition {
  switch (action.type) {
    case "local.start": return localStart(state);
    case "local.stop": return localStop(state);
    case "code.edit": return codeEdit(state, action.title, action.broken);
    case "friend.localhost": return friendLocalhost(state);
    case "push": return push(state, view);
    case "friend.visit": return friendVisit(state);
    case "rollback": return rollback(state);
    case "env.setVercel": return setVercelKey(state, action.on);
    case "env.setLocal": return setLocalKey(state, action.on);
    case "redeploy": return redeploy(state, view);
    case "friend.order": return friendOrder(state, action.item, view);
    case "local.order": return localOrder(state, action.item);
    case "overall.prepare": return prepare(state, view);
    case "reset": return reset(state);
  }
}
