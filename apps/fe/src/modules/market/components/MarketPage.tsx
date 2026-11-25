"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { EmptyState, ErrorState } from "@/components/shared/PageStates";
import { Button } from "@/components/ui/button";
import { isFailed, isLoaded } from "@/modules/market/api/market.api";
import { useLatestOrdersQuery, useMarketQuery } from "@/modules/market/api/useMarketQuery";
import { applyMarketFilter, parseMarketFilter } from "@/modules/market/lib/marketFilter";
import { BusinessGrid } from "./BusinessGrid";
import { LatestOrders } from "./LatestOrders";
import { MarketFilter } from "./MarketFilter";
import { MarketKpis } from "./MarketKpis";
import { MarketSkeleton } from "./MarketSkeleton";

function PageHead({ filter }: { filter: ReturnType<typeof parseMarketFilter> | null }) {
  return (
    <div className="flex flex-col gap-3.5 md:flex-row md:items-start md:justify-between md:gap-8">
      <div className="flex flex-1 flex-col gap-1.5">
        <h1 className="text-[28px] font-medium tracking-[-0.8px] text-text-primary md:text-[30px] md:tracking-[-1px] xl:text-[32px]">
          Market
        </h1>
        <p className="text-sm leading-normal text-text-secondary md:text-[15px]">
          AI agent businesses on QoreChain. Lend to one that is raising, or buy a sealed report from
          one that is trading.
        </p>
      </div>
      {filter && <MarketFilter active={filter.key} />}
    </div>
  );
}

function MarketContent() {
  const filter = parseMarketFilter(useSearchParams().get("state"));
  const market = useMarketQuery();
  const latest = useLatestOrdersQuery(market.data);
  const rows = market.data;

  let body;
  // The full-page error shows only when there is nothing to show; a failed refresh keeps the last data.
  if (market.isError && !rows) {
    body = (
      <ErrorState
        onRetry={() => market.refetch()}
        title="The market could not be loaded."
        message="The service did not respond. Please try again shortly."
      />
    );
  } else if (!rows) {
    body = <MarketSkeleton />;
  } else if (rows.length === 0) {
    body = <EmptyState art="search" title="No businesses are listed yet." />;
  } else {
    const shown = applyMarketFilter(rows, filter);
    const failed = rows.filter(isFailed).length;
    body = (
      <div className="flex animate-in flex-col gap-6 duration-200 fade-in md:gap-8 xl:gap-10">
        <MarketKpis entries={rows.filter(isLoaded)} skipped={failed} />
        {shown.length === 0 ? (
          <EmptyState
            layout="section"
            art="search"
            title={`No business matches ${filter.label}.`}
            message="Clear the filter to view all businesses."
            action={
              <Button variant="secondary" size="sm" render={<Link href="/" scroll={false} />}>
                Clear the filter
              </Button>
            }
          />
        ) : (
          <BusinessGrid rows={shown} onRetry={() => market.refetch()} />
        )}
        <LatestOrders
          orders={latest.orders}
          isPending={latest.isPending}
          isError={latest.isError}
          onRetry={latest.refetch}
          isEmpty={latest.isEmpty}
          incomplete={failed > 0}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-6 md:gap-8 xl:gap-10">
      <PageHead filter={market.isError && !rows ? null : filter} />
      {body}
    </div>
  );
}

/** The Market page: title and filter, KPI row, business cards and latest orders, read live. */
export function MarketPage() {
  return (
    <Suspense fallback={<PageHead filter={null} />}>
      <MarketContent />
    </Suspense>
  );
}
