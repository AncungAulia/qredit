import { Skeleton } from "@/components/ui/skeleton";
import { LatestOrdersSkeletonBody } from "@/modules/market/components/LatestOrders";
import { KPI_GRID } from "@/modules/market/components/MarketKpis";

/** State/Loading from the design: the shape of a business card, so nothing jumps when data arrives. */
function CardSkeleton() {
  return (
    <div className="flex h-[410px] flex-col gap-4 rounded-3xl bg-surface p-6 md:h-[300px]">
      <div className="flex items-center gap-3">
        <Skeleton className="size-11 rounded-xl" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3.5 w-full" />
        </div>
      </div>
      <Skeleton className="h-2 w-full" />
      <Skeleton className="h-10 w-full rounded-[10px]" />
      <Skeleton className="mt-auto h-9 w-20 rounded-full" />
    </div>
  );
}

/** The KPI row, the business grid and the latest orders while the first load is under way. One status region for all of it. */
export function MarketSkeleton() {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-6 md:gap-8 xl:gap-10">
      <span className="sr-only">Loading</span>
      <div className={KPI_GRID}>
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton
            key={i}
            className={`h-[118px] rounded-3xl bg-surface ${i === 0 || i === 3 ? "col-span-2 md:col-span-1" : ""}`}
          />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:gap-6">
        {Array.from({ length: 4 }, (_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
      <LatestOrdersSkeletonBody />
    </div>
  );
}
