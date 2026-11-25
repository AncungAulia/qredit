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
import { createQorexClient, type QorexClient } from "@/modules/wallet/qorex";

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
  /** Connects QoreX; an unlocked test wallet stays available under it. */
  connectQorex(): Promise<void>;
  /** Drops QoreX and returns to the test wallet (unlocked, locked or none). */
  disconnectQorex(): void;
};

export type WalletDeps = { storage?: Storage; qorex?: QorexClient };

/** A finished unlock or create: nested under QoreX when QoreX is connected, otherwise the session itself. */
const withTestWallet = (current: WalletSession, test: TestSession): WalletSession =>
  current.kind === "qorex" ? { ...current, testWallet: test } : test;

async function deriveSession(phrase: string): Promise<TestSession> {
  const derived = await deriveUnifiedAccount(phrase, 0);
  const sealKeys = await deriveSealKeys({ mnemonic: phrase });
  // The SDK keeps the phrase on the account; remove it so only the keys stay in memory.
  const account: UnifiedAccount = { ...derived, mnemonic: undefined };
  return { kind: "test", address: account.cosmos, evm: account.evm as `0x${string}`, account, sealKeys };
}

export const createWalletStore = (deps: WalletDeps = {}): StoreApi<WalletStore> => {
  // Bumped by every operation; an async unlock or create applies its result only while it is still the latest.
  let token = 0;
  let qorexClient: QorexClient | undefined;
  const qorex = () => (qorexClient ??= deps.qorex ?? createQorexClient());
  return createStore<WalletStore>()((set, get) => ({
    session: { kind: "none" },
    hydrate() {
      if (get().session.kind !== "none") return;
      const stored = readStored(deps.storage);
      if (stored) set({ session: { kind: "locked", address: stored.address } });
    },
    async unlock(password) {
      const stored = readStored(deps.storage);
      if (!stored) throw new Error("There is no saved test wallet.");
      const mine = ++token;
      const phrase = await decryptPhrase(stored, password);
      const session = await deriveSession(phrase);
      if (mine === token) set({ session: withTestWallet(get().session, session) });
    },
    async create(phrase, password) {
      const clean = phrase.trim().replace(/\s+/g, " ");
      if (!validateMnemonic(clean)) throw new Error("The recovery phrase is not valid.");
      passwordSchema.parse(password);
      const mine = ++token;
      const session = await deriveSession(clean);
      const record = await encryptPhrase(clean, password, session.address);
      if (mine !== token) return;
      writeStored(record, deps.storage);
      set({ session: withTestWallet(get().session, session) });
    },
    lock() {
      token++;
      const { session } = get();
      if (session.kind === "test") set({ session: { kind: "locked", address: session.address } });
      else if (session.kind === "qorex" && session.testWallet) set({ session: { ...session, testWallet: null } });
    },
    forget() {
      token++;
      forgetStored(deps.storage);
      const { session } = get();
      set({ session: session.kind === "qorex" ? { ...session, testWallet: null } : { kind: "none" } });
    },
    async connectQorex() {
      const mine = ++token;
      const { address, evm } = await qorex().connect();
      if (mine !== token) return;
      const current = get().session;
      const testWallet = current.kind === "test" ? current : current.kind === "qorex" ? current.testWallet : null;
      set({ session: { kind: "qorex", address, evm, testWallet } });
    },
    disconnectQorex() {
      token++;
      const { session } = get();
      if (session.kind !== "qorex") return;
      if (session.testWallet) return set({ session: session.testWallet });
      const stored = readStored(deps.storage);
      set({ session: stored ? { kind: "locked", address: stored.address } : { kind: "none" } });
    },
  }));
};
