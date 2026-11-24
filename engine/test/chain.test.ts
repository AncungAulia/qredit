import { describe, expect, test } from "bun:test";
import type { EvmWindow } from "@qorechain/evm";
import { FACTORY_ADDRESS, FUSD_ADDRESS, VAULT_STATE } from "@qredit/qore";
import { ensureWindow, findExistingVault, matchVaultLog, planLend, windowCovers } from "../src/setup/chain.ts";

const V = "0x00000000000000000000000000000000000000aa";
const win = (o: Partial<EvmWindow> = {}): EvmWindow => ({
  found: true, live: true, openedHeight: 1n, expiryHeight: 9999n, maxTxs: 40n, usedTxs: 0n, maxValue: 1n, usedValue: 0n,
  remainingBlocks: 3000n, remainingTxs: 30n, remainingValue: 1n, nativeOnly: false, allowedTargets: [FUSD_ADDRESS.toLowerCase(), V], ...o,
});
const acc = { cosmos: "qor1test" } as never;

describe("windows", () => {
  test("covers only a live window with the targets and enough room", () => {
    const min = { blocks: 600, txs: 5 };
    expect(windowCovers(win(), [FUSD_ADDRESS, V], min)).toBe(true);
    expect(windowCovers(win(), ["0x00000000000000000000000000000000000000bb"], min)).toBe(false);
    expect(windowCovers(win({ live: false }), [V], min)).toBe(false);
    expect(windowCovers(win({ found: false }), [V], min)).toBe(false);
    expect(windowCovers(win({ remainingBlocks: 599n }), [V], min)).toBe(false);
    expect(windowCovers(win({ remainingTxs: 4n }), [V], min)).toBe(false);
    expect(windowCovers(win({ allowedTargets: [] }), [V], min)).toBe(true);
  });
  test("unreported targets are trusted only for windows opened in this run", () => {
    const unknown = win({ allowedTargets: undefined as never });
    expect(windowCovers(unknown, [V], { blocks: 1, txs: 1 })).toBe(false);
    expect(windowCovers(unknown, [V], { blocks: 1, txs: 1 }, new Set([V]))).toBe(true);
  });
  test("ensureWindow reuses a good window and opens otherwise", async () => {
    let opened = 0;
    const open = async () => { opened++; return "0xtx"; };
    expect(await ensureWindow(acc, [V], {}, { status: async () => win(), open })).toBeNull();
    expect(opened).toBe(0);
    expect(await ensureWindow(acc, [V], {}, { status: async () => win({ live: false }), open })).toBe("0xtx");
    expect(opened).toBe(1);
  });
  test("ensureWindow opens with each target once, whatever the caller passed", async () => {
    let sent: string[] = [];
    const open = async (_a: unknown, targets: string[]) => { sent = targets; return "0xtx"; };
    await ensureWindow(acc, [FUSD_ADDRESS, V, V.toUpperCase().replace("0X", "0x")], {}, { status: async () => win({ live: false }), open });
    expect(sent).toEqual([FUSD_ADDRESS.toLowerCase(), V]);
  });
});

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

describe("planLend", () => {
  const base = { state: VAULT_STATE.Raising as number, raised: 10n, target: 100n, balance: 500n, allowance: 0n };
  test("skips unless raising", () => {
    expect(planLend({ ...base, state: VAULT_STATE.Active }, 5n)).toEqual({ action: "skip", reason: "already funded or closed" });
    expect(planLend({ ...base, raised: 100n }, 5n).action).toBe("skip");
  });
  test("deposits min(requested, room) and approves only when needed", () => {
    expect(planLend(base, 20n)).toEqual({ action: "deposit", amount: 20n, approve: true });
    expect(planLend(base, 1000n)).toEqual({ action: "deposit", amount: 90n, approve: true });
    expect(planLend({ ...base, allowance: 90n }, 1000n)).toEqual({ action: "deposit", amount: 90n, approve: false });
  });
  test("errors clearly on insufficient balance", () => {
    expect(() => planLend({ ...base, balance: 5n }, 20n)).toThrow(/insufficient fUSD/);
  });
});
