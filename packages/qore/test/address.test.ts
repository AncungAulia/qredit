import { describe, expect, test } from "bun:test";
import { hexToQor, qorToHex } from "../src/address.ts";

const HEX = "0x487f449c21a48eaf9d2eb3804f511dfb7715eea9";

describe("address", () => {
  test("round-trips a 20-byte address", () => {
    const qor = hexToQor(HEX);
    expect(qor.startsWith("qor1")).toBe(true);
    expect(qorToHex(qor)).toBe(HEX);
  });
  test("accepts an upper-case hex input", () => {
    expect(qorToHex(hexToQor(HEX.toUpperCase().replace("0X", "0x")))).toBe(HEX);
  });
  test("returns null for a wrong prefix or garbage", () => {
    expect(qorToHex("cosmos1abc")).toBeNull();
    expect(qorToHex("not an address")).toBeNull();
  });
  test("does not need Buffer", () => {
    const saved = globalThis.Buffer;
    // @ts-expect-error simulate a browser
    delete globalThis.Buffer;
    try {
      expect(qorToHex(hexToQor(HEX))).toBe(HEX);
    } finally {
      globalThis.Buffer = saved;
    }
  });
});
