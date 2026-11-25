import { afterEach, expect, test, vi } from "vitest";
import { hexToQor, qorToHex } from "@qredit/qore";
import { createQorexClient, QorexNoPqSignature } from "@/modules/wallet/qorex";

const BECH = hexToQor("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
const CHAIN = "qorechain-diana";

type Native = {
  capabilities: string[];
  enable: ReturnType<typeof vi.fn>;
  getKey: ReturnType<typeof vi.fn>;
  signArbitrary: ReturnType<typeof vi.fn>;
};

function fakeWindow(native: Partial<Native> | null): Window {
  return { qorex: native ? { native } : undefined } as unknown as Window;
}

function okNative(over: Partial<Native> = {}): Native {
  return {
    capabilities: ["signArbitrary", "signAndBroadcast", "signDirectAddsPqcLayer"],
    enable: vi.fn().mockResolvedValue(null),
    getKey: vi.fn().mockResolvedValue({ bech32Address: BECH }),
    signArbitrary: vi.fn(),
    ...over,
  };
}

afterEach(() => vi.restoreAllMocks());

test("detect: not installed", () => {
  expect(createQorexClient(fakeWindow(null)).detect()).toBe("notInstalled");
});

test("detect: installed is ready before any connection attempt", () => {
  expect(createQorexClient(fakeWindow(okNative())).detect()).toBe("ready");
});

test("connect returns the bech32 address and its hex form, enabling the configured chain", async () => {
  const native = okNative();
  const client = createQorexClient(fakeWindow(native));
  const out = await client.connect();
  expect(native.enable).toHaveBeenCalledWith(CHAIN);
  expect(native.getKey).toHaveBeenCalledWith(CHAIN);
  expect(out.address).toBe(BECH);
  expect(out.evm).toBe(qorToHex(BECH));
});

test("connect on the wrong network flips detect to wrongNetwork and rethrows", async () => {
  const native = okNative({ enable: vi.fn().mockRejectedValue(new Error("QoreX: unsupported chain qorechain-diana")) });
  const client = createQorexClient(fakeWindow(native));
  await expect(client.connect()).rejects.toThrow(/unsupported chain/);
  expect(client.detect()).toBe("wrongNetwork");
});

test("connect without QoreX throws", async () => {
  await expect(createQorexClient(fakeWindow(null)).connect()).rejects.toThrow(/not installed/i);
});

test("signArbitrary decodes the base64 post-quantum signature to bytes", async () => {
  const bytes = Uint8Array.from([1, 2, 3, 250, 255]);
  const b64 = btoa(String.fromCharCode(...bytes));
  const native = okNative({ signArbitrary: vi.fn().mockResolvedValue({ pq: { signature: b64 } }) });
  const out = await createQorexClient(fakeWindow(native)).signArbitrary(BECH, "qredit-order-v1:0x1234");
  expect(native.signArbitrary).toHaveBeenCalledWith(CHAIN, BECH, "qredit-order-v1:0x1234");
  expect(Array.from(out)).toEqual(Array.from(bytes));
});

test("signArbitrary throws QorexNoPqSignature when pq is missing", async () => {
  const native = okNative({ signArbitrary: vi.fn().mockResolvedValue({ signature: "AAAA" }) });
  await expect(createQorexClient(fakeWindow(native)).signArbitrary(BECH, "x")).rejects.toBeInstanceOf(QorexNoPqSignature);
});

test("capabilities lists what the build declares, empty when absent", () => {
  expect(createQorexClient(fakeWindow(okNative())).capabilities()).toContain("signArbitrary");
  expect(createQorexClient(fakeWindow(null)).capabilities()).toEqual([]);
});
