import { EditorSkeleton } from "@/features/loading/skeletons";

// Instant loading state of a lesson: the editor's shape from the first byte (plan 01 §loading).
export default function Loading() {
  return <EditorSkeleton />;
}
