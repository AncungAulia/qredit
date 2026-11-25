import { KpiTile } from "@/components/shared/KpiTile";
import { formatBps, formatCount, formatDate, formatFusd } from "@/lib/format";
import { lenderReturnBps } from "@/modules/business/lib/loanFacts";
import { KPI_GRID, type VaultSnapshot } from "@/modules/market";

/** Four figures of the loan (Kpis in the design). While raising they describe the raise; afterwards, the repayment. */
export function BusinessKpis({
  vault,
  delivered,
}: {
  vault: VaultSnapshot;
  /** Orders delivered, or why the count is not known yet. */
  delivered: number | "loading" | "unavailable";
}) {
  const fusd = (n: bigint) => formatFusd(n, { unit: false });
  if (vault.state === "Raising") {
    return (
      <div className={KPI_GRID}>
        <KpiTile
          variant="feature"
          label="Raised so far"
          value={fusd(vault.raised)}
          unit="fUSD"
          className="col-span-2 md:col-span-1"
        />
        <KpiTile variant="soft" label="Target" value={fusd(vault.target)} unit="fUSD" />
        <KpiTile
          variant="soft"
          label="Lender return"
          value={formatBps(lenderReturnBps(vault.target, vault.totalOwed))}
        />
        <KpiTile
          variant="soft"
          label="Raise closes"
          value={formatDate(vault.raiseDeadline)}
          className="col-span-2 md:col-span-1"
        />
      </div>
    );
  }
  return (
    <div className={KPI_GRID}>
      <KpiTile
        variant="feature"
        label="Total owed to lenders"
        value={fusd(vault.totalOwed)}
        unit="fUSD"
        className="col-span-2 md:col-span-1"
      />
      <KpiTile variant="soft" label="Repaid so far" value={fusd(vault.repaid)} unit="fUSD" />
      <KpiTile
        variant="soft"
        label="Lender share"
        value={formatBps(vault.lenderBps)}
        unit="of every sale"
      />
      <KpiTile
        variant="soft"
        label="Orders delivered"
        value={
          typeof delivered === "number"
            ? formatCount(delivered)
            : delivered === "loading"
              ? "Loading"
              : "Unavailable"
        }
        className="col-span-2 md:col-span-1"
      />
    </div>
  );
}
