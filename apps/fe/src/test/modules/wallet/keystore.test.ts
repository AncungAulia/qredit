import { expect, test } from "vitest";
import { decryptPhrase, encryptPhrase, readStored, WrongPassword } from "@/modules/wallet/keystore";

const PHRASE = "abandon ".repeat(23) + "art";

test("round-trips and never stores the phrase in clear", async () => {
  const w = await encryptPhrase(PHRASE, "correct horse", "qor1test");
  expect(JSON.stringify(w)).not.toContain("abandon");
  expect(await decryptPhrase(w, "correct horse")).toBe(PHRASE);
}, 30_000);

test("a wrong password or a swapped address fails", async () => {
  const w = await encryptPhrase(PHRASE, "correct horse", "qor1test");
  await expect(decryptPhrase(w, "wrong pass")).rejects.toBeInstanceOf(WrongPassword);
  await expect(decryptPhrase({ ...w, address: "qor1other" }, "correct horse")).rejects.toBeInstanceOf(WrongPassword);
}, 30_000);

test("two encryptions of the same input differ", async () => {
  const a = await encryptPhrase(PHRASE, "correct horse", "qor1test");
  const b = await encryptPhrase(PHRASE, "correct horse", "qor1test");
  expect(a.salt).not.toBe(b.salt);
  expect(a.iv).not.toBe(b.iv);
  expect(a.ct).not.toBe(b.ct);
}, 30_000);

test("a composed and a decomposed password are the same password", async () => {
  const w = await encryptPhrase(PHRASE, "café horse", "qor1test");
  expect(await decryptPhrase(w, "café horse")).toBe(PHRASE);
}, 30_000);

test("stored data with wrong sizes or address reads as null", async () => {
  const s = new Map<string, string>();
  const storage = { getItem: (k: string) => s.get(k) ?? null } as unknown as Storage;
  const w = await encryptPhrase(PHRASE, "correct horse", "qor1test");
  s.set("qredit.testWallet.v1", JSON.stringify(w));
  expect(readStored(storage)).not.toBeNull();
  for (const bad of [{ ...w, salt: "AAAA" }, { ...w, iv: "AAAA" }, { ...w, address: "0xabc" }]) {
    s.set("qredit.testWallet.v1", JSON.stringify(bad));
    expect(readStored(storage)).toBeNull();
  }
}, 30_000);

test("bad stored data reads as null", () => {
  const s = new Map<string, string>();
  const storage = {
    getItem: (k: string) => s.get(k) ?? null,
    setItem: (k: string, v: string) => void s.set(k, v),
    removeItem: (k: string) => void s.delete(k),
  } as unknown as Storage;
  s.set("qredit.testWallet.v1", "{broken");
  expect(readStored(storage)).toBeNull();
  s.set("qredit.testWallet.v1", JSON.stringify({ v: 2 }));
  expect(readStored(storage)).toBeNull();
});
