"use client";

import Link from "next/link";
import { Clock, Hourglass, Mail, MailX, Undo2, type LucideIcon } from "lucide-react";
import { OrderStatusBadge } from "@/components/shared/OrderStatusBadge";
import { Button } from "@/components/ui/button";
import { useNow } from "@/hooks/useNow";
import { formatFusd, formatRelative } from "@/lib/format";
import { serviceName } from "@/lib/serviceName";
import { cn, focusRing } from "@/lib/utils";
import type { InboxOrder } from "@/modules/inbox/api/inbox.api";
import { ReclaimButton } from "@/modules/inbox/components/ReclaimButton";
import { isLate } from "@/modules/inbox/lib/inboxOrders";

// Order, business, status, price, action: the columns of Table/Inbox in the design.
const COLUMNS = "md:grid-cols-[minmax(0,1fr)_150px_200px_90px_130px] xl:grid-cols-[minmax(0,1fr)_190px_200px_100px_150px]";

const ICONS: Record<InboxOrder["status"], LucideIcon> = {
  delivered: Mail,
  open: Hourglass,
  claimed: Hourglass,
  declined: MailX,
  reclaimed: Undo2,
};

const reportHref = (o: InboxOrder) => `/inbox/${o.vault}/${o.orderId}`;

function Status({ order, late }: { order: InboxOrder; late: boolean }) {
  if (!late) return <OrderStatusBadge status={order.status} />;
  return (
    <span className="inline-flex items-center rounded-full bg-warning-soft px-2.5 py-1.5 text-[13px] leading-none font-medium text-warning">
      Late, reclaim available
    </span>
  );
}

function Action({ order, late, canSend }: { order: InboxOrder; late: boolean; canSend: boolean }) {
  if (order.status === "delivered") {
    return (
      <Button size="sm" variant="secondary" className="max-md:h-11 max-md:w-full" render={<Link href={reportHref(order)} />} nativeButton={false} role="link">
        Open report
      </Button>
    );
  }
  if (late && canSend) {
    return <ReclaimButton order={order} business={order.business} className="max-md:h-11 max-md:w-full" />;
  }
  return null;
}

/**
 * The orders of the buyer. On a phone each is a card (Card/InboxOrder); from tablet up the same elements sit in
 * columns (Table/Inbox). `times` holds the time of each order's block; an order without one shows no time.
 */
export function InboxList({ orders, times, canSend }: { orders: InboxOrder[]; times: Record<number, Date> | undefined; canSend: boolean }) {
  const now = useNow();
  return (
    <div className="flex flex-col gap-3 md:gap-0.5 md:rounded-3xl md:bg-surface md:p-3">
      <div aria-hidden className={cn("hidden gap-x-4 px-4 pt-1 pb-2 text-xs font-medium text-text-tertiary md:grid", COLUMNS)}>
        <span>Order</span>
        <span>Business</span>
        <span>Status</span>
        <span className="text-right">Price</span>
        <span />
      </div>
      <ul className="contents">
        {orders.map((o) => {
          const late = isLate(o, now);
          const Icon = late ? Clock : ICONS[o.status];
          const placed = times?.[o.placedBlock];
          return (
            <li
              key={`${o.vault}-${o.orderId}`}
              className={cn(
                "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3.5 rounded-3xl bg-surface p-5 transition-colors duration-[120ms] md:rounded-xl md:bg-transparent md:px-4 md:py-3.5 md:hover:bg-surface-hover",
                COLUMNS,
              )}
            >
              <div className="flex min-w-0 items-center gap-3 max-md:order-1">
                <span
                  className={cn(
                    "grid size-10 shrink-0 place-items-center rounded-xl md:size-9 md:rounded-[10px]",
                    late ? "bg-warning-soft text-warning" : o.status === "delivered" ? "bg-accent-soft text-accent-strong" : "bg-surface-muted text-text-tertiary",
                  )}
                >
                  <Icon className="size-4" aria-hidden />
                </span>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <Link href={reportHref(o)} className={cn("w-fit max-w-full truncate rounded-sm text-[15px] font-medium text-text-primary hover:underline", focusRing)}>
                    {serviceName(o.business, o.serviceId)}
                  </Link>
                  <span className="truncate text-[13px] text-text-tertiary">
                    Order {o.orderId}
                    {placed ? `, ${formatRelative(placed, now)}` : ""}
                  </span>
                </div>
              </div>
              <span className="text-[15px] text-text-primary tabular-nums max-md:order-2 md:col-start-4 md:row-start-1 md:text-right">
                {formatFusd(o.price)}
              </span>
              <span className="truncate text-sm text-text-secondary max-md:order-3 md:col-start-2 md:row-start-1">{o.business.name}</span>
              <span className="justify-self-end max-md:order-3 md:col-start-3 md:row-start-1 md:justify-self-start">
                <Status order={o} late={late} />
              </span>
              <div className="col-span-2 max-md:order-4 empty:hidden md:col-span-1 md:col-start-5 md:row-start-1 md:justify-self-end">
                <Action order={o} late={late} canSend={canSend} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
