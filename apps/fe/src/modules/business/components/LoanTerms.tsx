import { LoanBar } from "@/components/shared/LoanBar";
import { formatBps, formatDateTime, formatFusd } from "@/lib/format";
import { everyPeriod, lenderReturnBps } from "@/modules/business/lib/loanFacts";
import type { VaultSnapshot } from "@/modules/market";

// Phone: label above value. From tablet up: label in a fixed column.
function Term({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 md:flex-row md:gap-4">
      <span className="text-sm text-text-secondary md:w-[200px] md:shrink-0">{label}</span>
      <span className="text-sm text-text-primary tabular-nums md:flex-1">{value}</span>
    </div>
  );
}

/** The loan card (LoanCard in the design): the ledger bar and the terms of the loan. */
export function LoanTerms({ vault }: { vault: VaultSnapshot }) {
  const raising = vault.state === "Raising";
  const bps = lenderReturnBps(vault.target, vault.totalOwed);
  return (
    <div className="flex flex-col gap-6 rounded-3xl bg-surface p-6">
      <LoanBar
        state={vault.state}
        raised={vault.raised}
        target={vault.target}
        repaid={vault.repaid}
        totalOwed={vault.totalOwed}
      />
      <div className="flex flex-col gap-3">
        <Term label="Raised" value={formatFusd(vault.raised)} />
        <Term
          label="Lender return"
          value={`${formatBps(bps)}, so ${formatFusd(vault.totalOwed)} ${raising ? "will be owed" : "is owed"}`}
        />
        <Term
          label="Repayment"
          value={`${formatFusd(vault.installment)}. ${everyPeriod(Number(vault.period))}.`}
        />
        {raising && (
          <>
            <Term label="Raise closes" value={formatDateTime(vault.raiseDeadline)} />
            <Term label="If the raise fails" value="Every lender can take a full refund" />
          </>
        )}
      </div>
    </div>
  );
}
