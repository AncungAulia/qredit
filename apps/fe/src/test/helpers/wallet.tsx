// Test helpers for the wallet components: an in-memory Storage, a controllable QoreX client, a desktop
// media query (dialogs instead of sheets) and a provider tree with a fresh query client per render.
import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { configure, render } from "@testing-library/react";
import { vi } from "vitest";
import { WalletProvider, useWalletApi, type WalletStore } from "@/modules/wallet";
import type { QorexClient, QorexState } from "@/modules/wallet/qorex";

// Encrypting or decrypting a wallet takes 600,000 key-derivation rounds; async queries must outwait it.
configure({ asyncUtilTimeout: 15_000 });

export const PHRASE = "abandon ".repeat(23) + "art";
export const PASSWORD = "correct horse";

/** Runs `run` against the wallet store once, then renders the children (for example, to start with an unlocked wallet). */
export function Boot({ run, children }: { run(store: WalletStore): Promise<void>; children: ReactNode }) {
  const api = useWalletApi();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void run(api.getState()).then(() => setReady(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);
  return ready ? <>{children}</> : null;
}

export function memoryStorage(): Storage {
  const s = new Map<string, string>();
  return {
    getItem: (k: string) => s.get(k) ?? null,
    setItem: (k: string, v: string) => void s.set(k, v),
    removeItem: (k: string) => void s.delete(k),
  } as unknown as Storage;
}

export function fakeQorex(state: QorexState = "notInstalled", connect?: QorexClient["connect"]): QorexClient {
  return {
    detect: vi.fn(() => state),
    connect:
      connect ?? vi.fn(async () => ({ address: "qor1qorexaddress0000000000000000000000000", evm: "0x0000000000000000000000000000000000000001" as const })),
    signArbitrary: vi.fn(),
    capabilities: () => [],
  };
}

/** Makes `(min-width: ...)` queries match, so ResponsiveDialog renders a dialog rather than a sheet. */
export function useDesktopViewport(matches = true) {
  window.matchMedia = ((query: string) =>
    ({
      matches,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList) as typeof window.matchMedia;
}

export function renderWithWallet(ui: ReactElement, deps: { storage?: Storage; qorex?: QorexClient } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <WalletProvider deps={deps}>{ui}</WalletProvider>
    </QueryClientProvider>,
  );
}
