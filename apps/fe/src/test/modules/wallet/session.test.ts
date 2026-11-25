import { expect, test } from "vitest";
import { createWalletStore } from "@/modules/wallet/session";
import { readStored, StorageUnavailable, WrongPassword } from "@/modules/wallet/keystore";

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

test("a forget during a slow create leaves nothing behind", async () => {
  const storage = memoryStorage();
  const store = createWalletStore({ storage });
  const pending = store.getState().create(PHRASE, "correct horse");
  store.getState().forget();
  await pending;
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
