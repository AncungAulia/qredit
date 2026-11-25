"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useStore, type StoreApi } from "zustand";
import { createWalletStore, type WalletStore } from "@/modules/wallet/session";

const WalletContext = createContext<StoreApi<WalletStore> | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => createWalletStore());
  // Storage is read in an effect so the server render and the first client render both show "none".
  useEffect(() => {
    store.getState().hydrate();
  }, [store]);
  return <WalletContext.Provider value={store}>{children}</WalletContext.Provider>;
}

export function useWallet<T>(selector: (s: WalletStore) => T): T {
  const store = useContext(WalletContext);
  if (!store) throw new Error("useWallet must be used inside WalletProvider.");
  return useStore(store, selector);
}
