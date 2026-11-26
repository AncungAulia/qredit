import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Business } from "@/lib/schemas";
import { marketKeys } from "@/modules/market";
import { applyOrder, buildOrder, claimOwnerShare, ownedVaults, readRules, simulateApply } from "@/modules/owner/api/owner.api";
import { ownerKeys } from "@/modules/owner/api/owner.keys";
import type { OrderInput, PolicyOrder } from "@/modules/owner/schemas/policyOrder.schema";
import { testWalletOf } from "@/modules/wallet/signer";
import { createQorexClient } from "@/modules/wallet/qorex";
import { useWallet } from "@/modules/wallet/WalletProvider";

type Hex = `0x${string}`;
const REFRESH_MS = 15_000;
const BUSINESS_KEYS = ["business"] as const;

/** The vaults the connected QoreX account owns; waits for the account and the business list. */
export const useOwnedVaultsQuery = (evm: Hex | null, businesses: Business[] | undefined) =>
  useQuery({
    queryKey: ownerKeys.owned(evm ?? "", (businesses ?? []).map((b) => b.vault)),
    queryFn: () => ownedVaults(evm as Hex, businesses as Business[]),
    enabled: evm !== null && businesses !== undefined,
  });

export const useRulesQuery = (vault: Hex | null) =>
  useQuery({
    queryKey: ownerKeys.rules(vault ?? ""),
    queryFn: () => readRules(vault as Hex),
    enabled: vault !== null,
    refetchInterval: REFRESH_MS,
  });

/**
 * Build, sign, check and apply a policy order for the connected account. Signing is done by QoreX, the dry run by the
 * node, and the send by the test wallet (QoreX cannot send EVM transactions). After a confirmed order the rules and
 * the market are read again.
 */
export function useOwnerActions() {
  const session = useWallet((s) => s.session);
  const client = useQueryClient();
  return useMemo(() => {
    const from = testWalletOf(session)?.evm;
    return {
      build: (vault: Hex, input: OrderInput) => buildOrder(vault, input),
      sign: (address: string, text: string) => createQorexClient().signArbitrary(address, text),
      simulate: (vault: Hex, order: PolicyOrder, sig: Uint8Array) => simulateApply(vault, order, sig, from),
      apply: async (vault: Hex, order: PolicyOrder, sig: Uint8Array) => {
        const hash = await applyOrder(session, vault, order, sig);
        void client.invalidateQueries({ queryKey: ownerKeys.all });
        void client.invalidateQueries({ queryKey: marketKeys.all });
        // The business page shows the same rules and the supplier list.
        void client.invalidateQueries({ queryKey: BUSINESS_KEYS });
        return hash;
      },
      claim: async (vault: Hex) => {
        const hash = await claimOwnerShare(session, vault);
        void client.invalidateQueries({ queryKey: ownerKeys.all });
        return hash;
      },
    };
  }, [session, client]);
}
