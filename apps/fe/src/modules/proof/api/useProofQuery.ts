import { useQueries, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { Business } from "@/lib/schemas";
import { readFactoryCodeHash, readFactoryVaults, runChecks } from "@/modules/proof/api/proof.api";
import { proofKeys } from "@/modules/proof/api/proof.keys";

// The factory build never changes, so it is read once and kept for good; the vault list is read once a minute for all businesses.
const proofQueryOptions = (client: QueryClient, business: Business) => ({
  queryKey: proofKeys.business(business.slug),
  queryFn: () =>
    runChecks(business, {
      codeHash: () =>
        client.fetchQuery({
          queryKey: proofKeys.factoryCodeHash,
          queryFn: readFactoryCodeHash,
          staleTime: Infinity,
        }),
      vaults: () =>
        client.fetchQuery({
          queryKey: proofKeys.factoryVaults,
          queryFn: readFactoryVaults,
          staleTime: 60_000,
        }),
    }),
  staleTime: 60_000,
});

/** The six checks of one business. The Proof page and the proof card share the query key, so a result is never fetched twice. */
export function useProofQuery(business: Business) {
  const client = useQueryClient();
  return useQuery(proofQueryOptions(client, business));
}

/** The checks of every business, in the order given. */
export function useProofQueries(businesses: Business[]) {
  const client = useQueryClient();
  return useQueries({ queries: businesses.map((b) => proofQueryOptions(client, b)) });
}
