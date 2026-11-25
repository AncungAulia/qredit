"use client";

import { useState } from "react";
import { ChainAction } from "@/components/shared/ChainAction";
import { Button } from "@/components/ui/button";
import { formatFusd } from "@/lib/format";
import type { Position } from "@/modules/lend/api/lend.api";
import { useLendActions } from "@/modules/lend/api/useLend";

/** Claim what the repayments have earned so far. Asks first, then sends the claim from the test wallet. */
export function ClaimButton({ position, className }: { position: Position; className?: string }) {
  const [open, setOpen] = useState(false);
  const actions = useLendActions();
  const amount = formatFusd(position.claimable);
  const name = position.business.name;
  return (
    <>
      <Button type="button" size="sm" className={className} onClick={() => setOpen(true)} aria-label={`Claim ${amount}`}>
        Claim
      </Button>
      <ChainAction
        open={open}
        onOpenChange={setOpen}
        title={`Claim ${amount}`}
        body={`The repayments of ${name} that have arrived will be paid to your wallet. Nothing else moves.`}
        confirmLabel={`Claim ${amount}`}
        pendingLabel={`Claiming ${amount}`}
        successTitle={`Claimed ${amount} from ${name}`}
        run={() => actions.claim(position.business.vault)}
      />
    </>
  );
}
