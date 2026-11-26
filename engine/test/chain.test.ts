import { describe, expect, test } from "bun:test";
import { FACTORY_ADDRESS } from "@qredit/qore";
import { findExistingVault, matchVaultLog } from "../src/setup/chain.ts";

const V = "0x00000000000000000000000000000000000000aa";
describe("existing vault lookup", () => {
  const log = (o: { address?: string; spender?: string; vault?: string; block?: bigint }) => ({
    address: o.address ?? FACTORY_ADDRESS, args: { vault: o.vault ?? V, spender: o.spender ?? "0xAB" }, blockNumber: o.block ?? 10n, transactionHash: "0xh",
  });
  test("matches this factory and this spender only", () => {
    expect(matchVaultLog([log({ spender: "0xcd" })], "0xab")).toBeNull();
    expect(matchVaultLog([log({ address: "0x00000000000000000000000000000000000000ff" })], "0xab")).toBeNull();
    expect(matchVaultLog([log({ spender: "0xcd" }), log({ block: 77n })], "0xab")).toEqual({ vault: V, startBlock: 77, tx: "0xh" });
  });
  test("scans from the factory start block in chunks, filtered by ownerPq", async () => {
    const calls: { fromBlock: bigint; toBlock: bigint; args: unknown }[] = [];
    const c = {
      getBlockNumber: async () => 10_671_000n,
      getLogs: async (p: (typeof calls)[number]) => { calls.push(p); return p.fromBlock === 10_669_776n ? [log({})] : []; },
    };
    const found = await findExistingVault("0xOwner", "0xab", c as never);
    expect(found?.vault).toBe(V);
    expect(calls[0].fromBlock).toBe(10_667_776n);
    expect(calls.every((x) => x.toBlock - x.fromBlock < 2000n)).toBe(true);
    expect(calls[0].args).toEqual({ ownerPq: "0xOwner" });
  });
});

describe("treasury window", () => {
  test("is its own object with its own values, not the buyer window", async () => {
    const { BUYER_WINDOW } = await import("@qredit/qore");
    const { TREASURY_WINDOW } = await import("../src/setup/chain.ts");
    expect(TREASURY_WINDOW).not.toBe(BUYER_WINDOW);
    expect(TREASURY_WINDOW).toEqual({ blocks: 3600, maxTxs: 40, maxValue: 60_000_000n });
  });
});
