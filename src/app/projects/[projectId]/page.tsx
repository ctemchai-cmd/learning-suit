import { notFound, redirect } from "next/navigation";
import EditorBoundary from "@/features/editor/editor-boundary";
import { getServerIdentity, serverCloudConfigured } from "@/lib/server-identity";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!UUID.test(projectId)) notFound();
  if (serverCloudConfigured && !(await getServerIdentity())) redirect(`/login?next=${encodeURIComponent(`/projects/${projectId}`)}`);
  return <EditorBoundary projectId={projectId} />;
}
