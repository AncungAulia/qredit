import { describe, expect, test } from "bun:test";
import type { EvmWindow } from "@qorechain/evm";
import { buildRegisterKemKeyMessage, generateSealKeys } from "@qorechain/qoreseal";
import { addressesFrom20, qorechainRegistry } from "@qorechain/sdk";
import { hex } from "@scure/base";
import { BUYER_WINDOW, defaultSleep, ensureWindow, registerKemKeyMsg, windowCovers } from "../src/buyer.ts";
import { FUSD_ADDRESS } from "../src/abi.ts";
import { TESTNET } from "../src/net.ts";

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
    expect(await ensureWindow(TESTNET, acc, [V], {}, { status: async () => win(), open })).toBeNull();
    expect(opened).toBe(0);
    expect(await ensureWindow(TESTNET, acc, [V], {}, { status: async () => win({ live: false }), open })).toBe("0xtx");
    expect(opened).toBe(1);
  });
  test("ensureWindow opens with each target once, whatever the caller passed", async () => {
    let sent: string[] = [];
    const open = async (_n: unknown, _a: unknown, targets: string[]) => { sent = targets; return "0xtx"; };
    await ensureWindow(TESTNET, acc, [FUSD_ADDRESS, V, V.toUpperCase().replace("0X", "0x")], {}, { status: async () => win({ live: false }), open });
    expect(sent).toEqual([FUSD_ADDRESS.toLowerCase(), V]);
  });
  test("ensureWindow passes its injected sleep to the opener", async () => {
    const sleep = async () => {};
    let got: unknown;
    const open = async (_n: unknown, _a: unknown, _t: string[], _o: unknown, s: unknown) => { got = s; return "0xtx"; };
    await ensureWindow(TESTNET, acc, [V], {}, { status: async () => win({ live: false }), open, sleep });
    expect(got).toBe(sleep);
  });
  test("the buyer window shape and the default sleep", async () => {
    expect(BUYER_WINDOW).toEqual({ blocks: 3600, maxTxs: 40, maxValue: 60_000_000n });
    await defaultSleep(1);
  });
});

describe("KEM registration message", () => {
  test("the broadcastable message encodes to the same bytes as qoreseal's builder", () => {
    const keys = generateSealKeys();
    const sender = addressesFrom20(new Uint8Array(20).fill(7)).cosmos;
    const msg = registerKemKeyMsg(sender, keys.mlkemPublicKey);
    const reference = buildRegisterKemKeyMessage({ sender, mlkemPublicKey: keys.mlkemPublicKey });
    expect(msg.typeUrl).toBe(reference.typeUrl);
    expect(hex.encode(qorechainRegistry().encodeAsAny(msg).value)).toBe(hex.encode(reference.value));
  });
});
