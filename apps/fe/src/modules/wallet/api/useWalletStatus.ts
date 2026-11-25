import { useQuery } from "@tanstack/react-query";
import type { UnifiedAccount } from "@qorechain/sdk";
import { readWalletStatus } from "@/modules/wallet/api/wallet.api";

export const walletKeys = { status: (address: string | null) => ["wallet", "status", address] as const };

/** The wallet's on-chain setup status; disabled until an account is unlocked. */
export const useWalletStatusQuery = (acc: UnifiedAccount | null) =>
  useQuery({
    queryKey: walletKeys.status(acc?.cosmos ?? null),
    queryFn: () => readWalletStatus(acc as UnifiedAccount),
    enabled: acc !== null,
    staleTime: 10_000,
  });
