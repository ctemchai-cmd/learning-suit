import { describe, expect, it } from "vitest";
import { sha256Hex } from "./sha256";

const EMPTY = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const ABC = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

describe("sha256Hex", () => {
  it("hashes Uint8Array, ArrayBuffer and Blob inputs identically", async () => {
    const bytes = new TextEncoder().encode("abc");
    expect(await sha256Hex(bytes)).toBe(ABC);
    expect(await sha256Hex(bytes.slice().buffer)).toBe(ABC);
    expect(await sha256Hex(new Blob([bytes]))).toBe(ABC);
    expect(await sha256Hex(new Uint8Array(0))).toBe(EMPTY);
  });

  it("hashes only the viewed range of a subarray", async () => {
    const backing = new TextEncoder().encode("xxabcxx");
    expect(await sha256Hex(backing.subarray(2, 5))).toBe(ABC);
  });
});
