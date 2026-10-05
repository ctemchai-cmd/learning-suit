"use client";

import type { JSX, ReactNode } from "react";
import { Group, Rect, Text } from "react-konva";
import type { CarriedLine, MarkTone } from "@/domain/data/model";
import type { SshSimulatorNode } from "@/domain/document/model";
import { KEYGEN_COMMAND, type Machine, type SshMachine, type SshState, type SshView } from "@/domain/ssh/model";
import { NAME } from "@/domain/ssh/reducer";
import { CaptionBar, Gate, Icon, IconLabel, Label, MARK_STYLE, Packet, Pipe, TONE_COLOR, type Pt } from "@/features/flow/flow-bits";
import type { IconName } from "@/features/flow/icon-paths";
import type { FlowPlay } from "@/features/flow/flow-session";
import { useFlowPlayback } from "@/features/flow/use-flow-playback";
import { CAPTION_BOX, SSH_H, SSH_VIEWS, SSH_W, hopPath, keySlot, sceneOf, type Box, type MachineBox, type Scene } from "./ssh-layout";

// Canvas rendering of the SSH simulator (plan 07 §4c). Draw inside a Group already translated to node.x/node.y.
// Deterministic for export: without a play it draws the stored state only.

const C = { frame: "#FFFFFF", frameStroke: "#CBD5E1", card: "#FFFFFF", cardStroke: "#E2E8F0", title: "#0F172A", text: "#1E293B", muted: "#64748B", dark: "#0F172A", ok: "#15803D", bad: "#B91C1C", github: "#F6F8FA" };
const IDLE: Record<SshView, string> = {
  why: "GitHub ต้องรู้ว่าเป็นเราจริง ก่อนให้แก้ repo ของเรา: กด “ส่งโค้ดขึ้น” ดูว่าเกิดอะไรขึ้น",
  keygen: "กด “สร้างกุญแจ” เพื่อสร้างคู่กุญแจ: กุญแจลับ (นิ้วจริง) กับกุญแจสาธารณะ (ลายนิ้วมือ)",
  register: "ลายนิ้วมือ (.pub) ต้องไปลงทะเบียนที่ประตูของ GitHub ครั้งเดียว ก่อนจะเข้าได้",
  connect: "ลองทดสอบการเชื่อมต่อหรือ git push แล้วดูว่าประตูตรวจอะไรบ้าง",
  others: "ลองให้เครื่องอื่นหรือคนที่คัดลอก .pub เข้า GitHub แล้วดูว่าทำไมประตูไม่เปิด",
};
const HINT: Record<SshView, string> = { why: "$ git push", keygen: `$ ${KEYGEN_COMMAND}`, register: "$ cat ~/.ssh/id_ed25519.pub", connect: "$ ssh -T git@github.com", others: "$ _" };
const KIND_ICON: Record<CarriedLine["kind"], IconName> = { file: "file", memory: "brain", user: "user", ai: "bot", tool: "wrench", edit: "pencil", note: "note", code: "key", pass: "check", fail: "fail", empty: "empty" };

type Marks = Map<string, { tone: MarkTone }>;
const toneOf = (marks: Marks, spot: string) => marks.get(spot)?.tone;

/** Wrapping text in a fixed box (at most the lines that fit, then “…”). */
function Para({ x, y, width, height, text, size, color = C.text, bold = false, align = "left", font }: {
  x: number; y: number; width: number; height: number; text: string; size: number; color?: string; bold?: boolean; align?: "left" | "center"; font: string;
}) {
  return <Text x={x} y={y} width={width} height={height} text={text} fontSize={size} fontFamily={font} fontStyle={bold ? "bold" : "normal"}
    fill={color} align={align} wrap="char" ellipsis lineHeight={1.3} listening={false} />;
}

function Card({ box, title, icon, mark, fill = C.card, stroke = C.cardStroke, font, children }: {
  box: Box; title?: string; icon?: IconName; mark?: MarkTone; fill?: string; stroke?: string; font: string; children?: ReactNode;
}) {
  const style = mark ? MARK_STYLE[mark] : null;
  return <Group listening={false}>
    <Rect x={box.x} y={box.y} width={box.w} height={box.h} cornerRadius={12} fill={style?.fill ?? fill} stroke={style?.stroke ?? stroke} strokeWidth={style ? 3 : 1.5} />
    {title && (icon
      ? <IconLabel x={box.x + 12} y={box.y + 10} width={box.w - 24} icon={icon} text={title} size={15} bold color={C.title} font={font} />
      : <Label x={box.x + 12} y={box.y + 10} width={box.w - 24} text={title} size={15} bold color={C.title} font={font} />)}
    {children}
  </Group>;
}

/** One file in ~/.ssh (or an empty dashed slot while it does not exist yet). */
function FileRow({ box, compact, exists, icon, name, note, short, empty, mark, font }: {
  box: Box; compact: boolean; exists: boolean; icon: IconName; name: string; note: string; short: string; empty: string; mark?: MarkTone; font: string;
}) {
  const style = mark ? MARK_STYLE[mark] : null;
  if (!exists) {
    return <Group listening={false}>
      <Rect x={box.x} y={box.y} width={box.w} height={box.h} cornerRadius={10} fill="#F8FAFC" stroke="#CBD5E1" strokeWidth={1.5} dash={[6, 5]} />
      <Label x={box.x + 12} y={box.y} width={box.w - 24} text={empty} size={compact ? 12 : 13} color="#94A3B8" font={font} lineHeight={box.h} />
    </Group>;
  }
  return <Group listening={false}>
    <Rect x={box.x} y={box.y} width={box.w} height={box.h} cornerRadius={10} fill={style?.fill ?? "#FFFBEB"} stroke={style?.stroke ?? "#FCD34D"} strokeWidth={style ? 3 : 1.5} />
    {compact
      ? <IconLabel x={box.x + 10} y={box.y} width={box.w - 20} icon={icon} text={`${name} · ${short}`} size={12} bold color={style?.text ?? "#92400E"} font={font} lineHeight={box.h} />
      : <>
        <IconLabel x={box.x + 12} y={box.y + 6} width={box.w - 24} icon={icon} text={name} size={15} bold color={style?.text ?? "#92400E"} font={font} />
        <Label x={box.x + 12 + 22} y={box.y + 29} width={box.w - 46} text={note} size={12} color={C.muted} font={font} />
      </>}
  </Group>;
}

function Terminal({ box, compact, machine, view, font }: { box: Box; compact: boolean; machine: SshMachine; view: SshView; font: string }) {
  const ran = machine.cmd !== "";
  if (compact) {
    const line = machine.out.at(-1) ?? (ran ? `$ ${machine.cmd}` : HINT.others);
    return <Group listening={false}>
      <Rect x={box.x} y={box.y} width={box.w} height={box.h} cornerRadius={6} fill="#0F172A" />
      <Label x={box.x + 8} y={box.y} width={box.w - 16} text={line} size={11} color={lineColor(line, ran)} font={font} lineHeight={box.h} />
    </Group>;
  }
  return <Group listening={false}>
    <Rect x={box.x} y={box.y} width={box.w} height={box.h} cornerRadius={10} fill="#0F172A" />
    <Label x={box.x + 14} y={box.y + 8} width={box.w - 28} text={ran ? `$ ${machine.cmd}` : HINT[view]} size={14} bold={ran} color={ran ? "#F8FAFC" : "#64748B"} font={font} />
    {machine.out.map((line, index) => <Label key={index} x={box.x + 14} y={box.y + 28 + index * 18} width={box.w - 28} text={line} size={12} color={lineColor(line, true)} font={font} />)}
  </Group>;
}
const lineColor = (line: string, ran: boolean) => !ran ? "#64748B" : /denied|fatal/i.test(line) ? "#FCA5A5" : /Hi you|main ->|saved|Permanently/.test(line) ? "#86EFAC" : "#CBD5E1";

function Laptop({ box, title, font }: { box: Box; title: string; font: string }) {
  const base = box.y + box.h;
  return <Group listening={false}>
    <Rect x={box.x} y={box.y} width={box.w} height={box.h} cornerRadius={16} fill="#F8FAFC" stroke={C.dark} strokeWidth={6} />
    <Rect x={box.x - 6} y={base + 4} width={box.w + 12} height={12} cornerRadius={6} fill="#CBD5E1" stroke="#94A3B8" strokeWidth={1} />
    <IconLabel x={box.x + 14} y={box.y + 10} width={box.w - 28} icon="laptop" text={title} size={15} bold color={C.title} font={font} />
  </Group>;
}

function MachineView({ machine, state, view, compact, marks, layout, font }: {
  machine: Machine; state: SshState; view: SshView; compact: boolean; marks: Marks; layout: MachineBox; font: string;
}) {
  const me = state[machine];
  const suffix = machine === "a" ? "" : ":b";
  const folderMark = toneOf(marks, `ssh${suffix}`);
  const folder = layout.folder;
  const style = folderMark ? MARK_STYLE[folderMark] : null;
  return <Group listening={false}>
    <Laptop box={layout.box} title={machine === "a" ? "เครื่อง A (ของเรา)" : "เครื่อง B (เพื่อน / เครื่องใหม่)"} font={font} />
    <Rect x={folder.x} y={folder.y} width={folder.w} height={folder.h} cornerRadius={10} fill={style?.fill ?? "#FFFFFF"} stroke={style?.stroke ?? "#CBD5E1"} strokeWidth={style ? 3 : 1.5} />
    <IconLabel x={folder.x + 12} y={folder.y + (compact ? 6 : 10)} width={folder.w - 24} icon="folder" text="~/.ssh" size={compact ? 13 : 15} bold color={C.title} font={font} />
    <FileRow box={layout.rows.priv} compact={compact} exists={me.priv} icon="key" name="id_ed25519" note="กุญแจลับ = นิ้วจริง · อยู่ในเครื่องนี้ ไม่ส่งให้ใคร" short="กุญแจลับ (นิ้วจริง)" empty="ยังไม่มีกุญแจลับ"
      mark={toneOf(marks, `priv${suffix}`)} font={font} />
    <FileRow box={layout.rows.pub} compact={compact} exists={me.pub} icon="fingerprint" name="id_ed25519.pub" note="กุญแจสาธารณะ = ลายนิ้วมือ · แจกได้" short="ลายนิ้วมือ" empty="ยังไม่มีกุญแจสาธารณะ"
      mark={toneOf(marks, `pub${suffix}`)} font={font} />
    <FileRow box={layout.rows.known} compact={compact} exists={me.known} icon="shield" name="known_hosts" note="จำแล้วว่า GitHub ตัวจริงหน้าตาแบบนี้ ✓" short="จำ GitHub แล้ว ✓" empty="known_hosts (ยังว่าง)"
      mark={toneOf(marks, `known${suffix}`)} font={font} />
    <Terminal box={layout.term} compact={compact} machine={me} view={view} font={font} />
  </Group>;
}

function KeysList({ scene, state, marks, font }: { scene: Scene; state: SshState; marks: Marks; font: string }) {
  const keys = scene.keys;
  return <Card box={keys} title="Settings → SSH keys" icon="key" mark={toneOf(marks, "keys")} fill="#FFFFFF" font={font}>
    {state.registered.length === 0 && !toneOf(marks, "key:a") && !toneOf(marks, "key:b") && <>
      <Icon name="empty" x={keys.x + keys.w / 2 - 14} y={keys.y + 56} size={28} color="#CBD5E1" />
      <Para x={keys.x + 16} y={keys.y + 94} width={keys.w - 32} height={40} text="ยังไม่มีลายนิ้วมือที่ลงทะเบียน: ประตูไม่รู้จักใครเลย" size={13} color="#94A3B8" align="center" font={font} />
    </>}
    {(["a", "b"] as const).map((machine) => {
      const slot = keySlot(scene, machine);
      const mark = toneOf(marks, `key:${machine}`);
      const style = mark ? MARK_STYLE[mark] : null;
      const listed = state.registered.includes(machine);
      if (!listed && mark !== "removed") return null;
      return <Group key={machine}>
        <Rect x={slot.x} y={slot.y} width={slot.w} height={slot.h} cornerRadius={10} fill={style?.fill ?? "#F0FDF4"} stroke={style?.stroke ?? "#86EFAC"} strokeWidth={style ? 3 : 1.5} dash={listed ? undefined : [6, 5]} />
        <IconLabel x={slot.x + 12} y={slot.y + 8} width={slot.w - 24} icon="fingerprint" text={`${NAME[machine]} · id_ed25519.pub`} size={14} bold color={listed ? (style?.text ?? "#166534") : C.muted} font={font} />
        <Label x={slot.x + 12 + 22} y={slot.y + 31} width={slot.w - 46} text={listed ? "ลายนิ้วมือที่ลงทะเบียนไว้" : "ลบออกจากระบบแล้ว"} size={12} color={C.muted} font={font} />
      </Group>;
    })}
  </Card>;
}

function Legend({ box, compact, font }: { box: Box; compact: boolean; font: string }) {
  const columns: { icon: IconName; title: string; text: string }[] = [
    { icon: "key", title: "นิ้วจริง = กุญแจลับ", text: "id_ed25519 อยู่กับเรา ไม่ส่งให้ใคร" },
    { icon: "fingerprint", title: "ลายนิ้วมือ = กุญแจสาธารณะ", text: "id_ed25519.pub แจกได้ ลงทะเบียนที่ GitHub ครั้งเดียว" },
    { icon: "shield", title: "เครื่องสแกน = GitHub", text: "เทียบลายเซ็นกับลายนิ้วมือที่ลงทะเบียนไว้ ตรงกันถึงเปิดประตู" },
  ];
  return <Group listening={false}>
    <Rect x={box.x} y={box.y} width={box.w} height={box.h} cornerRadius={12} fill="#F8FAFC" stroke="#E2E8F0" strokeWidth={1.5} />
    <Label x={box.x + 16} y={box.y + 8} width={box.w - 32} text="เปรียบเทียบ: ประตูตึกที่มีเครื่องสแกนลายนิ้วมือ" size={13} bold color={C.title} font={font} />
    {compact
      ? <Para x={box.x + 16} y={box.y + 30} width={box.w - 32} height={40} text="นิ้วจริง = กุญแจลับ (ไม่ส่งให้ใคร) · ลายนิ้วมือ = .pub (แจกได้) · เครื่องสแกน = GitHub" size={12} color={C.muted} font={font} />
      : columns.map((column, index) => <Group key={column.title} x={box.x + 16 + index * 352} y={box.y + 32}>
        <IconLabel x={0} y={0} width={330} icon={column.icon} text={column.title} size={13} bold color={C.text} font={font} />
        <Para x={22} y={20} width={308} height={34} text={column.text} size={12} color={C.muted} font={font} />
      </Group>)}
  </Group>;
}

/** What the thief holds: only a picture of our fingerprint. */
function Thief({ box, state, mark, font }: { box: Box; state: SshState; mark?: MarkTone; font: string }) {
  const lines = state.thief === "idle" ? ["ยังไม่ได้ทำอะไร"] : state.thief === "copied" ? ["ถือ .pub (ภาพลายนิ้วมือ)", "ไม่มีกุญแจลับ"] : ["ถือแค่ .pub: เข้าไม่ได้ ✗", "ไม่มีนิ้วจริงให้เซ็นโจทย์"];
  return <Card box={box} title="คนแอบคัดลอก .pub" icon="user" mark={mark} fill={state.thief === "denied" ? "#FEF2F2" : "#FFFFFF"} stroke={state.thief === "denied" ? "#FCA5A5" : C.cardStroke} font={font}>
    {lines.map((line, index) => <Label key={index} x={box.x + 12} y={box.y + 34 + index * 18} width={box.w - 24} text={line} size={12} color={state.thief === "denied" ? C.bad : C.muted} font={font} />)}
  </Card>;
}

/** The travelling card: what a packet carries (a public key, a random challenge, a signature …). */
function Payload({ title, color, lines, font }: { title: string; color: string; lines: CarriedLine[]; font: string }) {
  const w = 250, rowH = 24, h = 40 + lines.length * (rowH + 4);
  return <Group x={-w / 2} y={-h / 2} listening={false}>
    <Rect width={w} height={h} cornerRadius={14} fill="#FFFFFF" stroke={color} strokeWidth={3} shadowColor="#0F172A" shadowOpacity={0.35} shadowBlur={18} shadowOffsetY={6} />
    <Rect width={w} height={30} cornerRadius={[14, 14, 0, 0]} fill={color} />
    <Label x={12} y={0} width={w - 24} text={title} size={14} bold color="#FFFFFF" font={font} lineHeight={30} />
    {lines.map((line, index) => <Group key={index} x={10} y={36 + index * (rowH + 4)}>
      <Rect width={w - 20} height={rowH} cornerRadius={8} fill={line.kind === "pass" ? "#DCFCE7" : "#F1F5F9"} />
      <IconLabel x={8} y={0} width={w - 36} icon={KIND_ICON[line.kind]} text={line.text} size={12} color={line.kind === "pass" ? "#166534" : C.text} font={font} lineHeight={rowH} />
    </Group>)}
  </Group>;
}

/** Canvas rendering of an SSH simulator node. `play` (editor only) animates the last action. */
export function SshWidgetView({ node, play, fontFamily: font }: { node: SshSimulatorNode; play: FlowPlay | null; fontFamily: string }): JSX.Element {
  const view = node.view;
  const scene = sceneOf(view);
  const flow = useFlowPlayback<SshState, Pt>(node.id, play, node.state, (_before, _after, move) => hopPath(view, move));
  const { state, marks } = flow;
  const onPath = (point: Pt) => Boolean(flow.path?.some((item) => Math.abs(item.x - point.x) < 1 && Math.abs(item.y - point.y) < 1));
  const gateTone = toneOf(marks, "scanner") === "blocked" ? "blocked" : toneOf(marks, "scanner") === "allowed" ? "ok" : "idle";
  const title = SSH_VIEWS.find((item) => item.id === view)!;
  const hostkey = scene.hostkey, repo = scene.repo, github = scene.github;
  const move = flow.moving;
  return <Group scaleX={node.scale} scaleY={node.scale} clipX={0} clipY={0} clipWidth={SSH_W} clipHeight={SSH_H}>
    <Rect x={1} y={1} width={SSH_W - 2} height={SSH_H - 2} cornerRadius={18} fill={C.frame} stroke={C.frameStroke} strokeWidth={2} />
    <Label x={24} y={18} width={SSH_W - 48} text={`SSH: ${title.label}`} size={24} bold color={C.title} font={font} />
    <MachineView machine="a" state={state} view={view} compact={scene.compact} marks={marks} layout={scene.machines.a} font={font} />
    {scene.machines.b && <MachineView machine="b" state={state} view={view} compact marks={marks} layout={scene.machines.b} font={font} />}
    {scene.pipes.map((pipe, index) => <Pipe key={index} from={pipe.from} to={pipe.to}
      active={move && onPath(pipe.from) && onPath(pipe.to) ? move.tone : null} font={font} />)}
    <Gate at={scene.scanner} label="ด่านสแกนนิ้ว" sub={scene.compact ? undefined : "ประตูของ GitHub"} tone={gateTone} font={font} />
    {scene.thief && <Thief box={scene.thief} state={state} mark={toneOf(marks, "thief")} font={font} />}

    <Card box={github} title="GitHub" icon="cloud" fill={C.github} font={font} />
    <Card box={hostkey} mark={toneOf(marks, "hostkey")} fill="#FFFFFF" font={font}>
      <IconLabel x={hostkey.x + 12} y={hostkey.y + 8} width={hostkey.w - 24} icon="shield" text="ลายนิ้วมือของ GitHub เอง (host key)" size={12} bold color={C.text} font={font} />
      <Label x={hostkey.x + 34} y={hostkey.y + 30} width={hostkey.w - 46} text="SHA256:+DiY3wvvV6TuJJhbpZisF…" size={11} color={C.muted} font={font} />
    </Card>
    <Card box={repo} mark={toneOf(marks, "repo")} fill="#FFFFFF" font={font}>
      <IconLabel x={repo.x + 12} y={repo.y + 10} width={repo.w - 24} icon="gitBranch" text="repo: coffee-shop" size={14} bold color={C.text} font={font} />
      <Label x={repo.x + 34} y={repo.y + 38} width={repo.w - 46} text={state.pushes ? `โค้ดของเรา · ส่งขึ้นแล้ว ${state.pushes} ครั้ง ✓` : "โค้ดของเรา · ยังไม่ได้ส่งขึ้น"} size={12} color={state.pushes ? C.ok : C.muted} font={font} />
    </Card>
    <KeysList scene={scene} state={state} marks={marks} font={font} />
    <Legend box={scene.legend} compact={scene.compact} font={font} />

    <CaptionBar box={CAPTION_BOX} text={flow.frame ? flow.frame.caption : IDLE[view]} step={flow.step} font={font} />
    {move && flow.path && <Packet key={flow.runKey} runKey={flow.runKey} path={flow.path} label={move.label} tone={move.tone}
      duration={flow.travel} font={font} onLanded={flow.onLanded}
      body={move.detail ? <Payload title={move.label} color={TONE_COLOR[move.tone]} lines={move.detail} font={font} /> : undefined} />}
  </Group>;
}
