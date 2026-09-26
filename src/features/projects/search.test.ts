import { describe, expect, it } from "vitest";
import { matchesQuery } from "./search";

describe("UX-07: searching projects by title", () => {
  it("matches every word in any order, ignoring case and extra spaces", () => {
    expect(matchesQuery("บทเรียน Git ครั้งที่ 1", "")).toBe(true);
    expect(matchesQuery("บทเรียน Git ครั้งที่ 1", "git")).toBe(true);
    expect(matchesQuery("บทเรียน Git ครั้งที่ 1", "  ครั้งที่   git ")).toBe(true);
    expect(matchesQuery("บทเรียน Git ครั้งที่ 1", "deploy")).toBe(false);
    expect(matchesQuery("ฐานข้อมูล", "ข้อมูล")).toBe(true);
  });
  it("treats composed and decomposed forms the same", () => {
    expect(matchesQuery("Café", "café")).toBe(true);
  });
});
