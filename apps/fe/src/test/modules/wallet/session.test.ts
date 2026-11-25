import { expect, test } from "vitest";
import { createWalletStore } from "@/modules/wallet/session";
import { readStored, WrongPassword } from "@/modules/wallet/keystore";

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
