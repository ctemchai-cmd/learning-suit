import { describe, expect, it, vi } from "vitest";
import { validateOrRecover } from "./open-recovery";

const validate = (draft: { ok: boolean }) => { if (!draft.ok) throw new Error("unreadable"); };

describe("validateOrRecover", () => {
  it("a valid draft is returned as is and recovery is never started", async () => {
    const recover = vi.fn();
    const draft = { ok: true };
    expect(await validateOrRecover(draft, validate, recover)).toBe(draft);
    expect(recover).not.toHaveBeenCalled();
  });

  it("an unreadable clean draft is healed by exactly one recovery", async () => {
    const healed = { ok: true };
    const recover = vi.fn(async () => healed);
    expect(await validateOrRecover({ ok: false }, validate, recover)).toBe(healed);
    expect(recover).toHaveBeenCalledTimes(1);
  });

  it("without recovery, a failed recovery or a still-unreadable result, the original error stands (nothing unreadable opens)", async () => {
    await expect(validateOrRecover({ ok: false }, validate)).rejects.toThrow("unreadable");
    await expect(validateOrRecover({ ok: false }, validate, async () => null)).rejects.toThrow("unreadable");
    await expect(validateOrRecover({ ok: false }, validate, async () => { throw new Error("offline"); })).rejects.toThrow("unreadable");
    await expect(validateOrRecover({ ok: false }, validate, async () => ({ ok: false }))).rejects.toThrow("unreadable");
  });
});
