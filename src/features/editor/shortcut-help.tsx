"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";

const ROWS: [string, string][] = [
  ["V / H / P / R / O / A / T", "เลือก / เลื่อนกระดาน / ปากกา / สี่เหลี่ยม / วงกลม / ลูกศร / ข้อความ"],
  ["K", "เลเซอร์พอยเตอร์ (ชี้โดยไม่วาด หางจางหายเอง)"],
  ["⇧P / L / E", "ไฮไลต์ / เส้น / ยางลบ"],
  ["⌘Z / ⌘⇧Z", "เลิกทำ / ทำซ้ำ"],
  ["⌘S", "บันทึกบทเรียน (ถ้ากำลังลากอยู่ จะบันทึกหลังปล่อยเมาส์)"],
  ["⌘C / ⌘V / ⌘D", "คัดลอกวัตถุในแอป / วาง / ทำสำเนา"],
  ["⌘A / ⌘L", "เลือกทุกวัตถุที่ไม่ล็อกในสไลด์นี้ / ล็อก (ปลดล็อกที่แท็บ Objects)"],
  ["⌘] / ⌘[ (+⇧)", "ย้ายขึ้น/ลงหนึ่งชั้น (สุดทาง)"],
  ["ลูกศร / ⇧ลูกศร", "ขยับ 1 / 10 หน่วย"],
  ["Delete", "ลบวัตถุที่เลือก"],
  ["⌥ + ลาก", "ทำสำเนาขณะลาก (ปล่อยเมาส์เพื่อวาง)"],
  ["Space + ลาก", "เลื่อนกระดานชั่วคราว"],
  ["⌘ + scroll / pinch", "ซูมรอบตำแหน่งเมาส์"],
  ["PageUp / PageDown", "เปลี่ยนสไลด์"],
  ["Esc", "ยกเลิกสิ่งที่กำลังวาด/ลาก → ล้างการเลือก"],
  ["⌘Enter", "จบการแก้ข้อความ"],
];

export default function ShortcutHelp({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog-content !w-[min(560px,calc(100vw-2rem))]">
      <div className="flex items-start justify-between"><Dialog.Title className="text-xl font-semibold">คีย์ลัด</Dialog.Title><Dialog.Close className="app-button icon-button" aria-label="ปิด"><X size={18} /></Dialog.Close></div>
      <Dialog.Description className="muted mt-1 text-sm">ใช้ Ctrl แทน ⌘ ได้เมื่อไม่ได้ใช้ Mac · คีย์ลัดไม่ทำงานขณะพิมพ์ในช่องข้อความ</Dialog.Description>
      <table className="mt-4 w-full text-sm"><tbody>{ROWS.map(([keys, action]) => <tr key={keys} className="border-t border-slate-100"><td className="py-1.5 pr-3 font-mono text-xs whitespace-nowrap">{keys}</td><td className="py-1.5">{action}</td></tr>)}</tbody></table>
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>;
}
