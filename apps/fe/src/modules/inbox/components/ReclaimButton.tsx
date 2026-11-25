"use client";

import { useState } from "react";
import { ChainAction } from "@/components/shared/ChainAction";
import { Button } from "@/components/ui/button";
import { formatFusd } from "@/lib/format";
import type { Business, Order } from "@/lib/schemas";
import { useInboxActions } from "@/modules/inbox/api/useInbox";

type Props = {
  order: Pick<Order, "vault" | "orderId" | "price">;
  business: Pick<Business, "name">;
  /** Add the amount to the label, as the phone card of the design does. */
  withAmount?: boolean;
  size?: "sm" | "lg";
  className?: string;
};

/** Takes back the price of a late open order. Asks first, then sends the reclaim from the test wallet. */
export function ReclaimButton({ order, business, withAmount = false, size = "sm", className }: Props) {
  const [open, setOpen] = useState(false);
  const actions = useInboxActions();
  const amount = formatFusd(order.price);
  return (
    <>
      <Button type="button" size={size} variant="secondary" className={className} onClick={() => setOpen(true)}>
        {withAmount ? `Reclaim ${amount}` : "Reclaim"}
      </Button>
      <ChainAction
        open={open}
        onOpenChange={setOpen}
        title={`Reclaim ${amount}`}
        body={`${business.name} did not deliver order ${order.orderId} before its deadline. The ${amount} you paid will be returned to your wallet.`}
        confirmLabel={`Reclaim ${amount}`}
        pendingLabel={`Reclaiming ${amount}`}
        successTitle={`Reclaimed ${amount} from ${business.name}`}
        successText="The amount you paid has been returned to your wallet."
        nextStep={{ text: "Check your inbox before reclaiming again.", label: "Open the inbox", href: "/inbox" }}
        run={() => actions.reclaim(order.vault, order.orderId)}
      />
    </>
  );
}
