import { expect, test } from "vitest";
import { hexToQor } from "@qredit/qore";
import { Cancelled, createWalletStore } from "@/modules/wallet/session";
import { readStored, StorageUnavailable, WrongPassword } from "@/modules/wallet/keystore";
import type { QorexClient } from "@/modules/wallet/qorex";

const PHRASE = "abandon ".repeat(23) + "art";

function memoryStorage(): Storage {
  const s = new Map<string, string>();
  return {
    getItem: (k: string) => s.get(k) ?? null,
    setItem: (k: string, v: string) => void s.set(k, v),
    removeItem: (k: string) => void s.delete(k),
  } as unknown as Storage;
}

test("create, lock, unlock, wrong password, forget", async () => {
  const storage = memoryStorage();
  const store = createWalletStore({ storage });
  expect(store.getState().session.kind).toBe("none");

  await store.getState().create(PHRASE, "correct horse");
  const created = store.getState().session;
  expect(created.kind).toBe("test");
  if (created.kind !== "test") throw new Error("unreachable");
  expect(created.address).toMatch(/^qor1/);
  expect(created.evm).toMatch(/^0x[0-9a-fA-F]{40}$/);
  expect(readStored(storage)?.address).toBe(created.address);
  expect(JSON.stringify(readStored(storage))).not.toContain("abandon");

  store.getState().lock();
  expect(store.getState().session).toEqual({ kind: "locked", address: created.address });

  await expect(store.getState().unlock("wrong pass")).rejects.toBeInstanceOf(WrongPassword);
  expect(store.getState().session.kind).toBe("locked");

  await store.getState().unlock("correct horse");
  const again = store.getState().session;
  expect(again.kind).toBe("test");
  if (again.kind === "test") expect(again.address).toBe(created.address);

  store.getState().forget();
  expect(store.getState().session).toEqual({ kind: "none" });
  expect(readStored(storage)).toBeNull();
}, 30_000);

test("the phrase is not kept on the account after create or unlock", async () => {
  const store = createWalletStore({ storage: memoryStorage() });
  await store.getState().create(PHRASE, "correct horse");
  const a = store.getState().session;
  expect(a.kind === "test" && a.account.mnemonic).toBeUndefined();
  store.getState().lock();
  await store.getState().unlock("correct horse");
  const b = store.getState().session;
  expect(b.kind).toBe("test");
  expect(b.kind === "test" && b.account.mnemonic).toBeUndefined();
}, 30_000);

test("hydrate reads the storage", async () => {
  const storage = memoryStorage();
  const empty = createWalletStore({ storage });
  empty.getState().hydrate();
  expect(empty.getState().session.kind).toBe("none");

  const first = createWalletStore({ storage });
  await first.getState().create(PHRASE, "correct horse");
  const address = (first.getState().session as { address: string }).address;
  const second = createWalletStore({ storage });
  second.getState().hydrate();
  expect(second.getState().session).toEqual({ kind: "locked", address });
}, 30_000);

test("disconnect keeps the saved wallet but shows none, across a reload, until the wallet is unlocked", async () => {
  const storage = memoryStorage();
  const store = createWalletStore({ storage });
  await store.getState().create(PHRASE, "correct horse");
  const address = (store.getState().session as { address: string }).address;

  store.getState().disconnect();
  expect(store.getState().session).toEqual({ kind: "none" });
  expect(readStored(storage)?.address).toBe(address);
  expect(store.getState().hasSavedWallet()).toBe(true);

  const reloaded = createWalletStore({ storage });
  reloaded.getState().hydrate();
  expect(reloaded.getState().session).toEqual({ kind: "none" });

  await reloaded.getState().unlock("correct horse");
  expect(reloaded.getState().session.kind).toBe("test");
  const again = createWalletStore({ storage });
  again.getState().hydrate();
  expect(again.getState().session).toEqual({ kind: "locked", address });
}, 30_000);

test("create rejects an invalid phrase and a short password", async () => {
  const storage = memoryStorage();
  const store = createWalletStore({ storage });
  await expect(store.getState().create("not a real phrase", "correct horse")).rejects.toThrow();
  await expect(store.getState().create(PHRASE, "short")).rejects.toThrow();
  expect(store.getState().session.kind).toBe("none");
  expect(readStored(storage)).toBeNull();
}, 30_000);

test("a forget during a slow unlock is not undone", async () => {
  const storage = memoryStorage();
  const store = createWalletStore({ storage });
  await store.getState().create(PHRASE, "correct horse");
  store.getState().lock();
  const pending = store.getState().unlock("correct horse");
  store.getState().forget();
  await pending;
  expect(store.getState().session).toEqual({ kind: "none" });
  expect(readStored(storage)).toBeNull();
}, 30_000);

test("a forget during a slow create leaves nothing behind and rejects with Cancelled", async () => {
  const storage = memoryStorage();
  const store = createWalletStore({ storage });
  const pending = store.getState().create(PHRASE, "correct horse");
  store.getState().forget();
  await expect(pending).rejects.toBeInstanceOf(Cancelled);
  expect(store.getState().session).toEqual({ kind: "none" });
  expect(readStored(storage)).toBeNull();
}, 30_000);

test("a blocked storage write throws StorageUnavailable and sets nothing", async () => {
  const storage = {
    getItem: () => null,
    setItem: () => {
      throw new DOMException("full", "QuotaExceededError");
    },
    removeItem: () => {},
  } as unknown as Storage;
  const store = createWalletStore({ storage });
  await expect(store.getState().create(PHRASE, "correct horse")).rejects.toBeInstanceOf(StorageUnavailable);
  expect(store.getState().session.kind).toBe("none");
}, 30_000);

const QOREX_EVM = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
const QOREX_ADDR = hexToQor(QOREX_EVM);
const fakeQorex = (over: Partial<QorexClient> = {}): QorexClient => ({
  detect: () => "ready",
  connect: async () => ({ address: QOREX_ADDR, evm: QOREX_EVM }),
  signArbitrary: async () => new Uint8Array(),
  capabilities: () => [],
  ...over,
});

test("connectQorex without a wallet gives a QoreX session without a test wallet, disconnect returns to none", async () => {
  const store = createWalletStore({ storage: memoryStorage(), qorex: fakeQorex() });
  await store.getState().connectQorex();
  expect(store.getState().session).toEqual({ kind: "qorex", address: QOREX_ADDR, evm: QOREX_EVM, testWallet: null });
  store.getState().disconnectQorex();
  expect(store.getState().session).toEqual({ kind: "none" });
});

test("connectQorex keeps an unlocked test wallet, lock drops it but keeps QoreX, disconnect goes to locked", async () => {
  const store = createWalletStore({ storage: memoryStorage(), qorex: fakeQorex() });
  await store.getState().create(PHRASE, "correct horse");
  const test = store.getState().session;
  await store.getState().connectQorex();
  const s = store.getState().session;
  expect(s.kind === "qorex" && s.testWallet).toEqual(test);

  store.getState().lock();
  expect(store.getState().session).toEqual({ kind: "qorex", address: QOREX_ADDR, evm: QOREX_EVM, testWallet: null });
  store.getState().disconnectQorex();
  expect(store.getState().session.kind).toBe("locked");
}, 30_000);

test("unlock while QoreX is connected nests the test wallet; disconnect returns to it", async () => {
  const store = createWalletStore({ storage: memoryStorage(), qorex: fakeQorex() });
  await store.getState().create(PHRASE, "correct horse");
  store.getState().lock();
  await store.getState().connectQorex();
  await store.getState().unlock("correct horse");
  const s = store.getState().session;
  expect(s.kind === "qorex" && s.testWallet?.kind).toBe("test");
  store.getState().disconnectQorex();
  expect(store.getState().session.kind).toBe("test");
}, 30_000);

test("a failing connect leaves the session unchanged", async () => {
  const store = createWalletStore({ storage: memoryStorage(), qorex: fakeQorex({ connect: async () => { throw new Error("refused"); } }) });
  await expect(store.getState().connectQorex()).rejects.toThrow("refused");
  expect(store.getState().session).toEqual({ kind: "none" });
});

test("a forget during a slow QoreX connect is not undone", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const store = createWalletStore({
    storage: memoryStorage(),
    qorex: fakeQorex({ connect: async () => { await gate; return { address: QOREX_ADDR, evm: QOREX_EVM }; } }),
  });
  const pending = store.getState().connectQorex();
  store.getState().forget();
  release();
  await pending;
  expect(store.getState().session).toEqual({ kind: "none" });
});

test("a failed QoreX connect marks QoreX unavailable and does not cancel a pending unlock", async () => {
  const store = createWalletStore({ storage: memoryStorage(), qorex: fakeQorex({ connect: async () => { throw new Error("nope"); } }) });
  await store.getState().create(PHRASE, "correct horse");
  store.getState().lock();
  const pending = store.getState().unlock("correct horse");
  await expect(store.getState().connectQorex()).rejects.toThrow("nope");
  expect(store.getState().qorexState).toBe("unavailable");
  await pending;
  expect(store.getState().session.kind).toBe("test");
}, 30_000);

test("hydrate reads the QoreX state into the store and a successful connect makes it ready", async () => {
  const store = createWalletStore({
    storage: memoryStorage(),
    qorex: fakeQorex({ detect: () => "notInstalled" }),
  });
  store.getState().hydrate();
  expect(store.getState().qorexState).toBe("notInstalled");
  const ready = createWalletStore({ storage: memoryStorage(), qorex: fakeQorex() });
  ready.getState().hydrate();
  await expect(ready.getState().connectQorex()).resolves.toBeUndefined();
  expect(ready.getState().qorexState).toBe("ready");
});
