import { expect, test } from "bun:test";
import { phaseBBlocker, recordRefusal, recordStep, type Run } from "../src/setup/smoke-run.ts";

const run = (): Run => ({ vault: "0x00000000000000000000000000000000000000aa", startBlock: 1, txs: {}, refusals: {} });

test("a recorded step is skipped and every new hash is saved at once", async () => {
  const r = run();
  let saves = 0;
  let calls = 0;
  const save = () => { saves++; };
  await recordStep(r.txs, "buy1", async () => { calls++; return "0xa"; }, save);
  await recordStep(r.txs, "buy1", async () => { calls++; return "0xb"; }, save);
  expect(r.txs).toEqual({ buy1: "0xa" });
  expect([calls, saves]).toEqual([1, 1]);
  expect(await recordStep(r.txs, "window", async () => null, save)).toBeUndefined();
  expect(r.txs.window).toBeUndefined();
});

test("a step that throws keeps the hashes recorded before it", async () => {
  const r = run();
  await recordStep(r.txs, "create", async () => "0xc", () => {});
  await expect(recordStep(r.txs, "deposit", async () => { throw new Error("boom"); }, () => {})).rejects.toThrow("boom");
  expect(r.txs).toEqual({ create: "0xc" });
});

test("a refusal is computed once", async () => {
  const r = run();
  let calls = 0;
  await recordRefusal(r, "x", async () => { calls++; return "ReviewOpen"; }, () => {});
  await recordRefusal(r, "x", async () => { calls++; return "other"; }, () => {});
  expect(r.refusals.x).toBe("ReviewOpen");
  expect(calls).toBe(1);
});

test("phase b needs phase a finished and order 3 in review", () => {
  const r = run();
  expect(phaseBBlocker(r, 2)).toContain("txs.deliver3, txs.reject2, refusals.closeByNonOwner");
  r.txs.deliver3 = "0x1"; r.txs.reject2 = "0x2"; r.refusals.closeByNonOwner = "BadPqcSignature";
  expect(phaseBBlocker(r, 2)).toBeNull();
  expect(phaseBBlocker(r, 1)).toContain("not in review");
  r.txs.settle3 = "0x3"; // a rerun after order 3 was settled
  expect(phaseBBlocker(r, 3)).toBeNull();
});
