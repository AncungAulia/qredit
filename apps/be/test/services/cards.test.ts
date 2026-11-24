import { describe, expect, test } from "bun:test";
import { ChainUnavailable, createCardVerifier, KeysNotRegistered } from "../../src/services/cards.ts";

const keys = { mlkem: new Uint8Array([1]), pq: new Uint8Array([2]) };
const mk = (fetchKeys: () => Promise<typeof keys>, verify: () => unknown = () => undefined, now = () => 0) =>
  createCardVerifier({ chainId: "c", fetchKeys, verify, now });

describe("createCardVerifier", () => {
  test("ok when the card verifies against the chain keys", async () => {
    expect(await mk(async () => keys)("qor1a", {})).toEqual({ ok: true });
  });
  test("mismatch when verification throws or the keys are not registered", async () => {
    expect(await mk(async () => keys, () => { throw new Error("bad"); })("qor1a", {})).toEqual({ ok: false, reason: "mismatch" });
    expect(await mk(async () => { throw new KeysNotRegistered("none"); })("qor1a", {})).toEqual({ ok: false, reason: "mismatch" });
  });
  test("unavailable when the chain cannot be asked", async () => {
    expect(await mk(async () => { throw new ChainUnavailable("rpc down"); })("qor1a", {})).toEqual({ ok: false, reason: "unavailable" });
    expect(await mk(async () => { throw new TypeError("fetch failed"); })("qor1a", {})).toEqual({ ok: false, reason: "unavailable" });
  });
  test("keys are fetched once per address per 60 s; failures are not cached", async () => {
    let t = 0, calls = 0, fail = true;
    const v = mk(async () => { calls++; if (fail) throw new ChainUnavailable("x"); return keys; }, () => undefined, () => t);
    expect((await v("qor1a", {})).ok).toBe(false);
    fail = false;
    expect((await v("qor1a", {})).ok).toBe(true);
    expect((await v("qor1a", {})).ok).toBe(true);
    expect(calls).toBe(2);
    await v("qor1b", {});
    expect(calls).toBe(3);
    t = 60_001;
    await v("qor1a", {});
    expect(calls).toBe(4);
  });
});
