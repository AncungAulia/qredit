import { LoanBar } from "@/components/shared/LoanBar";
import { BOND_BPS } from "@qredit/qore/abi";
import { formatBps, formatDateTime, formatDuration, formatFusd } from "@/lib/format";
import { isEnded } from "@/lib/vaultState";
import type { Business } from "@/lib/schemas";
import { buyersTerm } from "@/modules/market/lib/trackRecord";
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
export function LoanTerms({ vault, stats }: { vault: VaultSnapshot; stats?: Business["stats"] }) {
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
        {vault.version === 2 && (
          <>
            <Term
              label="Owner bond"
              value={
                vault.bondHeld > 0n
                  ? `${formatFusd(vault.bondHeld)} held, ${formatBps(Number(BOND_BPS))} of the loan`
                  : isEnded(vault.state)
                    ? "Moved to lenders when the loan ended"
                    : "Returned to the owner"
              }
            />
            <Term label="Maturity" value={vault.maturityAt ? formatDateTime(vault.maturityAt) : "Counted from the moment the raise completes"} />
            {vault.defaultAfterMissed !== undefined && vault.maturityGrace !== undefined && (
              <Term
                label="Default"
                value={`After ${vault.defaultAfterMissed} missed installments or ${formatDuration(vault.maturityGrace)} past maturity`}
              />
            )}
            {stats && <Term label="Buyers" value={buyersTerm(stats)} />}
          </>
        )}
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
