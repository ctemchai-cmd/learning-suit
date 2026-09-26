import type { Metadata } from "next";
import { redirect } from "next/navigation";
import ChangePasswordForm from "@/features/auth/change-password-form";
import { getServerIdentity, serverCloudConfigured } from "@/lib/server-identity";

export const metadata: Metadata = { title: "เปลี่ยนรหัสผ่าน · Learning Suit" };

export default async function ChangePasswordPage() {
  // Without Supabase there are no accounts; the login page explains the local mode.
  if (!serverCloudConfigured) redirect("/login");
  const identity = await getServerIdentity();
  if (!identity?.email) redirect("/login?next=%2Fchange-password");
  return <ChangePasswordForm email={identity.email} />;
}
