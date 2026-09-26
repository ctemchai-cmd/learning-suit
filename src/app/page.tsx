import { redirect } from "next/navigation";
import { getServerIdentity, serverCloudConfigured } from "@/lib/server-identity";

// `/` redirects by session: `/projects` when signed in (or in the local development adapter), else `/login`.
export default async function Home() {
  if (!serverCloudConfigured) redirect("/projects");
  const identity = await getServerIdentity();
  redirect(identity ? "/projects" : "/login");
}
