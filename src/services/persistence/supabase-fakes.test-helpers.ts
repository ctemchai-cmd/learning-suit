import type { SupabaseClient } from "@supabase/supabase-js";

// Network-free fakes for the Supabase adapters' unit tests.

export type Call = { method: string; args: unknown[] };

/** A PostgREST-builder look-alike: records every chained call and resolves to `response` when awaited. */
export function fakeQuery(response: unknown, calls: Call[] = []): { query: unknown; calls: Call[] } {
  const query: unknown = new Proxy({}, {
    get(_target, property) {
      if (property === "then") {
        return (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve(response).then(resolve, reject);
      }
      return (...args: unknown[]) => {
        calls.push({ method: String(property), args });
        return query;
      };
    },
  });
  return { query, calls };
}

export interface FakeClientOptions {
  /** Responses for successive `from(table)` chains. */
  from?: unknown[];
  /** Responses for successive `rpc(fn, args)` calls. */
  rpc?: unknown[];
  bucket?: unknown;
}

export function fakeClient(options: FakeClientOptions) {
  const fromResponses = [...(options.from ?? [])];
  const rpcResponses = [...(options.rpc ?? [])];
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      calls.push({ method: "from", args: [table] });
      if (!fromResponses.length) throw new Error(`unexpected from(${table})`);
      return fakeQuery(fromResponses.shift(), calls).query;
    },
    rpc(fn: string, args: unknown) {
      calls.push({ method: "rpc", args: [fn, args] });
      if (!rpcResponses.length) throw new Error(`unexpected rpc(${fn})`);
      return fakeQuery(rpcResponses.shift(), calls).query;
    },
    storage: {
      from(bucket: string) {
        calls.push({ method: "storage.from", args: [bucket] });
        return options.bucket;
      },
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

export const VALID_DOCUMENT = {
  schemaVersion: 1,
  slides: [{ id: "10000000-0000-4000-8000-000000000001", name: "Commit อยู่ในเครื่อง", background: "#FFFFFF", nodes: [] }],
  assets: {},
} as const;
