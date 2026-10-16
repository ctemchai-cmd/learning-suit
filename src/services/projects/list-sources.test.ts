import { describe, expect, it } from "vitest";
import { readListSources } from "./list-sources";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("readListSources", () => {
  it("starts the cloud request before the local read finishes (both in flight together)", async () => {
    const events: string[] = [];
    let finishLocal!: () => void;
    const localGate = new Promise<void>((resolve) => { finishLocal = resolve; });
    const result = readListSources({
      readLocal: async () => { events.push("local:start"); await localGate; events.push("local:end"); return "L"; },
      readCloud: async () => { events.push("cloud:start"); await tick(); events.push("cloud:end"); return "C"; },
    });
    await tick(); await tick();
    // Local is still blocked, yet the cloud request has started and even finished: nothing waits for IndexedDB.
    expect([...events].sort()).toEqual(["cloud:end", "cloud:start", "local:start"]);
    expect(events.indexOf("cloud:end")).toBeGreaterThan(events.indexOf("cloud:start"));
    finishLocal();
    expect(await result).toEqual({ local: "L", cloud: "C" });
  });

  it("total time is the slower side, not the sum", async () => {
    const started = Date.now();
    await readListSources({
      readLocal: async () => { await new Promise((r) => setTimeout(r, 60)); return 1; },
      readCloud: async () => { await new Promise((r) => setTimeout(r, 60)); return 2; },
    });
    expect(Date.now() - started).toBeLessThan(110);
  });

  it("a cloud failure yields cloud:null and keeps the local data", async () => {
    const result = await readListSources({ readLocal: async () => "L", readCloud: async () => { throw new Error("offline"); } });
    expect(result).toEqual({ local: "L", cloud: null });
  });

  it("a local failure rejects without leaving an unhandled cloud rejection", async () => {
    await expect(readListSources({ readLocal: async () => { throw new Error("idb"); }, readCloud: async () => { throw new Error("offline"); } })).rejects.toThrow("idb");
  });
});
