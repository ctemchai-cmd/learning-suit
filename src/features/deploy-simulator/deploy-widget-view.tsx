"use client";

import type { JSX, ReactNode } from "react";
import { Ellipse, Group, Line, Rect } from "react-konva";
import type { MarkTone } from "@/domain/data/model";
import type { DeploySimulatorNode } from "@/domain/document/model";
import { SITE_URL, type DeployState, type DeployView } from "@/domain/deploy/model";
import { deploymentOf } from "@/domain/deploy/reducer";
import { AppSpinner, CaptionBar, Gate, Label, MARK_STYLE, Packet, Pipe, type Pt } from "@/features/flow/flow-bits";
import { waitingAt, type FlowPlay, type Waiting } from "@/features/flow/flow-session";
import { useFlowPlayback } from "@/features/flow/use-flow-playback";
import { CAPTION_BOX, DEPLOY_H, DEPLOY_VIEWS, DEPLOY_W, deploymentRows, hopPath, sceneOf, type Box } from "./deploy-layout";

// Canvas rendering of the deploy simulator (plan 07 §4). Draw inside a Group already translated to node.x/node.y.
// Deterministic for export: without a play it draws the stored state only.

const C = {
  frame: "#FFFFFF", frameStroke: "#CBD5E1", card: "#FFFFFF", cardStroke: "#E2E8F0", title: "#0F172A", text: "#1E293B", muted: "#64748B",
  dark: "#0F172A", ok: "#15803D", bad: "#B91C1C", vercel: "#111827", github: "#F6F8FA", db: "#ECFDF5", dbStroke: "#6EE7B7",
};
const IDLE: Record<DeployView, string> = {
  local: "กด “เปิดเว็บในเครื่อง” แล้วลองให้เพื่อนเปิด localhost",
  vercel: "กด “ส่งโค้ดขึ้น” แล้วให้เพื่อนเปิดเว็บจริง ลองทำโค้ดพังดูด้วย",
  localEnv: "สั่งกาแฟบนเว็บในเครื่อง แล้วลองเอากุญแจออกจาก .env.local",
  env: "ส่งโค้ดขึ้นแล้วให้เพื่อนสั่งกาแฟ ดูว่ากุญแจอยู่ที่ไหน",
  overall: "ให้เพื่อนสั่งกาแฟบนเว็บจริง แล้วดูเส้นทางทั้งหมด",
};

type Marks = Map<string, { tone: MarkTone }>;
const toneOf = (marks: Marks, spot: string) => marks.get(spot)?.tone;

function Card({ box, title, sub, mark, fill = C.card, stroke = C.cardStroke, dark = false, font, children }: {
  box: Box; title?: string; sub?: string; mark?: MarkTone; fill?: string; stroke?: string; dark?: boolean; font: string; children?: ReactNode;
}) {
  const style = mark ? MARK_STYLE[mark] : null;
  return <Group listening={false}>
    <Rect x={box.x} y={box.y} width={box.w} height={box.h} cornerRadius={12} fill={style && !dark ? style.fill : fill} stroke={style?.stroke ?? stroke} strokeWidth={style ? 3 : 1.5} />
    {title && <Label x={box.x + 12} y={box.y + 10} width={box.w - 24} text={title} size={15} bold color={dark ? "#F8FAFC" : C.title} font={font} />}
    {sub && <Label x={box.x + 12} y={box.y + 30} width={box.w - 24} text={sub} size={11} color={dark ? "#94A3B8" : C.muted} font={font} />}
    {children}
  </Group>;
}

function Laptop({ box, font }: { box: Box; font: string }) {
  const base = box.y + box.h;
  return <Group listening={false}>
    <Rect x={box.x} y={box.y} width={box.w} height={box.h} cornerRadius={16} fill="#F8FAFC" stroke={C.dark} strokeWidth={6} />
    <Line points={[box.x - 6, base + 4, box.x + box.w + 6, base + 4, box.x + box.w + 18, base + 18, box.x - 18, base + 18]} closed fill="#CBD5E1" stroke="#94A3B8" strokeWidth={1} />
    <Label x={box.x + 14} y={box.y + 12} width={box.w - 28} text="💻 เครื่องเรา" size={15} bold color={C.title} font={font} />
  </Group>;
}

function CodeCard({ box, state, view, mark, font }: { box: Box; state: DeployState; view: DeployView; mark?: MarkTone; font: string }) {
  const { code, github } = state;
  const pushed = github.rev === code.rev;
  return <Card box={box} title="โค้ด" mark={mark} fill="#1E293B" stroke="#334155" dark font={font}>
    <Label x={box.x + 12} y={box.y + 36} width={box.w - 24} text={code.title} size={box.w > 150 ? 17 : 14} bold color="#F8FAFC" font={font} />
    <Label x={box.x + 12} y={box.y + 60} width={box.w - 24} text={`รุ่น ${code.rev}`} size={12} color="#93C5FD" font={font} />
    {code.broken && <Label x={box.x + 12} y={box.y + 78} width={box.w - 24} text="✗ มีข้อผิดพลาด" size={12} bold color="#FCA5A5" font={font} />}
    {view !== "local" && view !== "localEnv" && <Label x={box.x + 12} y={box.y + (code.broken ? 96 : 78)} width={box.w - 24} text={pushed ? "✓ ส่งขึ้นแล้ว" : "ยังไม่ได้ส่งขึ้น"} size={11} color={pushed ? "#86EFAC" : "#FCD34D"} font={font} />}
  </Card>;
}

function BrowserCard({ box, state, mark, waiting, font }: { box: Box; state: DeployState; mark?: MarkTone; waiting: Waiting | null; font: string }) {
  const shown = state.local.running && state.local.showing !== null;
  const style = mark ? MARK_STYLE[mark] : null;
  return <Group listening={false}>
    <Rect x={box.x} y={box.y} width={box.w} height={box.h} cornerRadius={10} fill="#FFFFFF" stroke={style?.stroke ?? "#94A3B8"} strokeWidth={style ? 3 : 1.5} />
    <Rect x={box.x} y={box.y} width={box.w} height={26} cornerRadius={[10, 10, 0, 0]} fill="#E2E8F0" />
    <Label x={box.x + 10} y={box.y} width={box.w - 20} text="localhost:3000" size={11} color={C.muted} font={font} lineHeight={26} />
    {shown ? <>
      <Label x={box.x + 10} y={box.y + 38} width={box.w - 20} text={state.code.title} size={box.w > 150 ? 18 : 13} bold color={C.title} font={font} />
      <Label x={box.x + 10} y={box.y + 62} width={box.w - 20} text={`รุ่น ${state.local.showing}`} size={12} color={C.muted} font={font} />
      {state.code.broken && <Label x={box.x + 10} y={box.y + 82} width={box.w - 20} text="⚠ โค้ดมีข้อผิดพลาด" size={11} bold color={C.bad} font={font} />}
      {state.laptop.lines.map((line, index) => <Label key={index} x={box.x + 10} y={box.y + box.h - 26 - index * 18} width={box.w - 20} text={line} size={12} bold color={line.includes("✗") ? C.bad : C.ok} font={font} />)}
    </> : <Label x={box.x + 10} y={box.y + 40} width={box.w - 20} text="ยังไม่ได้เปิดเซิร์ฟเวอร์" size={12} color={C.muted} font={font} />}
    {waiting && <AppSpinner box={{ x: box.x + 1, y: box.y + 27, w: box.w - 2, h: box.h - 28 }} kind={waiting} font={font} />}
  </Group>;
}

function FriendPhone({ frame, screen, state, mark, waiting, font }: { frame: Box; screen: Box; state: DeployState; mark?: MarkTone; waiting: Waiting | null; font: string }) {
  const { friend } = state;
  const style = mark ? MARK_STYLE[mark] : null;
  const fill = friend.tone === "error" ? "#FEF2F2" : friend.tone === "ok" ? "#F0FDF4" : "#F8FAFC";
  return <Group listening={false}>
    <Rect x={frame.x} y={frame.y} width={frame.w} height={frame.h} cornerRadius={28} fill={C.dark} />
    <Rect x={frame.x + frame.w / 2 - 28} y={frame.y + 12} width={56} height={7} cornerRadius={4} fill="#334155" />
    <Rect x={screen.x} y={screen.y} width={screen.w} height={screen.h} cornerRadius={12} fill={style?.fill ?? fill} stroke={style?.stroke} strokeWidth={style ? 2.5 : 0} />
    <Label x={screen.x + 10} y={screen.y + 10} width={screen.w - 20} text="📱 มือถือเพื่อน" size={13} bold color={C.muted} font={font} />
    {friend.tone === "empty"
      ? <Label x={screen.x + 10} y={screen.y + 40} width={screen.w - 20} text="ยังไม่ได้เปิดเว็บ" size={13} color={C.muted} font={font} />
      : <>
        <Label x={screen.x + 10} y={screen.y + 40} width={screen.w - 20} text={friend.title} size={17} bold color={friend.tone === "error" ? C.bad : C.title} font={font} />
        {friend.lines.map((line, index) => <Label key={index} x={screen.x + 10} y={screen.y + 68 + index * 22} width={screen.w - 20} text={line} size={12} color={friend.tone === "error" ? C.bad : C.text} font={font} />)}
      </>}
    {waiting && <AppSpinner box={{ x: screen.x, y: screen.y + 32, w: screen.w, h: screen.h - 32 }} kind={waiting} font={font} />}
  </Group>;
}

function Deployments({ view, state, marks, font }: { view: DeployView; state: DeployState; marks: Marks; font: string }) {
  const list = sceneOf(view).deployments!;
  const rows = deploymentRows(view, state);
  const showKey = view === "env" || view === "overall";
  return <Group listening={false}>
    <Label x={list.x} y={list.y + 4} width={list.w} text="Deployments" size={12} bold color="#CBD5E1" font={font} />
    {rows.length === 0 && <Label x={list.x} y={list.y + 34} width={list.w} text="ยังไม่เคย Deploy" size={12} color="#94A3B8" font={font} />}
    {rows.map(({ id, box }) => {
      const item = deploymentOf(state, id)!;
      const live = state.production === id;
      const mark = toneOf(marks, `deploy:${id}`);
      const style = mark ? MARK_STYLE[mark] : null;
      return <Group key={id}>
        <Rect x={box.x} y={box.y} width={box.w} height={box.h} cornerRadius={8} fill={style?.fill ?? (live ? "#F0FDF4" : "#1F2937")} stroke={style?.stroke ?? (live ? "#22C55E" : "#374151")} strokeWidth={style || live ? 2 : 1} />
        <Label x={box.x + 10} y={box.y} width={44} text={`D${id}`} size={13} bold color={live || style ? C.title : "#F8FAFC"} font={font} lineHeight={box.h} />
        <Label x={box.x + 48} y={box.y} width={box.w - 150} text={`${item.ok ? "✓" : "✗ ล้ม"} รุ่น ${item.rev}${showKey ? (item.hasKey ? " 🔑" : " ไม่มี🔑") : ""}`} size={12}
          color={item.ok ? (live || style ? C.ok : "#86EFAC") : "#FCA5A5"} font={font} lineHeight={box.h} />
        {live && <Group x={box.x + box.w - 96} y={box.y + (box.h - 20) / 2}>
          <Rect width={88} height={20} cornerRadius={10} fill="#16A34A" />
          <Label x={0} y={0} width={88} text="ใช้งานจริง" size={11} bold color="#FFFFFF" align="center" font={font} lineHeight={20} />
        </Group>}
      </Group>;
    })}
  </Group>;
}

function Cylinder({ box, title, lines, mark, font }: { box: Box; title: string; lines: string[]; mark?: MarkTone; font: string }) {
  const style = mark ? MARK_STYLE[mark] : null;
  const rx = box.w / 2, ry = 18, cx = box.x + rx;
  const stroke = style?.stroke ?? C.dbStroke, fill = style?.fill ?? C.db;
  return <Group listening={false}>
    <Rect x={box.x} y={box.y + ry} width={box.w} height={box.h - 2 * ry} fill={fill} stroke={stroke} strokeWidth={style ? 3 : 2} />
    <Ellipse x={cx} y={box.y + box.h - ry} radiusX={rx} radiusY={ry} fill={fill} stroke={stroke} strokeWidth={style ? 3 : 2} />
    <Rect x={box.x + 1.5} y={box.y + box.h - 2 * ry - 2} width={box.w - 3} height={ry + 2} fill={fill} />
    <Ellipse x={cx} y={box.y + ry} radiusX={rx} radiusY={ry} fill="#D1FAE5" stroke={stroke} strokeWidth={style ? 3 : 2} />
    <Label x={box.x + 10} y={box.y + ry + 26} width={box.w - 20} text={title} size={14} bold color={C.title} align="center" font={font} />
    {lines.length === 0
      ? <Label x={box.x + 10} y={box.y + ry + 52} width={box.w - 20} text="ยังไม่มีออเดอร์" size={12} color={C.muted} align="center" font={font} />
      : lines.slice(-5).map((line, index) => <Label key={index} x={box.x + 16} y={box.y + ry + 52 + index * 20} width={box.w - 32} text={`• ${line}`} size={12} color={C.text} font={font} />)}
  </Group>;
}

/** Canvas rendering of a deploy simulator node. `play` (editor only) animates the last action. */
export function DeployWidgetView({ node, play, fontFamily: font }: { node: DeploySimulatorNode; play: FlowPlay | null; fontFamily: string }): JSX.Element {
  const view = node.view;
  const scene = sceneOf(view);
  const flow = useFlowPlayback<DeployState, Pt>(node.id, play, node.state, (before, after, move) => hopPath(view, before, after, move));
  const { state, marks } = flow;
  const onPath = (point: Pt) => Boolean(flow.path?.some((item) => Math.abs(item.x - point.x) < 1 && Math.abs(item.y - point.y) < 1));
  const gate = (spot: string) => { const tone = toneOf(marks, spot); return tone === "blocked" ? "blocked" : tone === "allowed" ? "ok" : tone === "leak" ? "leak" : "idle"; };
  const live = deploymentOf(state, state.production);
  const title = DEPLOY_VIEWS.find((item) => item.id === view)!;
  return <Group scaleX={node.scale} scaleY={node.scale} clipX={0} clipY={0} clipWidth={DEPLOY_W} clipHeight={DEPLOY_H}>
    <Rect x={1} y={1} width={DEPLOY_W - 2} height={DEPLOY_H - 2} cornerRadius={18} fill={C.frame} stroke={C.frameStroke} strokeWidth={2} />
    <Label x={24} y={18} width={DEPLOY_W - 48} text={`การ Deploy: ${title.label}`} size={24} bold color={C.title} font={font} />
    <Laptop box={scene.laptop} font={font} />
    {scene.pipes.map((pipe, index) => <Pipe key={index} from={pipe.from} to={pipe.to} label={pipe.label}
      active={flow.moving && onPath(pipe.from) && onPath(pipe.to) ? flow.moving.tone : null} font={font} />)}
    <CodeCard box={scene.code} state={state} view={view} mark={toneOf(marks, "code")} font={font} />
    {scene.server && <Card box={scene.server} title={scene.server.w < 140 ? "เซิร์ฟเวอร์" : "เซิร์ฟเวอร์ในเครื่อง"} mark={toneOf(marks, "server")} font={font}>
      <Label x={scene.server.x + 12} y={scene.server.y + scene.server.h - 30} width={scene.server.w - 24} text={state.local.running ? "● เปิดอยู่" : "○ ปิดอยู่"} size={13} bold color={state.local.running ? C.ok : C.muted} font={font} />
    </Card>}
    {scene.browser && <BrowserCard box={scene.browser} state={state} mark={toneOf(marks, "browser")} waiting={waitingAt(play, "browser")} font={font} />}
    {scene.envfile && <Card box={scene.envfile} title=".env.local" mark={toneOf(marks, "envfile")} fill={state.keys.local ? "#FFFBEB" : "#F8FAFC"} stroke={state.keys.local ? "#FCD34D" : "#CBD5E1"} font={font}>
      <Label x={scene.envfile.x + 12} y={scene.envfile.y + (scene.envfile.h > 100 ? 48 : 34)} width={scene.envfile.w - 24} text={state.keys.local ? "🔑 กุญแจฐานข้อมูล" : "ไม่มีกุญแจ"}
        size={scene.envfile.h > 100 ? 15 : 11} bold={scene.envfile.h > 100} color={state.keys.local ? "#92400E" : C.bad} font={font} />
      {scene.envfile.h > 100 && <Label x={scene.envfile.x + 12} y={scene.envfile.y + 76} width={scene.envfile.w - 24} text="ไฟล์ลับ: อยู่แค่ในเครื่อง" size={11} color={C.muted} font={font} />}
    </Card>}
    {scene.localhostGate && <Gate at={scene.localhostGate} label="นอกเครื่องเรา" tone={gate("localhostGate")} font={font} />}
    {scene.gitignore && <Gate at={scene.gitignore} label=".gitignore" tone={toneOf(marks, "gitignore") === "blocked" ? "ok" : "idle"} font={font} />}

    {scene.github && <Card box={scene.github} title="GitHub" mark={toneOf(marks, "github")} fill={C.github} font={font}>
      <Label x={scene.github.x + 12} y={scene.github.y + 40} width={scene.github.w - 24} text={state.github.rev !== null ? `รุ่น ${state.github.rev}: ${state.github.title}` : "ยังว่าง"} size={13} bold color={C.text} font={font} />
      {state.github.broken && <Label x={scene.github.x + 12} y={scene.github.y + 62} width={scene.github.w - 24} text="✗ มีข้อผิดพลาด" size={11} bold color={C.bad} font={font} />}
    </Card>}
    {scene.vercel && <Card box={scene.vercel} title="▲ Vercel" fill={C.vercel} stroke="#374151" dark font={font} />}
    {scene.build && <Gate at={scene.build} label="Build" labelColor="#CBD5E1" tone={gate("build")} font={font} />}
    {scene.deployments && <Deployments view={view} state={state} marks={marks} font={font} />}
    {scene.vercelEnv && <Card box={scene.vercelEnv} title="Environment Variables" mark={toneOf(marks, "vercelEnv")} fill="#1F2937" stroke="#4B5563" dark font={font}>
      <Label x={scene.vercelEnv.x + 12} y={scene.vercelEnv.y + 50} width={scene.vercelEnv.w - 24} text={state.keys.vercel ? "🔑 มีกุญแจฐานข้อมูล" : "ยังไม่มีกุญแจ"} size={15} bold color={state.keys.vercel ? "#86EFAC" : "#FCA5A5"} font={font} />
    </Card>}
    {scene.url && <Card box={scene.url} title="🌐 เว็บจริง" mark={toneOf(marks, "url")} fill="#EFF6FF" stroke="#93C5FD" font={font}>
      <Label x={scene.url.x + 12} y={scene.url.y + 36} width={scene.url.w - 24} text={SITE_URL} size={12} bold color="#1D4ED8" font={font} />
      <Label x={scene.url.x + 12} y={scene.url.y + 60} width={scene.url.w - 24} text={live ? `${live.title} · รุ่น ${live.rev} (D${live.id})` : "ยังไม่มีเว็บ"} size={12} color={live ? C.text : C.muted} font={font} />
    </Card>}

    {scene.supabase && view !== "overall" && <Cylinder box={scene.supabase} title="ฐานข้อมูล (Supabase)" lines={state.orders} mark={toneOf(marks, "supabase")} font={font} />}
    {view === "overall" && scene.supabase && <Card box={scene.supabase} title="ฐานข้อมูล (Supabase)" mark={toneOf(marks, "supabase")} fill="#ECFDF5" stroke={C.dbStroke} font={font}>
      <Card box={scene.orders!} title="ตารางออเดอร์" mark={toneOf(marks, "orders")} font={font}>
        {state.orders.length === 0
          ? <Label x={scene.orders!.x + 12} y={scene.orders!.y + 40} width={scene.orders!.w - 24} text="ยังไม่มีออเดอร์" size={12} color={C.muted} font={font} />
          : state.orders.slice(-4).map((line, index) => <Label key={index} x={scene.orders!.x + 12} y={scene.orders!.y + 40 + index * 26} width={scene.orders!.w - 24}
            text={`#${Math.max(0, state.orders.length - 4) + index + 1} ${line}`} size={14} color={C.text} font={font} />)}
      </Card>
    </Card>}
    {scene.rls && <Gate at={scene.rls} label="กฎสิทธิ์" sub="RLS" tone={gate("rls")} font={font} />}

    {scene.friend && <FriendPhone frame={scene.friend.frame} screen={scene.friend.screen} state={state} mark={toneOf(marks, "friend")} waiting={waitingAt(play, "friend")} font={font} />}
    <CaptionBar box={CAPTION_BOX} text={flow.frame ? flow.frame.caption : IDLE[view]} step={flow.step} font={font} />
    {flow.moving && flow.path && <Packet key={flow.runKey} runKey={flow.runKey} path={flow.path} label={flow.moving.label} tone={flow.moving.tone}
      duration={flow.travel} font={font} onLanded={flow.onLanded} />}
  </Group>;
}
