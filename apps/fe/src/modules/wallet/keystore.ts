// Encrypted test-wallet storage: PBKDF2-SHA-256 -> AES-GCM 256 with the address as additional data.
// Pure WebCrypto, no React. The phrase never reaches storage in clear.
import { base64 } from "@scure/base";
import { z } from "zod";

export const KEYSTORE_KEY = "qredit.testWallet.v1";
/** Set while the saved test wallet is disconnected: kept in the browser, but not offered as locked on load. */
export const DISCONNECTED_KEY = "qredit.testWallet.disconnected";
const ITERATIONS = 600_000;

function base64Bytes(length?: number) {
  return z.string().refine((s) => {
    try {
      const n = base64.decode(s).length;
      return length === undefined ? n > 0 : n === length;
    } catch {
      return false;
    }
  }, "Invalid base64 field.");
}

export const storedWalletSchema = z.object({
  v: z.literal(1),
  address: z.string().startsWith("qor1"),
  salt: base64Bytes(16),
  iv: base64Bytes(12),
  ct: base64Bytes(),
  createdAt: z.string().min(1),
});
export type StoredWallet = z.infer<typeof storedWalletSchema>;

export const passwordSchema = z.string().min(8, "The password must have at least 8 characters.");

export class WrongPassword extends Error {
  constructor() {
    super("The password is not correct.");
    this.name = "WrongPassword";
  }
}

export class StorageUnavailable extends Error {
  constructor() {
    super("The browser blocked saving the wallet. Check the storage settings and try again.");
    this.name = "StorageUnavailable";
  }
}

const enc = new TextEncoder();

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", enc.encode(password.normalize("NFKC")), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: ITERATIONS },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptPhrase(phrase: string, password: string, address: string): Promise<StoredWallet> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv as BufferSource, additionalData: enc.encode(address) as BufferSource },
      key,
      enc.encode(phrase),
    ),
  );
  return {
    v: 1,
    address,
    salt: base64.encode(salt),
    iv: base64.encode(iv),
    ct: base64.encode(ct),
    createdAt: new Date().toISOString(),
  };
}

export async function decryptPhrase(stored: StoredWallet, password: string): Promise<string> {
  try {
    const key = await deriveKey(password, base64.decode(stored.salt));
    const plain = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: base64.decode(stored.iv) as BufferSource,
        additionalData: enc.encode(stored.address) as BufferSource,
      },
      key,
      base64.decode(stored.ct) as BufferSource,
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new WrongPassword();
  }
}

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function readStored(storage: Storage | null = defaultStorage()): StoredWallet | null {
  try {
    const raw = storage?.getItem(KEYSTORE_KEY);
    if (!raw) return null;
    const parsed = storedWalletSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function writeStored(w: StoredWallet, storage: Storage | null = defaultStorage()): void {
  if (!storage) throw new StorageUnavailable();
  try {
    storage.setItem(KEYSTORE_KEY, JSON.stringify(w));
  } catch {
    throw new StorageUnavailable();
  }
}

export function forgetStored(storage: Storage | null = defaultStorage()): void {
  try {
    storage?.removeItem(KEYSTORE_KEY);
  } catch {
    // Storage is unavailable; nothing to remove.
  }
}

/** Whether the saved test wallet was disconnected (so a reload shows "Connect", not "Locked"). */
export function readDisconnected(storage: Storage | null = defaultStorage()): boolean {
  try {
    return storage?.getItem(DISCONNECTED_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeDisconnected(disconnected: boolean, storage: Storage | null = defaultStorage()): void {
  try {
    if (disconnected) storage?.setItem(DISCONNECTED_KEY, "1");
    else storage?.removeItem(DISCONNECTED_KEY);
  } catch {
    // Storage is unavailable; the flag only affects what a reload shows.
  }
}
