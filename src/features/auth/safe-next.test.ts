import { describe, expect, it } from "vitest";
import { safeNext } from "./safe-next";

const origin = "https://learning.example";

describe("safeNext (post-login redirect)", () => {
  it("keeps same-origin app paths", () => {
    expect(safeNext("/projects/abc?x=1#y", origin)).toBe("/projects/abc?x=1#y");
  });
  it("rejects external, protocol-relative and parser-stripped control character tricks", () => {
    for (const value of ["//evil.example", "/\t/evil.example", "/\n/evil.example", "/\\evil.example", "https://evil.example", "javascript:alert(1)", "", null]) {
      expect(safeNext(value, origin), String(value)).toBe("/projects");
    }
    expect(safeNext(decodeURIComponent("/%09/evil.example"), origin)).toBe("/projects");
  });
});
