import { BusinessMark } from "@/components/shared/BusinessMark";
import { StateBadge } from "@/components/shared/StateBadge";
import { formatFusd } from "@/lib/format";
import { isEnded } from "@/lib/vaultState";
import type { Position } from "@/modules/lend/api/lend.api";
import { ClaimButton } from "@/modules/lend/components/ClaimButton";
import { RefundButton } from "@/modules/lend/components/RefundButton";

// Business, status, lent, repaid, claimable, action: the columns of Table/Positions in the design.
const COLUMNS = "md:grid-cols-[minmax(0,1fr)_120px_110px_120px_110px_100px] xl:grid-cols-[minmax(0,1fr)_140px_130px_140px_130px_110px]";

function Fact({ label, units, className }: { label: string; units: bigint; className?: string }) {
  return (
    <div className={`flex flex-col gap-0.5 max-md:order-3 md:text-right ${className ?? ""}`}>
      <span className="text-xs text-text-tertiary md:sr-only">{label}</span>
      <span className="text-[15px] text-text-primary tabular-nums">{formatFusd(units, { unit: false })}</span>
    </div>
  );
}

/** The action of one position: Claim when something is claimable, Refund for a failed raise, nothing otherwise. */
function Action({ position }: { position: Position }) {
  if (position.vault.state === "Refunded" && position.deposit > 0n) {
    return <RefundButton position={position} className="max-md:h-11 max-md:w-full" />;
  }
  if (position.claimable > 0n) return <ClaimButton position={position} className="max-md:h-11 max-md:w-full" />;
  return null;
}

/**
 * The positions of the lender. On a phone each is a card (Card/Position); from tablet up the same elements
 * sit in columns (Table/Positions). The amounts are fUSD with the unit in the heading, as in the design.
 */
export function PositionList({ positions, canSend }: { positions: Position[]; canSend: boolean }) {
  return (
    <div className="flex flex-col gap-3 md:gap-0.5 md:rounded-3xl md:bg-surface md:p-3">
      <div aria-hidden className={`hidden gap-x-4 px-4 pt-1 pb-2 text-xs font-medium text-text-tertiary md:grid ${COLUMNS}`}>
        <span>Business</span>
        <span>Status</span>
        <span className="text-right">Lent</span>
        <span className="text-right">Repaid to you</span>
        <span className="text-right">Claimable</span>
        <span />
      </div>
      <ul className="contents">
        {positions.map((p) => (
          <li
            key={p.business.vault}
            className={`grid grid-cols-3 items-center gap-x-4 gap-y-4 rounded-3xl bg-surface p-5 transition-colors duration-[120ms] md:rounded-xl md:bg-transparent md:px-4 md:py-3.5 md:hover:bg-surface-hover ${COLUMNS}`}
          >
            <div className="col-span-2 flex min-w-0 items-center gap-3 max-md:order-1 md:col-span-1">
              <BusinessMark slug={p.business.slug} size={40} />
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-[15px] font-medium text-text-primary">{p.business.name}</span>
                <span className="truncate text-[13px] text-text-secondary">
                  {p.business.version === 1 ? (
                    "Earlier vault"
                  ) : isEnded(p.vault.state) ? (
                    <>
                      <span className="max-md:hidden">{`${p.vault.state}, ${formatFusd(p.fromSweep)} recovered`}</span>
                      <span className="md:hidden">{`${formatFusd(p.fromSweep)} recovered`}</span>
                    </>
                  ) : (
                    p.business.tagline
                  )}
                </span>
              </div>
            </div>
            <span className="justify-self-end max-md:order-2 md:justify-self-start">
              <StateBadge state={p.vault.state} />
            </span>
            <Fact label="Lent" units={p.deposit} />
            <Fact label="Repaid to you" units={p.claimed} />
            <div className="flex flex-col gap-0.5 max-md:order-3 md:text-right">
              <span className="text-xs text-text-tertiary md:sr-only">Claimable</span>
              <span className="text-[15px] text-text-primary tabular-nums">{formatFusd(p.claimable, { unit: false })}</span>
              {isEnded(p.vault.state) && p.fromSweep > 0n && p.claimable > 0n && (
                <span className="text-xs text-text-tertiary tabular-nums">Includes {formatFusd(p.fromSweep, { unit: false })} from the ended loan</span>
              )}
            </div>
            {canSend && (
              <div className="col-span-3 max-md:order-4 empty:hidden md:col-span-1 md:justify-self-end">
                <Action position={p} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
