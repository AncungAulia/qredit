import Link from "next/link";
import { BusinessMark } from "@/components/shared/BusinessMark";
import { LoanBar } from "@/components/shared/LoanBar";
import { StateBadge } from "@/components/shared/StateBadge";
import { UnverifiedSuppliersBadge } from "@/components/shared/UnverifiedSuppliersBadge";
import { Button, buttonVariants } from "@/components/ui/button";
import { formatBps, formatFusd } from "@/lib/format";
import { isEnded } from "@/lib/vaultState";
import { cn, focusRing } from "@/lib/utils";
import { buyersText, rejectionBps } from "@/modules/market/lib/trackRecord";
import type { FailedEntry, MarketEntry } from "@/modules/market/api/market.api";

// On a phone the facts stack as label and value rows; from tablet up they sit side by side.
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3 md:flex-1 md:flex-col md:items-stretch md:justify-start md:gap-1">
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

function deliveredText({ ordersDelivered: n, deliveredCapped }: MarketEntry): string {
  if (n === 0) return "None yet";
  return `${deliveredCapped ? "At least " : ""}${n} delivered`;
}

/** One business on the Market (BusinessCard in the design). The whole card opens the business page. */
export function BusinessCard({ entry }: { entry: MarketEntry }) {
  const { business: b, vault: v } = entry;
  const rejected = rejectionBps(b.stats);
  const ended = isEnded(v.state);
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
      <div className="mt-auto flex flex-col gap-3">
        <div className="flex flex-col gap-2 md:flex-row md:gap-6">
          <Fact label="Price" value={priceText(b.services)} />
          <Fact label="Lender share" value={`${formatBps(v.lenderBps)} of sales`} />
          <Fact label="Orders" value={deliveredText(entry)} />
        </div>
        <div className="flex flex-col gap-2 md:flex-row md:gap-6">
          <Fact label="Bond" value={formatFusd(v.bondHeld)} />
          <Fact label="Buyers" value={buyersText(v.uniqueBuyers)} />
          <Fact label="Rejected" value={rejected === null ? "No reports yet" : formatBps(rejected)} />
        </div>
        {(entry.unverified || ended) && (
          <div className="flex items-center justify-between gap-3">
            {entry.unverified ? <UnverifiedSuppliersBadge /> : <span />}
            {/* The whole card is the link, so the button is its look only. */}
            {ended && <span className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>View</span>}
          </div>
        )}
      </div>
    </Link>
  );
}

/** A business whose vault or orders could not be read. It does not link, because its state is unknown. */
export function FailedBusinessCard({
  entry,
  onRetry,
}: {
  entry: FailedEntry;
  onRetry: () => void;
}) {
  const { business: b } = entry;
  return (
    <div className="flex h-full flex-col gap-5 rounded-3xl bg-surface p-6">
      <div className="flex items-start gap-3.5">
        <BusinessMark slug={b.slug} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-lg leading-tight font-medium text-text-primary">{b.name}</span>
          <span className="text-sm leading-snug text-text-secondary">{b.tagline}</span>
        </div>
      </div>
      <div role="alert" className="mt-auto flex flex-col items-start gap-3">
        <p className="text-sm text-text-secondary">This business could not be loaded.</p>
        <Button
          variant="secondary"
          size="sm"
          onClick={onRetry}
          aria-label={`Try again to load ${b.name}`}
        >
          Try again
        </Button>
      </div>
    </div>
  );
}
