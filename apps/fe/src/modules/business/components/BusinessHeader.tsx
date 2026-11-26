import type { ReactNode } from "react";
import { BusinessMark } from "@/components/shared/BusinessMark";
import { UnverifiedSuppliersBadge } from "@/components/shared/UnverifiedSuppliersBadge";
import { StateBadge } from "@/components/shared/StateBadge";
import type { VaultStateName } from "@/lib/vaultState";
import { Skeleton } from "@/components/ui/skeleton";
import type { Business } from "@/lib/schemas";

/**
 * Mark, name, state and tagline (BizHead in the design). On a phone the mark and name share a row, with the
 * badge and the tagline below at the left edge. The state shows once the vault is read; until then a
 * placeholder holds its place, and when the vault cannot be read the badge is left out rather than guessed.
 */
export function BusinessHeader({
  business,
  state,
  stateFailed,
  unverified,
  action,
}: {
  business: Business;
  state: VaultStateName | undefined;
  stateFailed: boolean;
  /** A supplier the vault was created with is not in Qredit's list. */
  unverified?: boolean;
  /** The primary action of the page (from tablet up); a phone gets its own sticky bar. */
  action?: ReactNode;
}) {
  const badge = state ? (
    <StateBadge state={state} />
  ) : stateFailed ? null : (
    <Skeleton className="h-7 w-24 rounded-full" />
  );
  return (
    <header className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-3 md:grid-cols-[auto_1fr_auto] md:gap-x-5 md:gap-y-1.5">
      <BusinessMark slug={business.slug} size={44} className="md:hidden" />
      <BusinessMark
        slug={business.slug}
        size={64}
        className="hidden rounded-2xl md:row-span-2 md:inline-block"
      />
      <div className="contents md:flex md:flex-wrap md:items-center md:gap-3">
        <h1 className="min-w-0 text-[28px] font-medium tracking-[-0.8px] text-text-primary md:text-[30px] md:tracking-[-1px] xl:text-[32px]">
          {business.name}
        </h1>
        <span className="col-span-2 flex justify-self-start md:col-span-1" aria-live="polite">
          {badge}
          {unverified && <UnverifiedSuppliersBadge />}
        </span>
      </div>
      <p className="col-span-2 text-sm leading-normal text-text-secondary md:col-span-1 md:col-start-2 md:text-[15px]">
        {business.tagline}
      </p>
      {action && <div className="hidden md:col-start-3 md:row-span-2 md:row-start-1 md:block">{action}</div>}
    </header>
  );
}
