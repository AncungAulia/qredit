import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Business } from "@/lib/schemas";
import { claim, lend, readFusdBalance, readPositions, refund } from "@/modules/lend/api/lend.api";
import { lendKeys } from "@/modules/lend/api/lend.keys";
import { marketKeys } from "@/modules/market";
import { walletKeys } from "@/modules/wallet/api/useWalletStatus";
import { useWallet } from "@/modules/wallet/WalletProvider";

type Hex = `0x${string}`;
const REFRESH_MS = 15_000;

/** The positions of the lender in every listed business; waits for the address and the business list. */
export const usePositionsQuery = (evm: Hex | null, businesses: Business[] | undefined) =>
  useQuery({
    queryKey: lendKeys.positions(evm ?? "", (businesses ?? []).map((b) => b.vault)),
    queryFn: () => readPositions(evm as Hex, businesses as Business[]),
    enabled: evm !== null && businesses !== undefined,
    refetchInterval: REFRESH_MS,
  });

export const useFusdBalanceQuery = (evm: Hex | null) =>
  useQuery({
    queryKey: lendKeys.balance(evm ?? ""),
    queryFn: () => readFusdBalance(evm as Hex),
    enabled: evm !== null,
    staleTime: 10_000,
  });

/**
 * Lend, claim and refund for the current wallet. After a transaction is confirmed the market and lending
 * figures are refetched, so no screen keeps showing the old numbers.
 */
export function useLendActions() {
  const session = useWallet((s) => s.session);
  const client = useQueryClient();
  return useMemo(() => {
    const refresh = () => {
      void client.invalidateQueries({ queryKey: marketKeys.all });
      void client.invalidateQueries({ queryKey: lendKeys.all });
      // The wallet's fUSD and the window it opened changed too.
      void client.invalidateQueries({ queryKey: walletKeys.all });
    };
    const done = <T>(result: T): T => {
      refresh();
      return result;
    };
    return {
      lend: async (vault: Hex, amount: bigint, onSent?: () => void) => done(await lend(session, vault, amount, onSent)),
      claim: async (vault: Hex) => done(await claim(session, vault)),
      refund: async (vault: Hex) => done(await refund(session, vault)),
    };
  }, [session, client]);
}
