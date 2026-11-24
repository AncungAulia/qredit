import { describe, expect, test } from "bun:test";
import type { UnifiedAccount } from "@qorechain/sdk";
import { assertWindowOptions, keepWindows, serialPerAccount, type WindowChain } from "../src/windows.ts";

const acc = (cosmos: string) => ({ cosmos, evm: "0x0" }) as unknown as UnifiedAccount;
const opts = { blocks: 17280, maxTxs: 500, maxValue: 25_000_000n, minBlocks: 3600, minTxs: 10 };

describe("keepWindows", () => {
  test("renews only windows that are low on blocks or txs", async () => {
    const opened: [string, string[]][] = [];
    const chain: WindowChain = {
      status: async (a) => (a === "qor1full" ? { blocks: 9000, txs: 400 } : a === "qor1low" ? { blocks: 100, txs: 400 } : { blocks: 9000, txs: 3 }),
      open: async (a, targets) => { opened.push([a.cosmos, targets]); return `TX-${a.cosmos}`; },
    };
    const res = await keepWindows(
      [{ account: acc("qor1full"), targets: ["0xa"] }, { account: acc("qor1low"), targets: ["0xb"] }, { account: acc("qor1fewtx"), targets: ["0xc"] }],
      chain, opts,
    );
    expect(res).toEqual([
      { address: "qor1full", action: "kept" },
      { address: "qor1low", action: "renewed", tx: "TX-qor1low" },
      { address: "qor1fewtx", action: "renewed", tx: "TX-qor1fewtx" },
    ]);
    expect(opened).toEqual([["qor1low", ["0xb"]], ["qor1fewtx", ["0xc"]]]);
  });

  test("one failing account does not stop the others", async () => {
    const chain: WindowChain = {
      status: async (a) => { if (a === "qor1bad") throw new Error("rpc down"); return { blocks: 0, txs: 0 }; },
      open: async () => "TX",
    };
    const res = await keepWindows([{ account: acc("qor1bad"), targets: [] }, { account: acc("qor1ok"), targets: [] }], chain, opts);
    expect(res[0]).toEqual({ address: "qor1bad", action: "error", error: "rpc down" });
    expect(res[1]).toEqual({ address: "qor1ok", action: "renewed", tx: "TX" });
  });

  test("rejects out-of-range options before touching the chain", async () => {
    const chain: WindowChain = { status: async () => { throw new Error("must not be called"); }, open: async () => "TX" };
    for (const bad of [{ blocks: 0 }, { blocks: 17281 }, { maxTxs: 0 }, { maxTxs: 1001 }, { maxValue: 0n }, { blocks: 1.5 }, { minBlocks: 0 }, { minBlocks: 20000 }]) {
      await expect(keepWindows([{ account: acc("qor1a"), targets: [] }], chain, { ...opts, ...bad })).rejects.toThrow(RangeError);
    }
    expect(() => assertWindowOptions({ blocks: 1, maxTxs: 1, maxValue: 1n })).not.toThrow();
    expect(() => assertWindowOptions({ blocks: 17280, maxTxs: 1000, maxValue: 1n })).not.toThrow();
  });
});

describe("serialPerAccount", () => {
  test("sends from one account queue; different accounts run in parallel", async () => {
    const log: string[] = [];
    const gates = new Map<string, () => void>();
    const chain: WindowChain = {
      status: async () => ({ blocks: 0, txs: 0 }),
      open: (a, t) => new Promise((res) => { log.push(`start ${a.cosmos}${t[0]}`); gates.set(`${a.cosmos}${t[0]}`, () => { log.push(`end ${a.cosmos}${t[0]}`); res("TX"); }); }),
    };
    const s = serialPerAccount(chain);
    const o = { blocks: 1, maxTxs: 1, maxValue: 1n };
    const ps = [s.open(acc("A"), ["1"], o), s.open(acc("A"), ["2"], o), s.open(acc("B"), ["1"], o)];
    await Bun.sleep(5);
    expect(log).toEqual(["start A1", "start B1"]);
    gates.get("A1")!();
    await Bun.sleep(5);
    expect(log).toContain("start A2");
    gates.get("A2")!(); gates.get("B1")!();
    await Promise.all(ps);
  });
});
