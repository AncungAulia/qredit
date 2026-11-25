import { EmptyState, ErrorState } from "@/components/shared/PageStates";
import { TxLink } from "@/components/shared/TxLink";
import { Skeleton } from "@/components/ui/skeleton";
import { formatFusd, formatRelative } from "@/lib/format";
import type { LatestOrder } from "@/modules/market/api/market.api";
import { OrderStatusBadge } from "./OrderStatusBadge";

// Column widths of the Table/Orders rows in the design; narrower on tablet so the order column keeps room.
const COLUMNS =
  "md:grid-cols-[1fr_150px_120px_100px_130px] xl:grid-cols-[1fr_190px_140px_110px_150px]";
const CARD = "flex flex-col gap-0.5 rounded-3xl bg-surface px-6 py-2 md:p-3";

/**
 * One order, one structure. On a phone it stacks as in Row/Order/Stacked (title and price, business and
 * time, transaction and status); from tablet up the same elements sit in the table columns.
 */
function OrderRow({ o }: { o: LatestOrder }) {
  const place = "md:row-span-2 md:row-start-1";
  return (
    <div
      className={`grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5 py-3 transition-colors duration-[120ms] md:gap-y-0.5 md:rounded-xl md:px-4 md:py-3.5 md:hover:bg-surface-hover ${COLUMNS}`}
    >
      <span className="min-w-0 text-[15px] font-medium text-text-primary md:col-start-1 md:row-start-1">
        {o.serviceName}
      </span>
      <span
        className={`text-[15px] font-medium text-text-primary tabular-nums md:col-start-4 md:text-right ${place}`}
      >
        {formatFusd(o.order.price)}
      </span>
      <span className="col-span-2 text-[13px] text-text-tertiary md:contents">
        <span
          className={`md:col-start-2 md:self-center md:text-sm md:text-text-secondary ${place}`}
        >
          {o.business.name}
        </span>
        <span className="md:hidden">, </span>
        <span className="md:col-start-1 md:row-start-2">{formatRelative(o.placedAt)}</span>
      </span>
      <span className={`justify-self-start md:col-start-5 md:justify-self-end ${place}`}>
        <TxLink hash={o.order.placedTx} compact />
      </span>
      <span className={`justify-self-end md:col-start-3 md:justify-self-start ${place}`}>
        <OrderStatusBadge status={o.order.status} />
      </span>
    </div>
  );
}

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 4 }, (_, i) => (
        <Skeleton key={i} className="h-11 w-full rounded-xl" />
      ))}
    </>
  );
}

/** Rows without a status region, for use inside a page skeleton that already announces loading. */
export function LatestOrdersSkeletonBody() {
  return (
    <div className={`${CARD} gap-1`}>
      <SkeletonRows />
    </div>
  );
}

export function LatestOrdersSkeleton() {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">Loading</span>
      <LatestOrdersSkeletonBody />
    </div>
  );
}

type Props = {
  orders: LatestOrder[] | undefined;
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
  /** The loaded businesses have no orders. */
  isEmpty: boolean;
  /** Some businesses could not be loaded, so their orders are unknown. */
  incomplete: boolean;
};

/** The newest orders across all businesses (Latest orders in the design). */
export function LatestOrders({ orders, isPending, isError, onRetry, isEmpty, incomplete }: Props) {
  let body;
  if (isEmpty) {
    body = (
      <EmptyState
        layout="section"
        art="reports"
        title={
          incomplete
            ? "No orders are available from the businesses that loaded."
            : "No orders have been placed yet."
        }
      />
    );
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
      <div className={`${CARD} animate-in duration-200 fade-in`}>
        <div
          className={`hidden gap-x-4 px-4 pt-1 pb-2 text-xs font-medium text-text-tertiary md:grid ${COLUMNS}`}
        >
          <span>Order</span>
          <span>Business</span>
          <span>Status</span>
          <span className="text-right">Price</span>
          <span className="text-right">Transaction</span>
        </div>
        {orders.map((o) => (
          <OrderRow key={o.order.placedTx} o={o} />
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
