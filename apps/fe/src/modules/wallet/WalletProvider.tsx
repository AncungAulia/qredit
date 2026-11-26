"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useStore, type StoreApi } from "zustand";
import { createWalletStore, type WalletDeps, type WalletStore } from "@/modules/wallet/session";

const WalletContext = createContext<StoreApi<WalletStore> | null>(null);

/** `deps` lets tests give the store its own storage and QoreX client; the app passes none. */
export function WalletProvider({ children, deps }: { children: ReactNode; deps?: WalletDeps }) {
  const [store] = useState(() => createWalletStore(deps));
  // Storage is read in an effect so the server render and the first client render both show "none".
  useEffect(() => {
    store.getState().hydrate();
  }, [store]);
  return <WalletContext.Provider value={store}>{children}</WalletContext.Provider>;
}

/** The store itself, for reading the latest state inside an event handler (state that was just set). */
export function useWalletApi(): StoreApi<WalletStore> {
  const store = useContext(WalletContext);
  if (!store) throw new Error("useWalletApi must be used inside WalletProvider.");
  return store;
}

export function useWallet<T>(selector: (s: WalletStore) => T): T {
  return useStore(useWalletApi(), selector);
}
