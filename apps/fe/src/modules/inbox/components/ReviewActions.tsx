"use client";

import { useState } from "react";
import { Hourglass } from "lucide-react";
import { ChainAction } from "@/components/shared/ChainAction";
import { Notice } from "@/components/shared/Notice";
import { Button } from "@/components/ui/button";
import { formatFusd, formatTimeLeft } from "@/lib/format";
import type { Business, Order } from "@/lib/schemas";
import { cn } from "@/lib/utils";
import { useInboxActions, useRejectRefundQuery } from "@/modules/inbox/api/useInbox";

type Props = {
  order: Pick<Order, "vault" | "orderId" | "price"> & { reviewEnds: Date };
  business: Pick<Business, "name">;
  /** The current time in milliseconds, from the page's ticking clock. */
  now: number;
};

const NEXT = { text: "Check your inbox before trying again.", label: "Open the inbox", href: "/inbox" };

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn("flex items-center justify-between gap-4 text-[15px] tabular-nums", strong ? "font-medium text-text-primary" : "text-text-secondary")}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/**
 * The sticky review bar of a delivered v2 report (glass pill from tablet up, glass card on a phone) with Accept and
 * Reject. Both ask first through ChainAction; Reject shows the refund read from the vault before anything is sent.
 */
export function ReviewActions({ order, business, now }: Props) {
  const [open, setOpen] = useState<"accept" | "reject" | null>(null);
  // The refund shown in the Reject dialog is the one read when it opened, so a refetch cannot change it under the buyer.
  const [frozen, setFrozen] = useState<bigint | null>(null);
  const actions = useInboxActions();
  const refund = useRejectRefundQuery(order.vault, order.orderId, order.price, true);
  const live = refund.data;
  const back = open === "reject" && frozen !== null ? frozen : live;
  const price = formatFusd(order.price);
  const kept = back === undefined ? null : formatFusd(order.price - back);
  const ended = now > +order.reviewEnds;
  const toggle = (which: "accept" | "reject") => (next: boolean) => setOpen(next ? which : null);
  return (
    <>
      <section
        aria-label="Review this report"
        className="fixed inset-x-4 bottom-4 z-30 mx-auto flex max-w-[960px] flex-col gap-3 rounded-3xl bg-glass-strong p-4 shadow-[0_12px_40px_var(--shadow)] ring-1 ring-glass-edge backdrop-blur-xl md:flex-row md:items-center md:gap-4 md:rounded-full md:py-3 md:pr-3 md:pl-4"
      >
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent-soft text-accent-strong">
            <Hourglass className="size-[18px]" aria-hidden />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-[15px] font-medium text-text-primary tabular-nums">{`Review this report · ${formatTimeLeft(order.reviewEnds, now)}`}</p>
            <p className="text-[13px] leading-snug text-text-secondary">
              {back === undefined || kept === null ? (
                "Rejecting refunds the price less what the business already paid its suppliers. Silence counts as accepted."
              ) : (
                <>
                  <span className="max-md:hidden">{`Rejecting refunds ${formatFusd(back)}. The ${kept} paid to suppliers stays with the business. Silence counts as accepted.`}</span>
                  <span className="md:hidden">{`Rejecting refunds ${formatFusd(back)}; ${kept} paid to suppliers stays.`}</span>
                </>
              )}
            </p>
          </div>
        </div>
        <div className="flex gap-2 max-md:[&>button]:flex-1">
          <Button type="button" size="lg" variant="secondary" className="h-11" onClick={() => {
              setFrozen(live ?? null);
              setOpen("reject");
            }}
            disabled={live === undefined || ended}>
            Reject
          </Button>
          <Button type="button" size="lg" className="h-11" onClick={() => setOpen("accept")} disabled={ended}>
            Accept report
          </Button>
        </div>
      </section>
      {refund.isError && <Notice tone="danger">The refund could not be read, so rejecting is not offered right now. Nothing was sent. Please try again shortly.</Notice>}
      <ChainAction
        open={open === "accept"}
        onOpenChange={toggle("accept")}
        title={`Accept the report of order ${order.orderId}`}
        body={`The ${price} you paid is released to ${business.name}, and lenders are repaid first. This cannot be undone.`}
        confirmLabel="Accept report"
        cancelLabel="Keep reviewing"
        pendingLabel="Accepting the report"
        successTitle="Report accepted"
        successText={`${business.name} has been paid for this report.`}
        nextStep={NEXT}
        run={() => actions.accept(order.vault, order.orderId)}
      />
      {back !== undefined && kept !== null && (
        <ChainAction
          open={open === "reject"}
          onOpenChange={toggle("reject")}
          title="Reject this report?"
          body={`You get ${formatFusd(back)} back. The business keeps the ${kept} it already paid its suppliers for this order. This cannot be undone.`}
          confirmLabel="Reject and refund"
          cancelLabel="Keep the report"
          destructive
          pendingLabel="Rejecting the report"
          successTitle={`Rejected, ${formatFusd(back)} returned`}
          successText="The refund has been paid to your wallet."
          nextStep={NEXT}
          summary={
            <dl className="flex flex-col gap-2 rounded-2xl bg-surface-muted p-4">
              <Line label="You paid" value={price} />
              <Line label="Kept for supplier costs" value={kept} />
              <Line label="Refund to you" value={formatFusd(back)} strong />
            </dl>
          }
          run={() => actions.reject(order.vault, order.orderId)}
        />
      )}
    </>
  );
}
