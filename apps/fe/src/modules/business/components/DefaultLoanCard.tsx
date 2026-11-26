"use client";

import { useState } from "react";
import { TriangleAlert } from "lucide-react";
import { ChainAction } from "@/components/shared/ChainAction";
import { Button } from "@/components/ui/button";
import { formatFusd } from "@/lib/format";
import type { Business } from "@/lib/schemas";
import { useDefaultAction, useDefaultBooksQuery, useDefaultDryRunQuery } from "@/modules/business/api/useBusinessPage";
import type { VaultSnapshot } from "@/modules/market";
import { ConnectPrompt } from "@/modules/wallet/components/ConnectPrompt";
import { testWalletOf } from "@/modules/wallet/signer";
import { useWallet } from "@/modules/wallet/WalletProvider";

/** The reason the vault accepts a default: past maturity plus grace, or behind by the missed-installment limit. */
export function defaultTitle(vault: Pick<VaultSnapshot, "maturityAt" | "maturityGrace" | "defaultAfterMissed">, now = Date.now()): string {
  const pastMaturity = vault.maturityAt && now > +vault.maturityAt + (vault.maturityGrace ?? 0) * 1000;
  if (pastMaturity || vault.defaultAfterMissed === undefined) return "The loan is past its maturity and grace";
  return `Repayments are ${vault.defaultAfterMissed} installments behind`;
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 text-[15px] text-text-secondary tabular-nums">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/**
 * Shown only when a dry run says the vault would accept `triggerDefault` now (spec section 6). Anyone may send it;
 * it ends the loan for good, so it is confirmed first.
 */
export function DefaultLoanCard({ business, vault, enabled = true }: { business: Business; vault: VaultSnapshot; enabled?: boolean }) {
  const dryRun = useDefaultDryRunQuery(business.vault, enabled);
  const run = useDefaultAction(business.vault);
  const [open, setOpen] = useState(false);
  const books = useDefaultBooksQuery(business.vault, open);
  const wallet = useWallet((s) => testWalletOf(s.session));
  if (!dryRun.data?.ok) return null;
  const bond = formatFusd(vault.bondHeld);
  const b = books.data;
  return (
    <section aria-labelledby="default-loan" className="flex flex-col gap-4 rounded-3xl bg-warning-soft p-5 md:flex-row md:items-center md:justify-between md:p-6">
      <div className="flex min-w-0 gap-3">
        <TriangleAlert className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
        <div className="flex flex-col gap-1">
          <h2 id="default-loan" className="text-lg font-medium text-text-primary">
            {defaultTitle(vault)}
          </h2>
          <p className="text-sm leading-normal text-text-secondary">
            {`Anyone can now default this loan. Selling stops, and the vault's cash, the owner's unclaimed share and the ${bond} bond go to lenders. It cannot be undone.`}
          </p>
        </div>
      </div>
      {wallet ? (
        <Button type="button" size="lg" variant="destructive" className="h-11 px-5 max-md:w-full" onClick={() => setOpen(true)}>
          Default this loan
        </Button>
      ) : (
        <ConnectPrompt size="lg" className="h-11 max-md:w-full" />
      )}
      <ChainAction
        open={open}
        onOpenChange={setOpen}
        title="Default this loan?"
        body="The dry run passed. Selling and supplier payments stop for good, and what the vault holds goes to its lenders. You only pay the network fee."
        confirmLabel="Default the loan"
        cancelLabel="Cancel"
        destructive
        pendingLabel="Ending the loan"
        successTitle={`The loan of ${business.name} is defaulted`}
        successText="Lenders can now claim what the loan moved to them."
        nextStep={{ text: "Check the business page before trying again.", label: "Open the business", href: `/agents/${business.slug}` }}
        run={run}
        summary={
          <dl className="flex flex-col gap-2 rounded-lg bg-surface-hover p-4">
            <Line label="Operating cash" value={b ? formatFusd(b.opex) : "Loading"} />
            <Line label="Owner's unclaimed share" value={b ? formatFusd(b.ownerOwed) : "Loading"} />
            <Line label="Owner bond" value={b ? formatFusd(b.bond) : bond} />
          </dl>
        }
      />
    </section>
  );
}
