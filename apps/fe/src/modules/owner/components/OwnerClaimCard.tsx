"use client";

import { useState } from "react";
import { ChainAction } from "@/components/shared/ChainAction";
import { Button } from "@/components/ui/button";
import { isEnded } from "@/lib/vaultState";
import { formatFusd } from "@/lib/format";
import type { Business } from "@/lib/schemas";
import type { Rules } from "@/modules/owner/api/owner.api";
import { useOwnerActions } from "@/modules/owner/api/useOwner";

/** The owner share and the rule that releases it: one installment ahead of schedule, or once the loan is repaid. */
export function OwnerClaimCard({ business, rules, canSend }: { business: Business; rules: Rules; canSend: boolean }) {
  const [open, setOpen] = useState(false);
  const actions = useOwnerActions();
  const amount = formatFusd(rules.ownerPending);
  const rule = isEnded(rules.state)
    ? "The loan has ended. The unclaimed share went to lenders."
    : rules.claimAhead
    ? "The loan is one installment ahead of its schedule, so the share can be claimed now."
    : "The share can be claimed only while the loan is one installment ahead of its schedule, or once it is repaid. Until then it stays in the vault, and if the loan ends it goes to lenders.";
  return (
    <section aria-labelledby="owner-claim" className="flex flex-col gap-3 rounded-3xl bg-surface p-5 md:p-6">
      <h2 id="owner-claim" className="text-xl font-medium text-text-primary">
        Your share to claim
      </h2>
      <p className="text-[28px] font-medium tracking-[-0.8px] text-text-primary tabular-nums">{amount}</p>
      <p className="text-sm text-text-secondary">{rule}</p>
      {canSend && rules.claimAhead && rules.ownerPending > 0n && (
        <>
          <Button type="button" size="sm" className="w-fit" onClick={() => setOpen(true)}>
            Claim {amount}
          </Button>
          <ChainAction
            open={open}
            onOpenChange={setOpen}
            title={`Claim ${amount}`}
            body={`The owner share of ${business.name} will be paid to the payout address of the vault. Nothing else moves.`}
            confirmLabel={`Claim ${amount}`}
            pendingLabel={`Claiming ${amount}`}
            successTitle={`Claimed ${amount}`}
            successText="The owner share has been paid to the payout address."
            nextStep={{ text: "Check the owner console before claiming again.", label: "Open the owner console", href: "/owner" }}
            run={() => actions.claim(business.vault)}
          />
        </>
      )}
    </section>
  );
}
