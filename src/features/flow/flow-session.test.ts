import { describe, expect, it } from "vitest";
import type { FlowFrame } from "@/domain/data/model";
import { waitingAt, type FlowPlay } from "./flow-session";

const frame = (from: string | null, to: string, tone: "data" | "request" | "ok" = "data", marks: FlowFrame<unknown>["marks"] = []): FlowFrame<unknown> =>
  ({ hop: from ? { from, to, label: "", tone } : null, caption: "", state: null, marks });
const at = (frames: FlowFrame<unknown>[], index: number, phase: "moving" | "landed"): FlowPlay => ({ key: 1, initial: null, frames, index, phase });

describe("app spinner tied to the moving packet", () => {
  const roundTrip = [frame("phoneB", "cloud", "request"), frame("cloud", "phoneB", "ok")];

  it("spins from the request until the answer lands", () => {
    expect(waitingAt(at(roundTrip, 0, "moving"), "phoneB")).toBe("load");
    expect(waitingAt(at(roundTrip, 0, "landed"), "phoneB")).toBe("load");
    expect(waitingAt(at(roundTrip, 1, "moving"), "phoneB")).toBe("load");
    expect(waitingAt(at(roundTrip, 1, "landed"), "phoneB")).toBeNull();
    expect(waitingAt(at(roundTrip, 0, "moving"), "phoneA")).toBeNull();
  });

  it("says “saving” when the app sent data, and spins while an answer arrives unasked", () => {
    const save = [frame("phoneA", "gate"), frame("gate", "row:menu:5", "ok"), frame("db", "phoneA", "ok")];
    expect(waitingAt(at(save, 1, "moving"), "phoneA")).toBe("save");
    expect(waitingAt(at([frame(null, ""), frame("devA", "phoneA", "ok")], 1, "moving"), "phoneA")).toBe("load");
    expect(waitingAt(at([frame("phoneA", "memA")], 0, "moving"), "phoneA")).toBeNull();
  });

  it("shows the refresh state while the app restarts", () => {
    const refresh = [frame(null, "", "data", [{ spot: "phoneA", tone: "refresh" }]), frame("devA", "phoneA", "ok")];
    expect(waitingAt(at(refresh, 0, "landed"), "phoneA")).toBe("refresh");
    expect(waitingAt(at(refresh, 1, "moving"), "phoneA")).toBe("load");
    expect(waitingAt(null, "phoneA")).toBeNull();
  });
});
