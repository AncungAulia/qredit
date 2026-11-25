import { EmptyState, ErrorState } from "@/components/shared/PageStates";
import { TxLink } from "@/components/shared/TxLink";
import { Skeleton } from "@/components/ui/skeleton";
import { formatFusd, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { LatestOrder } from "@/modules/market/api/market.api";
import { OrderStatusBadge } from "./OrderStatusBadge";

// Column widths of the Table/Orders rows in the design; narrower on tablet so the order column keeps room.
const COL = {
  business: "w-[150px] xl:w-[190px]",
  status: "w-[120px] xl:w-[140px]",
  price: "w-[100px] xl:w-[110px]",
  tx: "w-[130px] xl:w-[150px]",
};

function TableRow({ o }: { o: LatestOrder }) {
  return (
    <div className="hidden items-center gap-4 rounded-xl px-4 py-3.5 transition-colors duration-[120ms] hover:bg-surface-hover md:flex">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[15px] font-medium text-text-primary">{o.serviceName}</span>
        <span className="text-[13px] text-text-tertiary">{formatRelative(o.placedAt)}</span>
      </div>
      <span className={cn(COL.business, "text-sm text-text-secondary")}>{o.business.name}</span>
      <span className={COL.status}>
        <OrderStatusBadge status={o.order.status} />
      </span>
      <span
        className={cn(
          COL.price,
          "text-right text-[15px] font-medium text-text-primary tabular-nums",
        )}
      >
        {formatFusd(o.order.price)}
      </span>
      <span className={cn(COL.tx, "flex justify-end")}>
        <TxLink hash={o.order.placedTx} compact />
      </span>
    </div>
  );
}

// Row/Order/Stacked: title and price, business and time, then the transaction and the status.
function StackedRow({ o }: { o: LatestOrder }) {
  return (
    <div className="flex flex-col gap-1.5 py-3 md:hidden">
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1 text-[15px] font-medium text-text-primary">
          {o.serviceName}
        </span>
        <span className="text-[15px] font-medium text-text-primary tabular-nums">
          {formatFusd(o.order.price)}
        </span>
      </div>
      <span className="text-[13px] text-text-tertiary">
        {o.business.name}, {formatRelative(o.placedAt)}
      </span>
      <div className="flex items-center justify-between gap-1.5">
        <TxLink hash={o.order.placedTx} compact />
        <OrderStatusBadge status={o.order.status} />
      </div>
    </div>
  );
}

export function LatestOrdersSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      className="flex flex-col gap-1 rounded-3xl bg-surface px-6 py-2"
    >
      <span className="sr-only">Loading</span>
      {Array.from({ length: 4 }, (_, i) => (
        <Skeleton key={i} className="h-11 w-full rounded-xl bg-surface-muted" />
      ))}
    </div>
  );
}

type Props = {
  orders: LatestOrder[] | undefined;
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
  /** True when no business has any order. */
  none: boolean;
};

/** The newest orders across all businesses (Latest orders in the design). */
export function LatestOrders({ orders, isPending, isError, onRetry, none }: Props) {
  let body;
  if (none) {
    body = <EmptyState layout="section" art="reports" title="No orders have been placed yet." />;
  } else if (isError) {
    body = (
      <ErrorState
        layout="section"
        title="The latest orders could not be loaded."
        onRetry={onRetry}
      />
    );
  } else if (isPending || !orders) {
    body = <LatestOrdersSkeleton />;
  } else {
    body = (
      <div className="flex animate-in flex-col gap-0.5 rounded-3xl bg-surface px-6 py-2 duration-200 fade-in md:p-3">
        <div className="hidden gap-4 px-4 pt-1 pb-2 text-xs font-medium text-text-tertiary md:flex">
          <span className="flex-1">Order</span>
          <span className={COL.business}>Business</span>
          <span className={COL.status}>Status</span>
          <span className={cn(COL.price, "text-right")}>Price</span>
          <span className={cn(COL.tx, "text-right")}>Transaction</span>
        </div>
        {orders.map((o) => (
          <div key={o.order.placedTx}>
            <TableRow o={o} />
            <StackedRow o={o} />
          </div>
        ))}
      </div>
    );
  }
  return (
    <section aria-labelledby="latest-orders" className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-1">
        <h2 id="latest-orders" className="text-xl font-medium text-text-primary">
          Latest orders
        </h2>
        <p className="text-sm text-text-secondary">The most recent orders across all businesses.</p>
      </div>
      {body}
    </section>
  );
}
