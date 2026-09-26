import { GIT_LIMITS, type CommitId, type FileSnapshot, type GitCommit, type GitSimulationState, type MachineId, type MachineRepository, type RepositoryId } from "./model";

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

/** Exact comparison of name and content (no trimming). `null` equals only `null`. */
export function snapshotsEqual(a: FileSnapshot | null, b: FileSnapshot | null): boolean {
  if (a === null || b === null) return a === b;
  return a.name === b.name && a.content === b.content;
}

export function copySnapshot(snapshot: FileSnapshot): FileSnapshot {
  return { name: snapshot.name, content: snapshot.content };
}

/** Snapshot of the machine's `mainHead`, or `null` before the first commit. */
export function headSnapshot(state: GitSimulationState, repo: MachineRepository): FileSnapshot | null {
  if (repo.mainHead === null) return null;
  return state.commits[repo.mainHead]?.snapshot ?? null;
}

export function hasUnstaged(state: GitSimulationState, machine: MachineId): boolean {
  const repo = state.machines[machine];
  if (!repo.initialized) return false;
  return !snapshotsEqual(repo.working, repo.index);
}

export function hasStaged(state: GitSimulationState, machine: MachineId): boolean {
  const repo = state.machines[machine];
  if (!repo.initialized) return false;
  return !snapshotsEqual(repo.index, headSnapshot(state, repo));
}

export function isClean(state: GitSimulationState, machine: MachineId): boolean {
  return !hasUnstaged(state, machine) && !hasStaged(state, machine);
}

// ---------------------------------------------------------------------------
// Commit IDs and ancestry
// ---------------------------------------------------------------------------

export function commitNumber(id: CommitId): number {
  return Number(id.slice(1));
}

/** Numeric order: C2 before C10. */
export function compareCommitIds(a: CommitId, b: CommitId): number {
  return commitNumber(a) - commitNumber(b);
}

/** Returns a new, de-duplicated array sorted by commit number. */
export function sortCommitIds(ids: Iterable<CommitId>): CommitId[] {
  return [...new Set(ids)].sort(compareCommitIds);
}

/** Parents of a commit: the first parent, then the merged-in parent of a merge commit. */
export function parentsOf(commit: GitCommit | undefined): CommitId[] {
  if (!commit) return [];
  const parents: CommitId[] = [];
  if (commit.parentId) parents.push(commit.parentId);
  if (commit.mergeParentId) parents.push(commit.mergeParentId);
  return parents;
}

/**
 * `a` is an ancestor of `b` when a === b or when walking parents (both parents of a merge) from `b` reaches `a`,
 * visiting only commits in `known`. `null` is the base before any commit and is an ancestor of every head.
 * The walk never leaves the known set, so it cannot reveal commits the repository does not know.
 */
export function isAncestor(
  a: CommitId | null,
  b: CommitId | null,
  known: ReadonlySet<CommitId> | readonly CommitId[],
  commits: Record<CommitId, GitCommit>,
): boolean {
  if (a === null) return true;
  if (b === null) return false;
  return ancestorsOf(b, known, commits).includes(a);
}

/** `head` and its ancestors (through both parents of a merge), restricted to `known`, sorted by number. */
export function ancestorsOf(
  head: CommitId | null,
  known: ReadonlySet<CommitId> | readonly CommitId[],
  commits: Record<CommitId, GitCommit>,
): CommitId[] {
  const knownSet = toSet(known);
  const result = new Set<CommitId>();
  const queue: CommitId[] = head !== null ? [head] : [];
  while (queue.length) {
    const current = queue.pop()!;
    if (!knownSet.has(current) || result.has(current)) continue;
    result.add(current);
    queue.push(...parentsOf(commits[current]));
  }
  return sortCommitIds(result);
}

/** `head` and its first parents only — the straight line of `main` a graph draws in its first lane. */
export function firstParentChain(
  head: CommitId | null,
  known: ReadonlySet<CommitId> | readonly CommitId[],
  commits: Record<CommitId, GitCommit>,
): CommitId[] {
  const knownSet = toSet(known);
  const result = new Set<CommitId>();
  let current: CommitId | null = head;
  while (current !== null && knownSet.has(current) && !result.has(current)) {
    result.add(current);
    current = commits[current]?.parentId ?? null;
  }
  return sortCommitIds(result);
}

/** Local and fetched `origin/main` each have commits the other lacks. */
export function isDiverged(state: GitSimulationState, machine: MachineId): boolean {
  const counts = aheadBehind(state, machine);
  return Boolean(counts && counts.ahead && counts.behind);
}

function toSet(known: ReadonlySet<CommitId> | readonly CommitId[]): ReadonlySet<CommitId> {
  return known instanceof Set ? known : new Set(known as readonly CommitId[]);
}

export type AheadBehind = { ahead: number; behind: number };

/**
 * Ahead/behind of local `main` versus the `origin/main` this machine last knew.
 * Uses only the machine's known IDs; returns `null` when tracking is unknown.
 */
export function aheadBehind(state: GitSimulationState, machine: MachineId): AheadBehind | null {
  const repo = state.machines[machine];
  if (!repo.initialized || repo.originMainHead === null) return null;
  const local = new Set(ancestorsOf(repo.mainHead, repo.knownCommitIds, state.commits));
  const tracking = new Set(ancestorsOf(repo.originMainHead, repo.knownCommitIds, state.commits));
  let ahead = 0;
  let behind = 0;
  for (const id of local) if (!tracking.has(id)) ahead += 1;
  for (const id of tracking) if (!local.has(id)) behind += 1;
  return { ahead, behind };
}

export function repositoryKnownIds(state: GitSimulationState, repository: RepositoryId): CommitId[] {
  return repository === "remote" ? state.remote.knownCommitIds : state.machines[repository].knownCommitIds;
}

/** Commits known to one repository, newest (highest number) first. Never reads outside the known set. */
export function knownCommitsNewestFirst(state: GitSimulationState, repository: RepositoryId): GitCommit[] {
  return sortCommitIds(repositoryKnownIds(state, repository))
    .reverse()
    .map((id) => state.commits[id])
    .filter((commit): commit is GitCommit => Boolean(commit));
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function codePointLength(value: string): number {
  return [...value].length;
}

/** UTF-8 byte length without relying on platform encoders (lone surrogates count as U+FFFD, 3 bytes). */
export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code < 0x10000) bytes += 3;
    else bytes += 4;
  }
  return bytes;
}

export type FileValidationError = "name-empty" | "name-too-long" | "name-invalid-character" | "content-too-large";
export type FileValidation =
  | { ok: true; file: FileSnapshot }
  | { ok: false; field: "name" | "content"; error: FileValidationError };

const INVALID_NAME_CHARACTER = /[\\/\u0000-\u001F\u007F-\u009F]/u;

/** Trims the name (never the content) and checks the file limits of plan 04 §2. */
export function validateFileSnapshot(file: FileSnapshot): FileValidation {
  const name = file.name.trim();
  const length = codePointLength(name);
  if (length < 1) return { ok: false, field: "name", error: "name-empty" };
  if (length > GIT_LIMITS.fileNameCodePoints) return { ok: false, field: "name", error: "name-too-long" };
  if (INVALID_NAME_CHARACTER.test(name)) return { ok: false, field: "name", error: "name-invalid-character" };
  if (utf8ByteLength(file.content) > GIT_LIMITS.fileContentBytes) return { ok: false, field: "content", error: "content-too-large" };
  return { ok: true, file: { name, content: file.content } };
}

export type MessageValidationError = "message-empty" | "message-too-long" | "message-newline";
export type MessageValidation = { ok: true; message: string } | { ok: false; error: MessageValidationError };

const NEWLINE = /[\r\n\u2028\u2029]/u;

/** Trims the message, then requires 1–200 code points on a single line. */
export function validateCommitMessage(message: string): MessageValidation {
  const trimmed = message.trim();
  const length = codePointLength(trimmed);
  if (length < 1) return { ok: false, error: "message-empty" };
  if (NEWLINE.test(trimmed)) return { ok: false, error: "message-newline" };
  if (length > GIT_LIMITS.messageCodePoints) return { ok: false, error: "message-too-long" };
  return { ok: true, message: trimmed };
}

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------

/** Structural equality for plain JSON-like values (key order independent). */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => jsonEqual(item, b[index]));
  }
  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  const aKeys = Object.keys(aRecord);
  const bKeys = Object.keys(bRecord);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => Object.prototype.hasOwnProperty.call(bRecord, key) && jsonEqual(aRecord[key], bRecord[key]));
}
