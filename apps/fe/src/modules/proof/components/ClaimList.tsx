"use client";

import { BusinessMark } from "@/components/shared/BusinessMark";
import { KpiTile } from "@/components/shared/KpiTile";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/shared/PageStates";
import { formatCount } from "@/lib/format";
import type { Business } from "@/lib/schemas";
import { useMarketQuery } from "@/modules/market";
import { useProofQueries } from "@/modules/proof/api/useProofQuery";
import { CHECK_IDS, provenCount, UNKNOWN_DETAIL, type CheckResult } from "@/modules/proof/checks";
import { CheckRow } from "@/modules/proof/components/CheckRow";
import { ProvenCount } from "@/modules/proof/components/ProvenCount";

type Query = { data?: CheckResult[]; isError: boolean };

/** The checks to show for one query. A query that failed outright (it should not happen) shows every check as not proven. */
export function resultsOf(q: Query): CheckResult[] | undefined {
  if (q.data) return q.data;
  return q.isError
    ? CHECK_IDS.map((id) => ({ id, status: "unknown" as const, detail: UNKNOWN_DETAIL }))
    : undefined;
}

function BusinessClaims({ business, results }: { business: Business; results?: CheckResult[] }) {
  return (
    <section
      aria-labelledby={`claims-${business.slug}`}
      className="flex flex-col gap-1 rounded-3xl bg-surface p-5 md:p-6"
    >
      <div className="flex items-center gap-3 pb-2">
        <BusinessMark slug={business.slug} size={40} />
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 id={`claims-${business.slug}`} className="text-base font-medium text-text-primary">
            {business.name}
          </h2>
          <p className="truncate text-[13px] text-text-secondary">{business.tagline}</p>
        </div>
        {results && <ProvenCount results={results} />}
      </div>
      {results ? (
        <ul className="animate-in duration-200 fade-in">
          {results.map((r) => (
            <CheckRow key={r.id} result={r} />
          ))}
        </ul>
      ) : (
        <ListSkeleton rows={CHECK_IDS.length} rowClassName="h-14 rounded-2xl" />
      )}
    </section>
  );
}

function Claims({ businesses }: { businesses: Business[] }) {
  const queries = useProofQueries(businesses);
  const all = queries.map(resultsOf);
  const settled = all.every((r) => r !== undefined);
  const proven = all.reduce((n, r) => n + (r ? provenCount(r) : 0), 0);
  const total = all.reduce((n, r) => n + (r ? r.length : 0), 0);

  return (
    <div className="flex animate-in flex-col gap-4 duration-200 fade-in md:gap-6">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4">
        {settled ? (
          <KpiTile
            variant="feature"
            label="Claims proven"
            value={formatCount(proven)}
            unit={`of ${formatCount(total)}`}
          />
        ) : (
          <KpiTile variant="feature" label="Claims proven" value="Checking" />
        )}
        <KpiTile variant="soft" label="Businesses checked" value={formatCount(businesses.length)} />
      </div>
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
        {businesses.map((b, i) => (
          <BusinessClaims key={b.slug} business={b} results={all[i]} />
        ))}
      </div>
    </div>
  );
}

/** Every business with its six live checks. The business list is the Market query, so both pages share one load. */
export function ClaimList() {
  const market = useMarketQuery();
  const rows = market.data;

  if (market.isError && !rows) {
    return (
      <ErrorState
        onRetry={() => market.refetch()}
        title="The businesses could not be loaded."
        message="The service did not respond. Please try again shortly."
      />
    );
  }
  if (!rows) return <ListSkeleton rows={4} rowClassName="h-72" />;
  if (rows.length === 0) return <EmptyState art="search" title="No businesses are listed yet." />;
  return <Claims businesses={rows.map((r) => r.business)} />;
}
