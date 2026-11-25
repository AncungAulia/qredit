import { useQuery } from "@tanstack/react-query";
import type { Business } from "@/lib/schemas";
import { businessKeys } from "@/modules/business/api/business.keys";
import {
  getDecisions,
  readCreationSuppliers,
  readVaultRules,
} from "@/modules/business/api/business.api";

const RULES_STALE_MS = 60_000;
const DECISIONS_REFRESH_MS = 15_000;

/** The suppliers the vault was created with. Chain history never changes, so it is read once. */
const useCreationSuppliersQuery = (business: Business) =>
  useQuery({
    queryKey: businessKeys.suppliers(business.vault),
    queryFn: () => readCreationSuppliers(business),
    staleTime: Infinity,
  });

/** The spending rules of the vault now. Waits for the creation suppliers, which are cached for good. */
export function useRulesQuery(business: Business) {
  const suppliers = useCreationSuppliersQuery(business);
  const addresses = suppliers.data;
  const rules = useQuery({
    queryKey: businessKeys.rules(business.vault),
    queryFn: () => readVaultRules(business, addresses),
    enabled: addresses !== undefined,
    staleTime: RULES_STALE_MS,
  });
  return {
    data: rules.data,
    // A failed supplier lookup is a failed rules load; nothing else would show.
    isError: suppliers.isError || rules.isError,
    refetch: () => (suppliers.isError ? suppliers.refetch() : rules.refetch()),
  };
}

export const useDecisionsQuery = (vault: `0x${string}`) =>
  useQuery({
    queryKey: businessKeys.decisions(vault),
    queryFn: () => getDecisions(vault),
    refetchInterval: DECISIONS_REFRESH_MS,
  });
