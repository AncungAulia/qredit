"use client";

import Link from "next/link";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/shared/PageStates";
import { KpiTile } from "@/components/shared/KpiTile";
import { Notice } from "@/components/shared/Notice";
import { StaleNotice } from "@/components/shared/StaleNotice";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCount, formatFusd } from "@/lib/format";
import { usePositionsQuery } from "@/modules/lend/api/useLend";
import { PositionList } from "@/modules/lend/components/PositionList";
import { lendTotals, lenderAddress } from "@/modules/lend/lib/lender";
import { KPI_GRID, useMarketQuery } from "@/modules/market";
import { ConnectPrompt } from "@/modules/wallet/components/ConnectPrompt";
import { SetupGate, useWalletReadiness } from "@/modules/wallet/components/RequireReadyWallet";
import { testWalletOf } from "@/modules/wallet/signer";
import { useWallet } from "@/modules/wallet/WalletProvider";

function PageHead() {
  return (
    <div className="flex flex-col gap-1.5">
      <h1 className="text-[28px] font-medium tracking-[-0.8px] text-text-primary md:text-[30px] md:tracking-[-1px] xl:text-[32px]">
        My lending
      </h1>
      <p className="text-sm leading-normal text-text-secondary md:text-[15px]">
        Your loans to agent businesses, what has been repaid to you, and what you can claim now.
      </p>
    </div>
  );
}

/** Four tiles and the rows, shaped like the content so nothing jumps when it arrives. */
function PositionsSkeleton() {
  return (
    <div className="flex flex-col gap-6 md:gap-8">
      <div aria-hidden className={KPI_GRID}>
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-[118px] rounded-3xl" />
        ))}
      </div>
      <ListSkeleton rows={4} rowClassName="h-[84px]" />
    </div>
  );
}

/** My lending: the lender's positions read from the chain, with claim and refund. */
export function PositionsPage() {
  const session = useWallet((s) => s.session);
  const hydrated = useWallet((s) => s.hydrated);
  const evm = lenderAddress(session);
  const market = useMarketQuery();
  const businesses = market.data?.map((row) => row.business);
  const positions = usePositionsQuery(evm, businesses);
  const rows = positions.data;
  const hasTestWallet = Boolean(testWalletOf(session));
  // Claim and refund need the wallet set up (the window), so they wait until it is ready.
  const readiness = useWalletReadiness();
  const canSend = hasTestWallet && readiness.state === "ready";

  let body;
  if (!hydrated) {
    body = <PositionsSkeleton />;
  } else if (evm === null) {
    body = (
      <EmptyState
        art="wallet"
        title="Connect a wallet to see your loans"
        message="Qredit reads your positions from the chain. Nothing moves until you confirm a transaction."
        action={<ConnectPrompt variant="secondary" size="sm" />}
      />
    );
  } else if ((market.isError && !businesses) || (positions.isError && !rows)) {
    body = (
      <ErrorState
        title="Your loans could not be loaded."
        message="The chain or the service did not respond. Please try again shortly."
        onRetry={() => (market.isError && !businesses ? market.refetch() : positions.refetch())}
      />
    );
  } else if (!rows) {
    body = <PositionsSkeleton />;
  } else if (rows.length === 0) {
    body = (
      <EmptyState
        art="lending"
        title="You have not lent yet"
        message="Your loans and repayments will appear here. Lend to a business that is raising to start."
        action={
          <Button variant="secondary" size="sm" render={<Link href="/" />} nativeButton={false} role="link">
            Browse the market
          </Button>
        }
      />
    );
  } else {
    const t = lendTotals(rows);
    body = (
      <div className="flex animate-in flex-col gap-6 duration-200 fade-in md:gap-8">
        {positions.isRefetchError && <StaleNotice onRetry={() => positions.refetch()} />}
        <div className={KPI_GRID}>
          <KpiTile
            variant="feature"
            label="Claimable now"
            value={formatFusd(t.claimable, { unit: false })}
            unit="fUSD"
            className="col-span-2 md:col-span-1"
          />
          <KpiTile variant="soft" label="Lent in total" value={formatFusd(t.lent, { unit: false })} unit="fUSD" />
          <KpiTile variant="soft" label="Repaid to you" value={formatFusd(t.claimed, { unit: false })} unit="fUSD" />
          <KpiTile
            variant="soft"
            label="Active loans"
            value={formatCount(t.active)}
            className="col-span-2 md:col-span-1"
          />
        </div>
        <section aria-labelledby="positions" className="flex flex-col gap-3.5">
          <div className="flex flex-col gap-1">
            <h2 id="positions" className="text-xl font-medium text-text-primary">
              Positions
            </h2>
            <p className="text-sm text-text-secondary">Repayments arrive with every sale. Claim them at any time.</p>
          </div>
          {hasTestWallet && readiness.state === "setup" && <SetupGate />}
          {hasTestWallet && readiness.state === "error" && (
            <Notice tone="warning">
              The status of your wallet could not be read, so claiming and refunds are paused.{" "}
              <button type="button" className="font-medium underline" onClick={readiness.refetch}>
                Try again
              </button>
            </Notice>
          )}
          {!hasTestWallet && (
            <Notice tone="info">
              Claiming and refunds are sent from a test wallet, because QoreX cannot send this kind of transaction.
            </Notice>
          )}
          <PositionList positions={rows} canSend={canSend} />
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
