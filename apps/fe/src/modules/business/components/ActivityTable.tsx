import { Address } from "@/components/shared/Address";
import { OrderStatusBadge } from "@/components/shared/OrderStatusBadge";
import { EmptyState, ErrorState } from "@/components/shared/PageStates";
import { TxLink } from "@/components/shared/TxLink";
import { Skeleton } from "@/components/ui/skeleton";
import { formatFusd } from "@/lib/format";
import type { Business, Order } from "@/lib/schemas";

const SHOWN = 25;
// Column widths of the Table/Orders rows; the business column of the design is the buyer here.
const COLUMNS =
  "md:grid-cols-[1fr_105px_135px_95px_125px] xl:grid-cols-[1fr_105px_135px_90px_120px]";

/** One order. On a phone it stacks as in Row/Order/Stacked; from tablet up the same elements sit in columns. */
function OrderRow({ order, serviceName }: { order: Order; serviceName: string }) {
  const place = "md:row-span-2 md:row-start-1";
  return (
    <div
      className={`grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5 py-3 transition-colors duration-[120ms] md:gap-y-0.5 md:rounded-xl md:px-4 md:py-3.5 md:hover:bg-surface-hover ${COLUMNS}`}
    >
      <span className="min-w-0 text-[15px] font-medium text-text-primary md:col-start-1 md:row-start-1">
        {serviceName}
      </span>
      <span
        className={`text-[15px] font-medium text-text-primary tabular-nums md:col-start-4 md:text-right ${place}`}
      >
        {formatFusd(order.price)}
      </span>
      <span className={`col-span-2 justify-self-start md:col-span-1 md:col-start-3 ${place}`}>
        <Address value={order.buyer} />
      </span>
      <span className={`justify-self-start md:col-start-5 md:justify-self-end ${place}`}>
        <TxLink hash={order.placedTx} compact />
      </span>
      <span className={`justify-self-end md:col-start-2 md:justify-self-start ${place}`}>
        <OrderStatusBadge status={order.status} />
      </span>
    </div>
  );
}

type Props = {
  business: Business;
  orders: Order[] | undefined;
  isError: boolean;
  onRetry: () => void;
};

/** The orders placed with this business, newest first. */
export function ActivityTable({ business, orders, isError, onRetry }: Props) {
  if (isError && !orders) {
    return (
      <ErrorState layout="section" title="The orders could not be loaded." onRetry={onRetry} />
    );
  }
  if (!orders) {
    return (
      <div
        role="status"
        aria-busy="true"
        className="flex flex-col gap-1 rounded-3xl bg-surface px-6 py-2 md:p-3"
      >
        <span className="sr-only">Loading</span>
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-11 w-full rounded-xl" />
        ))}
      </div>
    );
  }
  if (orders.length === 0) {
    return <EmptyState layout="section" art="reports" title="No orders have been placed yet." />;
  }
  const newest = [...orders].sort((a, b) => b.placedBlock - a.placedBlock).slice(0, SHOWN);
  return (
    <div className="flex animate-in flex-col gap-3 duration-200 fade-in">
      <div className="flex flex-col gap-0.5 rounded-3xl bg-surface px-6 py-2 md:p-3">
        <div
          className={`hidden gap-x-4 px-4 pt-1 pb-2 text-xs font-medium text-text-tertiary md:grid ${COLUMNS}`}
        >
          <span>Order</span>
          <span>Status</span>
          <span>Buyer</span>
          <span className="text-right">Price</span>
          <span className="text-right">Transaction</span>
        </div>
        {newest.map((o) => (
          <OrderRow
            key={o.placedTx}
            order={o}
            serviceName={
              business.services.find((s) => s.id === o.serviceId)?.name ?? `Service ${o.serviceId}`
            }
          />
        ))}
      </div>
      {orders.length > SHOWN && (
        <p className="text-sm text-text-tertiary">Showing the newest {SHOWN} orders.</p>
      )}
    </div>
  );
}
