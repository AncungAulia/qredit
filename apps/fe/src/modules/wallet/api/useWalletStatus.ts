import { useQuery } from "@tanstack/react-query";
import type { TestSession } from "@/modules/wallet/session";
import { readWalletStatus } from "@/modules/wallet/api/wallet.api";

export const walletKeys = {
  all: ["wallet"] as const,
  status: (address: string | null) => ["wallet", "status", address] as const,
};

/** The wallet's on-chain setup status; disabled until a test wallet is unlocked. */
export const useWalletStatusQuery = (session: Pick<TestSession, "account" | "sealKeys"> | null) =>
  useQuery({
    queryKey: walletKeys.status(session?.account.cosmos ?? null),
    queryFn: () => (session ? readWalletStatus(session.account, session.sealKeys) : Promise.reject(new Error("The wallet is locked."))),
    enabled: session !== null,
    staleTime: 10_000,
  });
