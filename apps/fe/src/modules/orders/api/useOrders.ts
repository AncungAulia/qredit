import { useMemo } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import type { Business } from "@/lib/schemas";
import { placeOrder, readQuote, type PlaceOrderProgress } from "@/modules/orders/api/orders.api";
import { lendKeys } from "@/modules/lend/api/lend.keys";
import { marketKeys } from "@/modules/market";
import { walletKeys } from "@/modules/wallet/api/useWalletStatus";
import { useWallet } from "@/modules/wallet/WalletProvider";

export const orderKeys = {
  quote: (vault: string, serviceId: number) => ["orders", "quote", vault, serviceId] as const,
};

/** The price and refund time of every service of a business, read from its vault, in the order of its services. */
export function useQuotesQuery(business: Business) {
  const results = useQueries({
    queries: business.services.map((s) => ({
      queryKey: orderKeys.quote(business.vault, s.id),
      queryFn: () => readQuote(business.vault, s.id),
      staleTime: 30_000,
    })),
  });
  return results;
}

/** Places an order for the current wallet. A confirmed order refreshes the market, the lending figures and the wallet. */
export function useOrderActions() {
  const session = useWallet((s) => s.session);
  const client = useQueryClient();
  return useMemo(
    () => ({
      place: async (business: Business, serviceId: number, input: string, onProgress: (p: PlaceOrderProgress) => void) => {
        const result = await placeOrder(session, business, serviceId, input, onProgress);
        void client.invalidateQueries({ queryKey: marketKeys.all });
        void client.invalidateQueries({ queryKey: lendKeys.all });
        void client.invalidateQueries({ queryKey: walletKeys.all });
        return result;
      },
    }),
    [session, client],
  );
}
