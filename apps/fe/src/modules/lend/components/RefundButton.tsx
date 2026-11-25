"use client";

import { useState } from "react";
import { ChainAction } from "@/components/shared/ChainAction";
import { Button } from "@/components/ui/button";
import { formatFusd } from "@/lib/format";
import type { Position } from "@/modules/lend/api/lend.api";
import { useLendActions } from "@/modules/lend/api/useLend";

/** Take back the whole deposit of a raise that did not reach its target. Asks first, then sends the refund. */
export function RefundButton({ position, className }: { position: Position; className?: string }) {
  const [open, setOpen] = useState(false);
  const actions = useLendActions();
  const amount = formatFusd(position.deposit);
  const name = position.business.name;
  return (
    <>
      <Button type="button" size="sm" variant="secondary" className={className} onClick={() => setOpen(true)} aria-label={`Refund ${amount}`}>
        Refund
      </Button>
      <ChainAction
        open={open}
        onOpenChange={setOpen}
        title={`Refund ${amount}`}
        body={`The raise of ${name} did not reach its target. Your full deposit will be returned to your wallet.`}
        confirmLabel={`Refund ${amount}`}
        pendingLabel={`Refunding ${amount}`}
        successTitle={`Refunded ${amount} from ${name}`}
        successText="Your fUSD has been returned to your wallet."
        nextStep={{ text: "Check My lending before asking for a refund again.", label: "Open My lending", href: "/lend" }}
        run={() => actions.refund(position.business.vault)}
      />
    </>
  );
}
