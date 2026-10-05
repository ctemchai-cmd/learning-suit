import { z } from "zod";
import { DATA_LIMITS } from "../data/model";
import { DEPLOY_LIMITS } from "../deploy/model";
import { AI_LIMITS } from "../ai/model";
import { LEGACY_SSH_VIEWS, SSH_LIMITS } from "../ssh/model";
import { LIMITS } from "./limits";
import { CODE_LANGUAGES, STENCIL_FRAMES, STENCIL_ICONS, type ProjectContent } from "./model";

const codePoints = (value: string) => [...value].length;
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const color = z.string().regex(/^#[0-9A-F]{6}$/);
const fill = z.union([color, z.literal("transparent")]);
const coordinate = z.number().finite().min(-LIMITS.coordinate).max(LIMITS.coordinate);
const size = z.number().finite().min(1).max(LIMITS.coordinate);
const point = z.strictObject({ x: coordinate, y: coordinate });
const title = z.string().refine((v) => v === v.trim() && codePoints(v) >= 1 && codePoints(v) <= LIMITS.titleCodePoints, "Name must be trimmed and 1–120 characters");
const base = {
  id: uuid,
  x: coordinate,
  y: coordinate,
  rotation: z.number().finite(),
  opacity: z.number().finite().min(0.05).max(1),
  locked: z.boolean(),
  groupId: uuid.optional(),
};
const stroke = {
  stroke: color,
  strokeWidth: z.number().finite().min(0.5).max(64),
  strokeStyle: z.enum(["solid", "dashed"]),
};
const rectangle = z.strictObject({ ...base, ...stroke, type: z.literal("rectangle"), width: size, height: size, fill });
const ellipse = z.strictObject({ ...base, ...stroke, type: z.literal("ellipse"), width: size, height: size, fill });
const unit = z.number().finite().min(0).max(1);
const side = z.enum(["n", "e", "s", "w"]);
const binding = z.strictObject({
  nodeId: uuid, anchor: z.enum(["n", "e", "s", "w", "auto", "fixed"]), at: z.strictObject({ x: unit, y: unit }).optional(),
  row: z.number().int().min(0).max(10_000).optional(), side: side.optional(),
})
  .refine((value) => (value.anchor === "fixed") === Boolean(value.at), "A fixed connection point needs `at` (and only it)")
  .refine((value) => value.row === undefined || value.anchor === "fixed", "A row belongs to a fixed connection point").optional();
const connector = { startBinding: binding, endBinding: binding, route: z.enum(["straight", "elbow", "curved"]).optional(), bend: coordinate.optional() };
const line = z.strictObject({ ...base, ...stroke, type: z.literal("line"), points: z.tuple([point, point]), ...connector });
const arrow = z.strictObject({ ...base, ...stroke, type: z.literal("arrow"), points: z.tuple([point, point]), headLength: size, headWidth: size, ...connector });
const pen = z.strictObject({ ...base, ...stroke, type: z.literal("pen"), points: z.array(point).min(1) });
const highlighter = z.strictObject({ ...base, ...stroke, type: z.literal("highlighter"), points: z.array(point).min(1) });
const text = z.strictObject({
  ...base, type: z.literal("text"), text: z.string().refine((v) => codePoints(v) <= LIMITS.textCodePoints),
  width: z.number().finite().min(24).max(LIMITS.coordinate), fontFamily: z.literal("Noto Sans Thai"),
  fontSize: z.number().finite().min(8).max(160), lineHeight: z.number().finite().positive().max(10),
  color, align: z.enum(["left", "center", "right"]), bold: z.boolean().optional(),
});
const image = z.strictObject({ ...base, type: z.literal("image"), assetId: uuid, width: size, height: size });
const code = z.strictObject({
  ...base, type: z.literal("code"),
  code: z.string().refine((v) => codePoints(v) <= LIMITS.codeCodePoints && v.split("\n").length <= LIMITS.codeLines, "Code is at most 10,000 characters and 300 lines"),
  language: z.enum(CODE_LANGUAGES), theme: z.enum(["dark", "light"]),
  fontSize: z.number().finite().min(LIMITS.codeFontMin).max(LIMITS.codeFontMax), lineNumbers: z.boolean(),
});
const tableRow = z.strictObject({
  cells: z.array(z.string().refine((v) => codePoints(v) <= LIMITS.tableCellCodePoints, "Cell text is at most 500 characters")),
  divider: z.boolean(),
});
const table = z.strictObject({
  ...base, type: z.literal("table"), variant: z.enum(["grid", "class"]),
  columns: z.array(z.number().finite().min(LIMITS.tableColumnMin).max(LIMITS.coordinate)).min(1).max(LIMITS.tableColumns),
  rows: z.array(tableRow).min(1).max(LIMITS.tableRows),
  header: z.boolean(), headerFill: color, stroke: color, color,
  fontSize: z.number().finite().min(LIMITS.tableFontMin).max(LIMITS.tableFontMax),
}).superRefine((node, ctx) => {
  if (node.rows.some((row) => row.cells.length !== node.columns.length)) ctx.addIssue({ code: "custom", message: "Every row needs one cell per column" });
  if (node.variant === "class" && node.columns.length !== 1) ctx.addIssue({ code: "custom", message: "A class box has one column" });
});
const stencil = z.strictObject({
  ...base, type: z.literal("stencil"), kind: z.enum([...STENCIL_FRAMES, ...STENCIL_ICONS]), width: size, height: size, color,
  label: z.string().refine((v) => codePoints(v) <= LIMITS.stencilLabelCodePoints && !/[\r\n\u2028\u2029]/.test(v), "Label is one line of at most 60 characters"),
});

const fileSnapshot = z.strictObject({
  name: z.string().refine((v) => v === v.trim() && codePoints(v) >= 1 && codePoints(v) <= 120 && !/[\\/\x00-\x1F\x7F-\x9F]/.test(v)),
  content: z.string().refine((v) => new TextEncoder().encode(v).length <= 64 * 1024),
});
const commitId = z.string().regex(/^C[1-9]\d*$/);
const commit = z.strictObject({ id: commitId, parentId: commitId.nullable(), mergeParentId: commitId.optional(), message: z.string().refine((v) => v === v.trim() && codePoints(v) >= 1 && codePoints(v) <= 200 && !/[\r\n\u2028\u2029]/.test(v)), snapshot: fileSnapshot });
const branchName = z.string().regex(/^[A-Za-z0-9._/-]{1,40}$/).refine((v) => v !== "HEAD" && v !== "main" && v !== "__proto__", "Reserved branch name");
const machine = z.strictObject({
  initialized: z.boolean(), working: fileSnapshot.nullable(), index: fileSnapshot.nullable(),
  mainHead: commitId.nullable(), originMainHead: commitId.nullable(), knownCommitIds: z.array(commitId),
  branches: z.record(branchName, commitId).optional(), head: branchName.optional(),
});
const remote = z.strictObject({ mainHead: commitId.nullable(), knownCommitIds: z.array(commitId) });
const gitState = z.strictObject({
  version: z.literal(1), commits: z.record(commitId, commit),
  machines: z.strictObject({ A: machine, B: machine }), remote,
  nextCommitNumber: z.number().int().positive(),
}).superRefine((state, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: "custom", message });
  const entries = Object.entries(state.commits);
  if (entries.length > 200) fail("Git commit limit exceeded");
  let highest = 0;
  for (const [key, value] of entries) {
    if (key !== value.id) fail(`Commit ID mismatch: ${key}`);
    const number = Number(key.slice(1));
    if (!Number.isSafeInteger(number)) fail(`Invalid commit ID: ${key}`);
    highest = Math.max(highest, number);
    if (value.parentId && (!state.commits[value.parentId] || Number(value.parentId.slice(1)) >= number)) fail(`Invalid parent: ${key}`);
    if (value.mergeParentId !== undefined && (!value.parentId || value.mergeParentId === value.parentId
      || !state.commits[value.mergeParentId] || Number(value.mergeParentId.slice(1)) >= number)) fail(`Invalid merge parent: ${key}`);
  }
  if (state.nextCommitNumber <= highest) fail("nextCommitNumber must exceed existing IDs");
  const checkKnown = (ids: string[], head: string | null, label: string) => {
    const known = new Set(ids);
    if (known.size !== ids.length || ids.some((id, i) => !state.commits[id] || (i > 0 && Number(ids[i - 1].slice(1)) >= Number(id.slice(1))))) fail(`${label} known commits invalid`);
    if (head && !known.has(head)) fail(`${label} head is unknown`);
    for (const id of ids) {
      for (const parent of [state.commits[id]?.parentId, state.commits[id]?.mergeParentId]) {
        if (parent && !known.has(parent)) fail(`${label} missing ancestor ${parent}`);
      }
    }
  };
  checkKnown(state.remote.knownCommitIds, state.remote.mainHead, "remote");
  for (const id of ["A", "B"] as const) {
    const repo = state.machines[id];
    checkKnown(repo.knownCommitIds, repo.mainHead, id);
    if (repo.originMainHead && !repo.knownCommitIds.includes(repo.originMainHead)) fail(`${id} origin/main is unknown`);
    const branches = Object.entries(repo.branches ?? {});
    if (branches.length > 20) fail(`${id} has too many branches`);
    for (const [name, tip] of branches) if (!repo.knownCommitIds.includes(tip)) fail(`${id} branch ${name} tip is unknown`);
    if (repo.head !== undefined && !(repo.branches && Object.prototype.hasOwnProperty.call(repo.branches, repo.head))) fail(`${id} HEAD is on a missing branch`);
    if (!repo.initialized && (repo.working || repo.index || repo.mainHead || repo.originMainHead || repo.knownCommitIds.length || branches.length)) fail(`${id} uninitialized state invalid`);
    if (repo.initialized && (!repo.working || (repo.mainHead && !repo.index))) fail(`${id} initialized state invalid`);
  }
  if (!state.machines.A.initialized) fail("Machine A must be initialized");
});
const gitSimulator = z.strictObject({
  ...base, type: z.literal("git-simulator"), rotation: z.literal(0),
  scale: z.number().finite().min(0.5).max(4), view: z.enum(["local", "remote", "full", "branch"]).optional(), state: gitState,
});

// Data-storage simulator (plan 07 §3): small coffee-shop tables with referential integrity.
const dataName = z.string().refine((v) => v === v.trim() && codePoints(v) >= 1 && codePoints(v) <= DATA_LIMITS.nameCodePoints);
const dataLine = z.string().refine((v) => codePoints(v) <= 160);
const rowId = z.number().int().min(1).max(1_000_000);
const phones = <T extends z.ZodTypeAny>(item: T) => z.strictObject({ A: item, B: item });
const storageList = z.array(dataName).max(DATA_LIMITS.storageItems);
const dataState = z.strictObject({
  version: z.literal(1),
  storage: z.strictObject({
    mode: z.enum(["app", "device", "cloud"]),
    memory: phones(storageList), device: phones(storageList), cloud: storageList, screen: phones(storageList),
  }),
  menu: z.array(z.strictObject({ id: rowId, name: dataName, price: z.number().int().min(0).max(DATA_LIMITS.price), available: z.boolean() })).max(DATA_LIMITS.rows),
  customers: z.array(z.strictObject({ id: rowId, name: dataName })).max(DATA_LIMITS.rows),
  orders: z.array(z.strictObject({ id: rowId, customerId: rowId, menuId: rowId, qty: z.number().int().min(1).max(99), copiedName: dataName })).max(DATA_LIMITS.rows),
  nextId: z.strictObject({ menu: rowId, customers: rowId, orders: rowId }),
  rulesOn: z.boolean(),
  phones: phones(z.strictObject({ title: dataLine, lines: z.array(dataLine).max(DATA_LIMITS.screenLines) })),
}).superRefine((state, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: "custom", message });
  for (const table of ["menu", "customers", "orders"] as const) {
    const ids = state[table].map((row) => row.id);
    if (new Set(ids).size !== ids.length) fail(`Duplicate ${table} ID`);
    if (ids.some((id) => id >= state.nextId[table])) fail(`nextId.${table} must exceed existing IDs`);
  }
  const customers = new Set(state.customers.map((row) => row.id));
  const menu = new Set(state.menu.map((row) => row.id));
  for (const order of state.orders) {
    if (!customers.has(order.customerId)) fail(`Order ${order.id} refers to a missing customer`);
    if (!menu.has(order.menuId)) fail(`Order ${order.id} refers to a missing menu item`);
  }
});
const dataSimulator = z.strictObject({
  ...base, type: z.literal("data-simulator"), rotation: z.literal(0),
  scale: z.number().finite().min(0.5).max(4), view: z.enum(["where", "table", "relation", "access"]), state: dataState,
});

// Deploy simulator (plan 07 §4).
const deployTitle = z.string().refine((v) => v === v.trim() && codePoints(v) >= 1 && codePoints(v) <= DEPLOY_LIMITS.titleCodePoints);
const deployState = z.strictObject({
  version: z.literal(1),
  code: z.strictObject({ rev: rowId, title: deployTitle, broken: z.boolean() }),
  local: z.strictObject({ running: z.boolean(), showing: rowId.nullable() }),
  github: z.strictObject({ rev: rowId.nullable(), title: z.string().refine((v) => codePoints(v) <= DEPLOY_LIMITS.titleCodePoints), broken: z.boolean() }),
  deployments: z.array(z.strictObject({ id: rowId, rev: rowId, title: deployTitle, ok: z.boolean(), hasKey: z.boolean() })).max(DEPLOY_LIMITS.deployments),
  production: rowId.nullable(),
  nextDeployment: rowId,
  keys: z.strictObject({ local: z.boolean(), vercel: z.boolean() }),
  friend: z.strictObject({ title: dataLine, lines: z.array(dataLine).max(6), tone: z.enum(["empty", "ok", "error"]) }),
  laptop: z.strictObject({ lines: z.array(dataLine).max(4) }),
  orders: z.array(dataName).max(DEPLOY_LIMITS.orders),
}).superRefine((state, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: "custom", message });
  const ids = state.deployments.map((item) => item.id);
  if (new Set(ids).size !== ids.length || ids.some((id) => id >= state.nextDeployment)) fail("Invalid deployment IDs");
  if (state.production !== null && !state.deployments.some((item) => item.id === state.production && item.ok)) fail("Production must be a successful deployment");
  if (state.github.rev !== null && state.github.rev > state.code.rev) fail("GitHub cannot be ahead of the laptop");
  if (state.local.showing !== null && (!state.local.running || state.local.showing > state.code.rev)) fail("Local server state invalid");
});
const deploySimulator = z.strictObject({
  ...base, type: z.literal("deploy-simulator"), rotation: z.literal(0),
  scale: z.number().finite().min(0.5).max(4), view: z.enum(["local", "localEnv", "vercel", "env", "overall"]), state: deployState,
});

// AI simulator (plan 07 §5). Scripted: the stored state is what the board shows, nothing else.
const aiLine = z.string().refine((v) => codePoints(v) >= 1 && codePoints(v) <= AI_LIMITS.lineCodePoints);
const chatMsg = z.strictObject({ role: z.enum(["user", "ai"]), text: aiLine, out: z.literal(true).optional() });
const chat = z.strictObject({ messages: z.array(chatMsg).max(AI_LIMITS.messages), shown: z.number().int().min(0).max(AI_LIMITS.messages), reading: z.literal(true).optional() })
  .refine((value) => value.shown <= value.messages.length, "Shown bubbles exceed the chat");
const aiState = z.strictObject({
  version: z.literal(1),
  history: chat,
  thinking: z.strictObject({
    on: z.boolean(), puzzle: z.enum(["pen", "letters", "apples"]).nullable(), thoughts: z.array(aiLine).max(8),
    answer: aiLine.nullable(), correct: z.boolean().nullable(), seconds: z.number().int().min(0).max(60),
  }),
  memory: z.strictObject({
    on: z.boolean(), items: z.array(z.strictObject({ key: z.enum(["name", "job", "like"]), value: aiLine })).max(3),
    messages: z.array(chatMsg).max(AI_LIMITS.messages), shown: z.number().int().min(0).max(AI_LIMITS.messages), chat: z.number().int().min(1).max(1_000_000),
    reading: z.literal(true).optional(),
  }).refine((value) => value.shown <= value.messages.length && new Set(value.items.map((item) => item.key)).size === value.items.length, "Invalid AI memory"),
  agent: z.strictObject({
    code: z.enum(["bug", "fixed"]), tests: z.enum(["unknown", "fail", "pass"]),
    web: z.strictObject({ asked: z.boolean(), answer: aiLine.nullable() }), log: z.array(aiLine).max(AI_LIMITS.log),
  }),
  cc: z.strictObject({
    rules: z.array(aiLine).max(4), memories: z.array(aiLine).max(AI_LIMITS.ccMemories), session: z.number().int().min(0).max(1_000_000),
    context: z.number().int().min(0).max(AI_LIMITS.ccContext + 8), chat: z.array(aiLine).max(AI_LIMITS.ccChat), summarized: z.boolean(),
    reading: z.literal(true).optional(),
  }),
});
const aiSimulator = z.strictObject({
  ...base, type: z.literal("ai-simulator"), rotation: z.literal(0),
  scale: z.number().finite().min(0.5).max(4), view: z.enum(["history", "thinking", "memory", "agent", "ccMemory"]), state: aiState,
});

// SSH simulator (plan 07 §4c).
// Older documents stored `known` (the removed known_hosts row): accepted and dropped. Old step ids map to `setup`.
const dropKnown = (value: unknown) => {
  if (typeof value !== "object" || value === null || !("known" in value)) return value;
  const rest = { ...(value as Record<string, unknown>) };
  delete rest.known;
  return rest;
};
const sshView = z.preprocess((value) => ((LEGACY_SSH_VIEWS as readonly unknown[]).includes(value) ? "setup" : value), z.enum(["setup", "others"]));
const sshMachine = z.preprocess(dropKnown, z.strictObject({
  priv: z.boolean(), pub: z.boolean(),
  cmd: z.string().refine((v) => codePoints(v) <= SSH_LIMITS.cmd),
  out: z.array(z.string().refine((v) => codePoints(v) >= 1 && codePoints(v) <= SSH_LIMITS.outLine)).max(SSH_LIMITS.outLines),
}).refine((value) => value.priv || !value.pub, "A public key needs its private key"));
const sshState = z.strictObject({
  version: z.literal(1),
  a: sshMachine, b: sshMachine,
  registered: z.array(z.enum(["a", "b"])).max(2),
  pushes: z.number().int().min(0).max(SSH_LIMITS.pushes),
  thief: z.enum(["idle", "copied", "denied"]),
}).superRefine((state, ctx) => {
  if (new Set(state.registered).size !== state.registered.length || state.registered.some((machine) => !state[machine].pub)) {
    ctx.addIssue({ code: "custom", message: "Only machines with a public key can be registered, once each" });
  }
});
const sshSimulator = z.strictObject({
  ...base, type: z.literal("ssh-simulator"), rotation: z.literal(0),
  scale: z.number().finite().min(0.5).max(4), view: sshView, state: sshState,
});

export const canvasNodeSchema = z.discriminatedUnion("type", [rectangle, ellipse, line, arrow, pen, highlighter, text, image, stencil, table, code, gitSimulator, dataSimulator, deploySimulator, aiSimulator, sshSimulator]);
export const slideSchema = z.strictObject({ id: uuid, name: title, background: color, nodes: z.array(canvasNodeSchema) });
export const assetSchema = z.strictObject({
  id: uuid, mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  width: z.number().int().min(1).max(8192), height: z.number().int().min(1).max(8192),
  byteLength: z.number().int().min(1).max(10 * 1024 * 1024), sha256: z.string().regex(/^[0-9a-f]{64}$/),
  storagePath: z.string().min(1),
});
export const projectContentSchema = z.strictObject({
  title,
  document: z.strictObject({
    schemaVersion: z.literal(1),
    slides: z.array(slideSchema).min(1).max(LIMITS.slides),
    assets: z.record(uuid, assetSchema),
  }),
}).superRefine((content, ctx) => {
  for (const message of documentInvariantIssues(content as ProjectContent)) ctx.addIssue({ code: "custom", message });
});

/**
 * Cross-object invariants of a structurally valid document (unique IDs, references, totals, size).
 * Cheap enough to run on every transaction; per-object shapes are checked by the schemas above.
 */
export function documentInvariantIssues(content: ProjectContent): string[] {
  const issues: string[] = [];
  const slideIds = new Set<string>();
  const nodeIds = new Set<string>();
  let points = 0;
  if (content.document.slides.length < 1 || content.document.slides.length > LIMITS.slides) issues.push("Slide count out of range");
  for (const slide of content.document.slides) {
    if (slideIds.has(slide.id)) issues.push(`Duplicate slide ID ${slide.id}`);
    slideIds.add(slide.id);
    for (const node of slide.nodes) {
      if (nodeIds.has(node.id)) issues.push(`Duplicate node ID ${node.id}`);
      nodeIds.add(node.id);
      if (node.type === "image" && !content.document.assets[node.assetId]) issues.push(`Missing asset ${node.assetId}`);
      if (node.type === "pen" || node.type === "highlighter") points += node.points.length;
    }
  }
  if (nodeIds.size > LIMITS.nodes) issues.push("Node limit exceeded");
  if (points > LIMITS.points) issues.push("Point limit exceeded");
  for (const [id, asset] of Object.entries(content.document.assets)) if (id !== asset.id) issues.push(`Asset ID mismatch ${id}`);
  if (new TextEncoder().encode(JSON.stringify(content.document)).length > LIMITS.documentBytes) issues.push("Document size limit exceeded");
  return issues;
}

/** Shared field schemas used for incremental transaction validation. */
export const titleSchema = title;
export const colorSchema = color;

export function parseProjectContent(value: unknown): ProjectContent {
  return projectContentSchema.parse(value) as ProjectContent;
}

export function migrateProjectContent(value: unknown): ProjectContent {
  // Only v1 is supported. Never strip unknown fields or overwrite unknown versions.
  return parseProjectContent(value);
}
