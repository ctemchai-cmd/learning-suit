import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Dashboard from "@/features/projects/dashboard";
import { getServerIdentity, serverCloudConfigured } from "@/lib/server-identity";

export const metadata: Metadata = { title: "โปรเจกต์ · Learning Suit" };

export default async function ProjectsPage() {
  // Protected route: verify validated claims on the server before rendering the shell (SEC-06).
  // Data access is still enforced by RLS; this check is not the authorization boundary.
  if (serverCloudConfigured && !(await getServerIdentity())) redirect("/login");
  return <Dashboard />;
}
