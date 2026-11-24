import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { keystore } from "../src/keystore.ts";

describe("keystore", () => {
  test("writes once, reads back, lists", () => {
    const ks = keystore(mkdtempSync(join(tmpdir(), "qredit-keys-")));
    expect(ks.has("relayer")).toBe(false);
    ks.write("relayer", { mnemonic: "a b c" });
    expect(ks.has("relayer")).toBe(true);
    expect(ks.read("relayer")).toEqual({ mnemonic: "a b c" });
    expect(() => ks.write("relayer", { mnemonic: "x" })).toThrow();
    expect(ks.list()).toEqual(["relayer"]);
  });
  test("rejects names that could escape the folder", () => {
    const ks = keystore(mkdtempSync(join(tmpdir(), "qredit-keys-")));
    expect(() => ks.write("../evil", {})).toThrow();
    expect(() => ks.read("a/b")).toThrow();
  });
});
