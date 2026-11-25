import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { keystore, memoryKeystore } from "../src/keystore.ts";
import { loadSupplierAddresses, runtimeBundle, runtimeKeystore } from "../src/runtime-keys.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "qredit-rk-"));
const fixture = () => {
  const ks = keystore(tmp());
  ks.write("a-agent", { ed25519: "aa" });
  ks.write("a-operator", { privateKey: "0x01", recoveryCode: "SECRET-RECOVERY" });
  ks.write("a-seal", { seed: "bb" });
  ks.write("a-spender", { mnemonic: "SECRET MNEMONIC" });
  return ks;
};

describe("runtimeBundle", () => {
  test("keeps only the runtime fields", () => {
    const b = runtimeBundle(fixture(), ["a"]);
    expect(b).toEqual({ "a-agent": { ed25519: "aa" }, "a-operator": { privateKey: "0x01" }, "a-seal": { seed: "bb" } });
    expect(JSON.stringify(b)).not.toContain("SECRET");
  });
  test("names the missing file or field, never a value", () => {
    expect(() => runtimeBundle(fixture(), ["b"])).toThrow("missing key file b-agent");
    const ks = keystore(tmp());
    ks.write("c-agent", { ed25519: "" });
    expect(() => runtimeBundle(ks, ["c"])).toThrow("c-agent has no ed25519");
  });
});

describe("memoryKeystore", () => {
  const ks = memoryKeystore({ x: { k: "v" }, y: { k: "w" } });
  test("has, read, list", () => {
    expect(ks.has("x")).toBe(true);
    expect(ks.has("z")).toBe(false);
    expect(ks.read("y")).toEqual({ k: "w" });
    expect(ks.list()).toEqual(["x", "y"]);
    expect(() => ks.read("z")).toThrow();
  });
  test("write throws", () => expect(() => ks.write("q", { a: "b" })).toThrow("read-only keystore"));
});

describe("runtimeKeystore", () => {
  const dir = tmp();
  test("memory when ENGINE_KEYS_JSON is set", () => {
    const ks = runtimeKeystore({ ENGINE_KEYS_JSON: JSON.stringify({ a: { k: "v" } }) }, dir);
    expect(ks.read("a")).toEqual({ k: "v" });
    expect(() => ks.write("b", {})).toThrow("read-only keystore");
  });
  test("file keystore otherwise", () => {
    const ks = runtimeKeystore({}, dir);
    ks.write("f", { k: "v" });
    expect(ks.has("f")).toBe(true);
  });
  test("bad input is rejected without echoing it", () => {
    for (const bad of ["{not json SECRETVALUE", "[1]", '{"a":"SECRETVALUE"}', '{"a":{"k":1}}', "null"]) {
      let msg = "";
      try { runtimeKeystore({ ENGINE_KEYS_JSON: bad }, dir); } catch (e) { msg = (e as Error).message; }
      expect(msg).toContain("ENGINE_KEYS_JSON");
      expect(msg).not.toContain("SECRETVALUE");
    }
  });
});

describe("loadSupplierAddresses", () => {
  const addr = (n: number) => `0x${String(n).repeat(40)}`;
  const write = (o: unknown) => {
    const p = join(tmp(), "suppliers.json");
    writeFileSync(p, JSON.stringify(o));
    return p;
  };
  test("reads four addresses", () => {
    const a = loadSupplierAddresses(write({ dataIndexer: addr(1), listOracle: addr(2), computeBasic: addr(3), computeDeep: addr(4) }));
    expect(a.computeDeep).toBe(addr(4));
  });
  test("rejects a missing or malformed address", () => {
    expect(() => loadSupplierAddresses(write({ dataIndexer: addr(1), listOracle: "nope", computeBasic: addr(3), computeDeep: addr(4) }))).toThrow("listOracle");
    expect(() => loadSupplierAddresses(write({ dataIndexer: addr(1) }))).toThrow("listOracle");
  });
  test("reports a missing file", () => expect(() => loadSupplierAddresses(join(tmp(), "none.json"))).toThrow("suppliers.json"));
});

describe("supplier roles", () => {
  test("the shared supplier map in qore has exactly the owner's supplier accounts", async () => {
    const { SUPPLIERS } = await import("@qredit/qore");
    const { SUPPLIER_ACCOUNTS } = await import("../src/setup/accounts.ts");
    expect(Object.keys(SUPPLIERS).sort()).toEqual(Object.keys(SUPPLIER_ACCOUNTS).sort());
  });
  test("the committed file passes the runtime validation", () => {
    expect(Object.keys(loadSupplierAddresses()).sort()).toEqual(["computeBasic", "computeDeep", "dataIndexer", "listOracle"]);
  });
});
