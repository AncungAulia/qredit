import { beforeEach, expect, test, vi } from "vitest";

const ensureWindowFor = vi.fn();
const signerFor = vi.fn();

vi.mock("@/modules/wallet/signer", async (orig) => ({
  ...(await orig<typeof import("@/modules/wallet/signer")>()),
  evmSignerFor: (s: unknown) => signerFor(s),
  ensureWindowFor: (...a: unknown[]) => ensureWindowFor(...a),
}));

import { act, NO_TEST_WALLET_SENTENCE, requireSigner, WINDOW_FAILED_SENTENCE } from "@/modules/wallet/act";
import type { WalletSession } from "@/modules/wallet/session";
import { TxFailed, TxReverted } from "@/modules/wallet/signer";

const EVM = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
const VAULT = "0x1111111111111111111111111111111111111111";
const session = { kind: "test", address: "qor1x", evm: EVM } as unknown as WalletSession;
const wait = (ms = 5) => new Promise((r) => setTimeout(r, ms));

const events: string[] = [];
const send = vi.fn();
const signer = { address: EVM, send, sendForReceipt: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  events.length = 0;
  signerFor.mockReturnValue(signer);
  ensureWindowFor.mockResolvedValue(null);
  send.mockResolvedValue("0xhash");
});

test("requireSigner gives the signer of a test wallet and refuses a session without one with one shared sentence", () => {
  expect(requireSigner(session)).toBe(signer);
  signerFor.mockReturnValue(null);
  let error: unknown;
  try {
    requireSigner({ kind: "none" });
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(TxFailed);
  expect((error as TxFailed).hash).toBeNull();
  expect((error as TxFailed).reason).toBe(NO_TEST_WALLET_SENTENCE);
});

test("act opens the window for the targets, then runs the steps with the signer and returns their result", async () => {
  const out = await act(session, [VAULT], async (s) => {
    events.push("steps");
    return s.send(VAULT, "0x01");
  });
  expect(out).toBe("0xhash");
  expect(ensureWindowFor).toHaveBeenCalledWith(session, [VAULT]);
  expect(ensureWindowFor.mock.invocationCallOrder[0]).toBeLessThan(send.mock.invocationCallOrder[0]);
});

test("act without a test wallet fails before the window and runs nothing", async () => {
  signerFor.mockReturnValue(null);
  const steps = vi.fn();
  await expect(act({ kind: "none" }, [VAULT], steps)).rejects.toMatchObject({ name: "TxFailed", reason: NO_TEST_WALLET_SENTENCE });
  expect(ensureWindowFor).not.toHaveBeenCalled();
  expect(steps).not.toHaveBeenCalled();
});

test("a window failure says nothing was paid and the steps never run", async () => {
  ensureWindowFor.mockRejectedValue(new Error("rpc down"));
  const steps = vi.fn();
  const error = await act(session, [VAULT], steps).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(TxFailed);
  expect((error as TxFailed).hash).toBeNull();
  expect((error as TxFailed).reason).toBe(WINDOW_FAILED_SENTENCE);
  expect(WINDOW_FAILED_SENTENCE).toContain("Nothing was paid");
  expect(steps).not.toHaveBeenCalled();
});

test("a decoded window failure keeps its own sentence", async () => {
  const failed = new TxFailed(null, "The wallet has too little QOR to pay the network fee.");
  ensureWindowFor.mockRejectedValue(failed);
  expect(await act(session, [VAULT], vi.fn()).catch((e: unknown) => e)).toBe(failed);
  const reverted = new TxReverted(null, "x");
  ensureWindowFor.mockRejectedValue(reverted);
  expect(await act(session, [VAULT], vi.fn()).catch((e: unknown) => e)).toBe(reverted);
});

test("two actions on one address wait for each other and never interleave", async () => {
  ensureWindowFor.mockImplementation(async () => {
    events.push("window");
    await wait();
    return null;
  });
  send.mockImplementation(async (_to: string, data: string) => {
    events.push(`send ${data}`);
    await wait();
    return "0xhash";
  });
  const run = (name: string) =>
    act(session, [VAULT], async (s) => {
      await s.send(VAULT, `${name}1` as never);
      await s.send(VAULT, `${name}2` as never);
    });
  await Promise.all([run("a"), run("b")]);
  expect(events).toEqual(["window", "send a1", "send a2", "window", "send b1", "send b2"]);
});

test("an action that fails releases the lock for the next one", async () => {
  const first = act(session, [VAULT], async () => {
    await wait();
    throw new Error("boom");
  });
  const second = act(session, [VAULT], async () => "second");
  await expect(first).rejects.toThrow("boom");
  expect(await second).toBe("second");
});

test("a failed window also releases the lock", async () => {
  ensureWindowFor.mockRejectedValueOnce(new Error("rpc down"));
  const first = act(session, [VAULT], async () => "never");
  const second = act(session, [VAULT], async () => "second");
  await expect(first).rejects.toBeInstanceOf(TxFailed);
  expect(await second).toBe("second");
});
