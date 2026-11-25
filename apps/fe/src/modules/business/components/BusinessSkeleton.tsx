import { Skeleton } from "@/components/ui/skeleton";
import { KPI_GRID } from "@/modules/market";

/** State/Loading from the design: the shape of every block, so nothing jumps when data arrives. */
export function BusinessSkeleton() {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-6 md:gap-8">
      <span className="sr-only">Loading</span>
      <div className="flex items-center gap-3 md:gap-5">
        <Skeleton className="size-11 shrink-0 rounded-xl md:size-16 md:rounded-2xl" />
        <div className="flex flex-1 flex-col gap-2.5">
          <Skeleton className="h-8 w-56 max-w-full rounded-lg md:w-80" />
          <Skeleton className="h-3.5 w-full max-w-md rounded-lg" />
        </div>
      </div>
      <div className={KPI_GRID}>
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton
            key={i}
            className={`h-[118px] rounded-3xl ${i === 0 || i === 3 ? "col-span-2 md:col-span-1" : ""}`}
          />
        ))}
      </div>
      <div className="flex flex-col gap-8 xl:grid xl:grid-cols-[1fr_400px] xl:gap-x-6">
        <div className="flex flex-col gap-8">
          <Skeleton className="h-64 rounded-3xl" />
          <Skeleton className="h-72 rounded-3xl" />
        </div>
        <div className="flex flex-col gap-8">
          <Skeleton className="h-64 rounded-3xl" />
          <Skeleton className="h-28 rounded-3xl" />
        </div>
      </div>
    </div>
  );
}
