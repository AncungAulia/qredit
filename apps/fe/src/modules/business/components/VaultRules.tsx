import { Address } from "@/components/shared/Address";
import { formatDuration, formatFusd } from "@/lib/format";
import type { VaultRules as Rules } from "@/modules/business/api/business.api";
import { splitText } from "@/modules/business/lib/loanFacts";
import { supplierName } from "@/modules/business/lib/supplierNames";

function Rule({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[13px] text-text-tertiary">{label}</span>
      <span className="text-sm text-text-primary tabular-nums">{value}</span>
    </div>
  );
}

/** The spending rules read from the vault now: daily cap, split of each sale, order time limit and suppliers. */
export function VaultRules({ rules }: { rules: Rules }) {
  return (
    <div className="flex flex-col gap-5 rounded-3xl bg-surface p-6">
      <div className="flex flex-col gap-3.5">
        <Rule
          label="Daily spending cap"
          value={`${formatFusd(rules.dailyCap)}, of which ${formatFusd(rules.spentToday)} was spent today`}
        />
        <Rule label="Split of each sale" value={splitText(rules.lenderBps, rules.ownerBps)} />
        <Rule label="Order time limit" value={formatDuration(rules.orderTtlSeconds)} />
      </div>
      <div className="flex flex-col gap-2.5">
        <span className="text-[13px] text-text-tertiary">
          Suppliers set when the business was created
        </span>
        {rules.suppliers.length === 0 ? (
          <p className="text-sm text-text-secondary">No supplier was approved for this business.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {rules.suppliers.map((s) => (
              <li key={s.address} className="flex flex-col items-start gap-1.5">
                <span className="flex flex-wrap items-center gap-2">
                  <Address value={s.address} copyable />
                  {supplierName(s.address) && (
                    <span className="text-sm text-text-primary">{supplierName(s.address)}</span>
                  )}
                </span>
                <span className="text-[13px] text-text-secondary tabular-nums">
                  {s.allowed
                    ? `Up to ${formatFusd(s.perTxCap)} for each payment`
                    : "Removed by a signed order"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
