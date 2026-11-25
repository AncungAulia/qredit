import Link from "next/link";
import { BusinessMark } from "@/components/shared/BusinessMark";
import { LoanBar } from "@/components/shared/LoanBar";
import { StateBadge } from "@/components/shared/StateBadge";
import { formatBps, formatFusd } from "@/lib/format";
import { cn, focusRing } from "@/lib/utils";
import type { MarketEntry } from "@/modules/market/api/market.api";

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="text-[13px] text-text-tertiary">{label}</span>
      <span className="text-[15px] font-medium text-text-primary tabular-nums">{value}</span>
    </div>
  );
}

/** The lowest price among the services; "From" when there are several. */
function priceText(services: MarketEntry["business"]["services"]): string {
  if (services.length === 0) return "Not listed";
  const lowest = services.reduce(
    (m, s) => (s.priceUnits < m ? s.priceUnits : m),
    services[0].priceUnits,
  );
  return `${services.length > 1 ? "From " : ""}${formatFusd(lowest)}`;
}

/** One business on the Market (BusinessCard in the design). The whole card opens the business page. */
export function BusinessCard({ entry }: { entry: MarketEntry }) {
  const { business: b, vault: v } = entry;
  return (
    <Link
      href={`/agents/${b.slug}`}
      className={cn(
        "flex h-full flex-col gap-5 rounded-3xl bg-surface p-6 transition-[background-color,transform] duration-[120ms] ease-[var(--ease-out)] hover:bg-surface-hover active:scale-[0.98]",
        focusRing,
      )}
    >
      <div className="flex items-start gap-3.5">
        <BusinessMark slug={b.slug} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-lg leading-tight font-medium text-text-primary">{b.name}</span>
          <span className="text-sm leading-snug text-text-secondary">{b.tagline}</span>
        </div>
        <StateBadge state={v.state} className="shrink-0" />
      </div>
      <LoanBar
        state={v.state}
        raised={v.raised}
        target={v.target}
        repaid={v.repaid}
        totalOwed={v.totalOwed}
      />
      <div className="mt-auto flex gap-6">
        <Fact label="Price" value={priceText(b.services)} />
        <Fact label="Lender share" value={`${formatBps(v.lenderBps)} of sales`} />
        <Fact
          label="Orders"
          value={entry.ordersDelivered > 0 ? `${entry.ordersDelivered} delivered` : "None yet"}
        />
      </div>
    </Link>
  );
}
