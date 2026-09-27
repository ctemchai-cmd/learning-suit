import { DashboardSkeleton } from "@/features/loading/skeletons";

// Instant loading state of the projects page while the server checks the session (plan 01 §loading).
export default function Loading() {
  return <DashboardSkeleton />;
}
