import type { Metadata } from "next";
import { redirect } from "next/navigation";
import LoginForm from "@/features/auth/login-form";
import { safeNext } from "@/features/auth/safe-next";
import { getServerIdentity, serverCloudConfigured } from "@/lib/server-identity";

export const metadata: Metadata = { title: "เข้าสู่ระบบ · Learning Suit" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const single = (value: string | string[] | undefined) => (typeof value === "string" ? value : null);

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  // Same-origin paths only; the origin is a placeholder because only the path is kept.
  const next = safeNext(single(params.next), "https://app.invalid");
  // Already signed in: skip the form.
  if (serverCloudConfigured && await getServerIdentity()) redirect(next);
  return <LoginForm next={next} notice={single(params.notice)} />;
}
