// Wallet session store. A factory (never a module-level create()) so each provider owns its store.
// Keys live only in this store's memory while unlocked; the phrase is dropped right after derivation.
import { createStore, type StoreApi } from "zustand/vanilla";
import { deriveUnifiedAccount, validateMnemonic, type UnifiedAccount } from "@qorechain/sdk";
import { deriveSealKeys, type SealKeyPair } from "@qorechain/qoreseal";
import {
  decryptPhrase,
  encryptPhrase,
  forgetStored,
  passwordSchema,
  readStored,
  writeStored,
} from "@/modules/wallet/keystore";

export type TestSession = {
  kind: "test";
  address: string;
  evm: `0x${string}`;
  account: UnifiedAccount;
  sealKeys: SealKeyPair;
};

export type WalletSession =
  | { kind: "none" }
  | { kind: "locked"; address: string }
  | TestSession
  | { kind: "qorex"; address: string; evm: `0x${string}`; testWallet: TestSession | null };

export type WalletStore = {
  session: WalletSession;
  /** Reads the browser storage: a stored wallet means locked, none means none. Called from an effect. */
  hydrate(): void;
  unlock(password: string): Promise<void>;
  create(phrase: string, password: string): Promise<void>;
  lock(): void;
  forget(): void;
};

export type WalletDeps = { storage?: Storage };

async function deriveSession(phrase: string): Promise<TestSession> {
  const derived = await deriveUnifiedAccount(phrase, 0);
  const sealKeys = await deriveSealKeys({ mnemonic: phrase });
  // The SDK keeps the phrase on the account; remove it so only the keys stay in memory.
  const account: UnifiedAccount = { ...derived, mnemonic: undefined };
  return { kind: "test", address: account.cosmos, evm: account.evm as `0x${string}`, account, sealKeys };
}

export const createWalletStore = (deps: WalletDeps = {}): StoreApi<WalletStore> =>
  createStore<WalletStore>()((set, get) => ({
    session: { kind: "none" },
    hydrate() {
      if (get().session.kind !== "none") return;
      const stored = readStored(deps.storage);
      if (stored) set({ session: { kind: "locked", address: stored.address } });
    },
    async unlock(password) {
      const stored = readStored(deps.storage);
      if (!stored) throw new Error("There is no saved test wallet.");
      const phrase = await decryptPhrase(stored, password);
      set({ session: await deriveSession(phrase) });
    },
    async create(phrase, password) {
      const clean = phrase.trim().replace(/\s+/g, " ");
      if (!validateMnemonic(clean)) throw new Error("The recovery phrase is not valid.");
      passwordSchema.parse(password);
      const session = await deriveSession(clean);
      writeStored(await encryptPhrase(clean, password, session.address), deps.storage);
      set({ session });
    },
    lock() {
      const { session } = get();
      if (session.kind === "test") set({ session: { kind: "locked", address: session.address } });
    },
    forget() {
      forgetStored(deps.storage);
      set({ session: { kind: "none" } });
    },
  }));
