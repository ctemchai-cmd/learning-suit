import type { Metadata } from "next";
import { notFound } from "next/navigation";
import LiveGuest from "@/features/live/live-guest";

export const metadata: Metadata = { title: "ห้องวาดร่วม · Learning Suit" };

// A student's way into a drawing room: no account; the room id in the link is the key (plan 08 §access).
export default async function LiveRoomPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  if (!/^[0-9a-f]{32}$/.test(roomId)) notFound();
  return <LiveGuest roomId={roomId} />;
}
