import { describe, expect, test } from "bun:test";
import { analyzeBytecode } from "../src/suppliers/data/bytecode.ts";
import { loadList, matchList, normalizeAddress } from "../src/suppliers/data/lists.ts";
import { createIndexer, toIndexerData } from "../src/suppliers/data/indexer.ts";

const PQC_VERIFY = "73" + "00".repeat(18) + "0a01";
const KEY_STATUS = "73" + "00".repeat(18) + "0a02";

describe("bytecode analysis", () => {
  test("empty code is not a contract", () => {
    expect(analyzeBytecode("0xabc", "0x")).toMatchObject({ isContract: false, codeSize: 0, usesPqcVerify: false, ecrecoverHint: false });
  });
  test("finds PQC precompile addresses, ERC-20 selectors and the ecrecover pattern", () => {
    const code = `0x6080${PQC_VERIFY}63a9059cbb63095ea7b3${KEY_STATUS}60015afa00` as const;
    const f = analyzeBytecode("0xabc", code);
    expect(f.isContract).toBe(true);
    expect(f.usesPqcVerify).toBe(true);
    expect(f.usesPqcKeyStatus).toBe(true);
    expect(f.erc20Selectors.sort()).toEqual(["approve", "transfer"]);
    expect(f.ecrecoverHint).toBe(true);
    expect(f.codeSize).toBe((code.length - 2) / 2);
  });
});

describe("lists", () => {
  const list = { list: "l", entries: [{ address: "0x000000000000000000000000000000000000dEaD", entry: "e" }] };
  test("normalizes qor1 and 0x addresses and rejects junk", () => {
    expect(normalizeAddress("0x000000000000000000000000000000000000dead")?.hex).toBe("0x000000000000000000000000000000000000dead");
    expect(normalizeAddress("nope")).toBeNull();
  });
  test("matches case-insensitively, by either address form", () => {
    expect(matchList(list, ["0x000000000000000000000000000000000000DEAD", "0x0000000000000000000000000000000000000001"])).toEqual({
      list: "l", checked: ["0x000000000000000000000000000000000000dead", "0x0000000000000000000000000000000000000001"],
      matches: [{ address: "0x000000000000000000000000000000000000dead", entry: "e" }],
    });
  });
  test("the bundled fixtures load and are marked synthetic", () => {
    expect(loadList("flagged-synthetic").entries).toHaveLength(2);
    const s = loadList("sanctions-synthetic");
    expect(s.entries).toHaveLength(3);
    expect(s.entries.every((e) => e.entry.startsWith("SYNTHETIC"))).toBe(true);
  });
});

describe("indexer mapping", () => {
  const info = { address: { bech32: "qor1x", hex: "0xAB" }, exists: true, sequence: "2", public_key_type: "eth_secp256k1", is_contract: false };
  const pq = { registered: true, possession_proven: false, key_type: "hybrid", evm_window: { live: true, allowed_targets: [] } };
  test("maps MCP output to IndexerData", () => {
    expect(toIndexerData(info, pq, { listed: false, entry: null, list: "f" })).toEqual({
      address: { bech32: "qor1x", hex: "0xab" }, exists: true, sequence: 2, publicKeyType: "eth_secp256k1", isContract: false,
      pq: { registered: true, possessionProven: false, keyType: "hybrid", window: { live: true, allowedTargets: [] } },
      flagged: { listed: false, entry: null, list: "f" },
    });
  });
  test("lookup calls both tools, reads address_status and flags listed addresses", async () => {
    const calls: unknown[] = [];
    const callTool = async (name: string, args: Record<string, string>) => {
      calls.push([name, args]);
      return name === "get_address_info"
        ? { ...info, address: { bech32: "qor1x", hex: "0x000000000000000000000000000000000000dEaD" } }
        : { address_status: pq };
    };
    const flags = { list: "f", entries: [{ address: "0x000000000000000000000000000000000000dead", entry: "bad" }] };
    const out = await createIndexer({ callTool, flags }).lookup("0xdead");
    expect(calls).toContainEqual(["get_address_info", { address: "0xdead" }]);
    expect(calls).toContainEqual(["get_pq_status", { target: "0xdead" }]);
    expect(out.flagged).toEqual({ listed: true, entry: "bad", list: "f" });
    expect(out.pq.registered).toBe(true);
  });
  test("an { error: true } tool result is thrown", async () => {
    const callTool = async () => ({ error: true, message: "bad address" });
    await expect(createIndexer({ callTool, flags: { list: "f", entries: [] } }).lookup("x")).rejects.toThrow(/failed/);
  });
});
