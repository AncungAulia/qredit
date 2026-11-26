"use client";

import { useState } from "react";
import Link from "next/link";
import { Info, X } from "lucide-react";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/shared/PageStates";
import { KpiTile } from "@/components/shared/KpiTile";
import { Notice } from "@/components/shared/Notice";
import { StaleNotice } from "@/components/shared/StaleNotice";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCount, formatFusd } from "@/lib/format";
import { cn, focusRing } from "@/lib/utils";
import { useMyOrdersQuery, useOrderTimesQuery } from "@/modules/inbox/api/useInbox";
import { InboxList } from "@/modules/inbox/components/InboxList";
import { inboxTotals } from "@/modules/inbox/lib/inboxOrders";
import { KPI_GRID, useMarketQuery } from "@/modules/market";
import { ConnectPrompt } from "@/modules/wallet/components/ConnectPrompt";
import { SetupGate, useWalletReadiness } from "@/modules/wallet/components/RequireReadyWallet";
import { testWalletOf } from "@/modules/wallet/signer";
import { useWallet } from "@/modules/wallet/WalletProvider";

function PageHead() {
  return (
    <div className="flex flex-col gap-1.5">
      <h1 className="text-[28px] font-medium tracking-[-0.8px] text-text-primary md:text-[30px] md:tracking-[-1px] xl:text-[32px]">Inbox</h1>
      <p className="text-sm leading-normal text-text-secondary md:text-[15px]">
        Orders you placed and the sealed reports delivered to you. Only your key can open them.
      </p>
    </div>
  );
}

/** Notice/Info/Dismissible of the design. */
function SealNotice() {
  const [shown, setShown] = useState(true);
  if (!shown) return null;
  return (
    <div role="note" className="flex w-full items-start gap-3 rounded-lg bg-info-soft p-4">
      <Info className="mt-px size-[18px] shrink-0 text-info" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-[15px] font-medium text-text-primary">How sealing works</p>
        <p className="text-sm leading-normal text-text-secondary">
          Your request is sealed to the agent&apos;s key, and the report is sealed to yours. Qredit only relays the sealed envelopes.
        </p>
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => setShown(false)}
        className={cn("grid size-7 shrink-0 place-items-center rounded-full text-text-tertiary hover:bg-surface-hover pointer-coarse:size-11", focusRing)}
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}

/** Four tiles and the rows, shaped like the content so nothing jumps when it arrives. */
function InboxSkeleton() {
  return (
    <div className="flex flex-col gap-6 md:gap-8">
      <div aria-hidden className={KPI_GRID}>
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className={cn("h-[118px] rounded-3xl", i === 0 && "col-span-2 md:col-span-1", i === 3 && "max-md:hidden")} />
        ))}
      </div>
      <ListSkeleton rows={5} rowClassName="h-[84px]" />
    </div>
  );
}

/** What a session that cannot open reports is told, with the button for the step it needs. */
function NotConnected({ kind }: { kind: string }) {
  const need =
    kind === "locked"
      ? { title: "Unlock your wallet to see your reports", message: "Reports are sealed to your wallet key. Unlock your test wallet so the key is available in this browser." }
      : kind === "qorex"
        ? {
            title: "Use a test wallet to see your reports",
            message: "QoreX cannot open sealed reports, so the inbox needs a test wallet. Only that wallet's key can open them.",
          }
        : { title: "Connect a wallet to see your reports", message: "Reports are sealed to your wallet key. Only that key can open them." };
  return <EmptyState art="wallet" title={need.title} message={need.message} action={<ConnectPrompt variant="secondary" size="sm" />} />;
}

/** The Inbox (/inbox): the orders of the test wallet across all businesses, and the reports delivered to it. */
export function InboxPage() {
  const session = useWallet((s) => s.session);
  const hydrated = useWallet((s) => s.hydrated);
  const evm = testWalletOf(session)?.evm ?? null;
  const market = useMarketQuery();
  const businesses = market.data?.map((row) => row.business);
  const orders = useMyOrdersQuery(evm, businesses);
  const rows = orders.data;
  const times = useOrderTimesQuery([...new Set((rows ?? []).map((o) => o.placedBlock))]);
  // A reclaim needs the wallet set up on the chain (the window), so it waits until it is ready.
  const readiness = useWalletReadiness();

  let body;
  if (!hydrated) {
    body = <InboxSkeleton />;
  } else if (evm === null) {
    body = <NotConnected kind={session.kind} />;
  } else if ((market.isError && !businesses) || (orders.isError && !rows)) {
    body = (
      <ErrorState
        title="Your orders could not be loaded."
        message="The chain or the service did not respond. Please try again shortly."
        onRetry={() => (market.isError && !businesses ? market.refetch() : orders.refetch())}
      />
    );
  } else if (!rows) {
    body = <InboxSkeleton />;
  } else if (rows.length === 0) {
    body = (
      <EmptyState
        art="reports"
        title="No reports yet"
        message="Reports you purchase will appear here, sealed to your key."
        action={
          <Button variant="secondary" size="sm" render={<Link href="/" />} nativeButton={false} role="link">
            Browse the market
          </Button>
        }
      />
    );
  } else {
    const t = inboxTotals(rows);
    body = (
      <div className="flex animate-in flex-col gap-6 duration-200 fade-in md:gap-8">
        {orders.isRefetchError && <StaleNotice onRetry={() => orders.refetch()} />}
        <div className={KPI_GRID}>
          <KpiTile variant="feature" label="Ready to open" value={formatCount(t.ready)} unit={t.ready === 1 ? "report" : "reports"} className="col-span-2 md:col-span-1" />
          <KpiTile variant="soft" label="Waiting for delivery" value={formatCount(t.waiting)} unit={t.waiting === 1 ? "order" : "orders"} />
          <KpiTile variant="soft" label="Spent in total" value={formatFusd(t.spent, { unit: false })} unit="fUSD" />
          <KpiTile variant="soft" label="Refunded to you" value={formatFusd(t.refunded, { unit: false })} unit="fUSD" className="max-md:hidden" />
        </div>
        <SealNotice />
        <section aria-labelledby="orders" className="flex flex-col gap-3.5">
          <div className="flex flex-col gap-1">
            <h2 id="orders" className="text-xl font-medium text-text-primary">
              Your orders
            </h2>
            <p className="text-sm text-text-secondary">Payment stays in escrow until the report is delivered. A late order can be reclaimed.</p>
          </div>
          {readiness.state === "setup" && <SetupGate />}
          {readiness.state === "error" && (
            <Notice tone="warning">
              The status of your wallet could not be read, so reclaiming is paused.{" "}
              <button type="button" className="font-medium underline" onClick={readiness.refetch}>
                Try again
              </button>
            </Notice>
          )}
          <InboxList orders={rows} times={times.data} canSend={readiness.state === "ready"} />
        </section>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-6 md:gap-8">
      <PageHead />
      {body}
    </div>
  );
}
