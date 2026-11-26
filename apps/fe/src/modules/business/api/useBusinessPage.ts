import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { hasUnverifiedSuppliers } from "@/lib/supplierCheck";
import type { Business } from "@/lib/schemas";
import { businessKeys } from "@/modules/business/api/business.keys";
import {
  getDecisions,
  readCreationSuppliers,
  readDefaultBooks,
  readVaultRules,
  simulateTriggerDefault,
  triggerDefault,
} from "@/modules/business/api/business.api";
import { lendKeys } from "@/modules/lend/api/lend.keys";
import { marketKeys } from "@/modules/market";
import { useWallet } from "@/modules/wallet/WalletProvider";

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
    isRefetchError: suppliers.isRefetchError || rules.isRefetchError,
    refetch: () => (suppliers.isError ? suppliers.refetch() : rules.refetch()),
  };
}

export const useDecisionsQuery = (vault: `0x${string}`) =>
  useQuery({
    queryKey: businessKeys.decisions(vault),
    queryFn: () => getDecisions(vault),
    refetchInterval: DECISIONS_REFRESH_MS,
  });

/** True when a supplier the vault was created with is not in Qredit's list; undefined while unknown. */
export function useUnverifiedQuery(business: Business): boolean | undefined {
  const suppliers = useCreationSuppliersQuery(business);
  return suppliers.data ? hasUnverifiedSuppliers(suppliers.data) : undefined;
}

const DEFAULT_CHECK_MS = 30_000;

/** Whether the vault would accept a default now, checked by a dry run; only for a running loan. */
export const useDefaultDryRunQuery = (vault: `0x${string}`, enabled: boolean) =>
  useQuery({ queryKey: businessKeys.defaultable(vault), queryFn: () => simulateTriggerDefault(vault), enabled, refetchInterval: DEFAULT_CHECK_MS });

/** The books the default dialog lists; read only while the dialog needs them. */
export const useDefaultBooksQuery = (vault: `0x${string}`, enabled: boolean) =>
  useQuery({ queryKey: businessKeys.books(vault), queryFn: () => readDefaultBooks(vault), enabled });

/** Sends the default from the test wallet, then reads the business, the market and lending again. */
export function useDefaultAction(vault: `0x${string}`) {
  const session = useWallet((s) => s.session);
  const client = useQueryClient();
  return useCallback(async () => {
    const hash = await triggerDefault(session, vault);
    void client.invalidateQueries({ queryKey: ["business"] });
    void client.invalidateQueries({ queryKey: marketKeys.all });
    void client.invalidateQueries({ queryKey: lendKeys.all });
    return hash;
  }, [session, client, vault]);
}
