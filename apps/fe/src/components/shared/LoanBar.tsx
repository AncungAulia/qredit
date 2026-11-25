import { formatFusd } from "@/lib/format";
import type { VaultStateName } from "@/lib/vaultState";

type Props = {
  state: VaultStateName;
  raised: bigint;
  target: bigint;
  repaid: bigint;
  totalOwed: bigint;
};

const TICKS = 48;
const pct = (part: bigint, whole: bigint) =>
  whole === 0n ? 0 : Math.min(100, Number((part * 100n) / whole));

/** Ledger style bar from the design: 48 ticks, one per 1/48 of the whole. */
export function LoanBar({ state, raised, target, repaid, totalOwed }: Props) {
  const raising = state === "Raising" || state === "Refunded";
  const value = raising ? raised : repaid;
  const whole = raising ? target : totalOwed;
  const p = pct(value, whole);
  // A value above zero always shows at least one tick.
  const filled = value > 0n ? Math.max(1, Math.round((p * TICKS) / 100)) : 0;
  // Raising: accent ticks are raised. Repaying: ink ticks are repaid, accent ticks are still owed.
  const done = raising ? "bg-accent" : "bg-primary";
  const rest = raising ? "bg-border" : "bg-accent";
  const keys = raising
    ? [
        ["Raised", "bg-accent"],
        ["Remaining", "bg-border"],
      ]
    : [
        ["Repaid", "bg-primary"],
        ["Owed", "bg-accent"],
      ];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-3">
        <div className="flex items-baseline gap-1.5">
          <span className="text-xl font-medium tracking-tight text-text-primary tabular-nums">
            {formatFusd(value, { unit: false })}
          </span>
          <span className="text-[13px] text-text-tertiary tabular-nums">
            of {formatFusd(whole)} {raising ? "raised" : "repaid"}
          </span>
        </div>
        <span className="text-[13px] font-medium text-text-primary tabular-nums">{p}%</span>
      </div>
      <div
        role="progressbar"
        aria-label={raising ? "Raised" : "Repaid"}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={p}
        className="flex h-6 gap-[3px]"
      >
        {Array.from({ length: TICKS }, (_, i) => (
          <span
            key={i}
            data-tick={i < filled ? "filled" : "empty"}
            className={`h-full flex-1 rounded-[1.5px] ${i < filled ? done : rest}`}
          />
        ))}
      </div>
      <div className="flex items-center gap-4">
        {keys.map(([label, swatch]) => (
          <span key={label} className="flex items-center gap-1.5 text-xs text-text-tertiary">
            <span className={`size-2 rounded-sm ${swatch}`} aria-hidden />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
