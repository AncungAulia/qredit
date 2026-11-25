"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { EmptyState, ErrorState } from "@/components/shared/PageStates";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/apiClient";
import type { Business } from "@/lib/schemas";
import { cn, focusRing } from "@/lib/utils";
import { useDecisionsQuery, useRulesQuery } from "@/modules/business/api/useBusinessPage";
import { useBusinessQuery, useOrdersQuery, useVaultQuery } from "@/modules/market";
import { ActivityTable } from "./ActivityTable";
import { BusinessHeader } from "./BusinessHeader";
import { BusinessKpis } from "./BusinessKpis";
import { BusinessSkeleton } from "./BusinessSkeleton";
import { DecisionLog } from "./DecisionLog";
import { LoanTerms } from "./LoanTerms";
import { Section } from "./Section";
import { ServicesCard } from "./ServicesCard";
import { VaultRules } from "./VaultRules";

function Breadcrumb() {
  return (
    <Link
      href="/"
      className={cn(
        "inline-flex w-fit items-center gap-1.5 rounded-md text-sm font-medium text-text-secondary hover:text-text-primary pointer-coarse:min-h-11",
        focusRing,
      )}
    >
      <ArrowLeft className="size-4" aria-hidden />
      Market
    </Link>
  );
}

const SectionLoading = ({ className }: { className: string }) => (
  <div role="status" aria-busy="true">
    <span className="sr-only">Loading</span>
    <Skeleton className={cn("w-full rounded-3xl", className)} />
  </div>
);

/** The loan figures and the loan card, both read from the vault. A vault that cannot be read shows an error in place of both. */
function BusinessBody({ business }: { business: Business }) {
  const vault = useVaultQuery(business.vault);
  const orders = useOrdersQuery(business.vault);
  const rules = useRulesQuery(business);
  const decisions = useDecisionsQuery(business.vault);

  const snapshot = vault.data;
  const vaultFailed = vault.isError && !snapshot;
  const delivered = orders.data
    ? orders.data.filter((o) => o.status === "delivered").length
    : orders.isError
      ? "unavailable"
      : "loading";

  return (
    <>
      <BusinessHeader business={business} state={snapshot?.state} stateFailed={vaultFailed} />
      {vaultFailed ? (
        <ErrorState
          layout="section"
          title="The loan could not be read."
          message="The chain did not respond. Please try again shortly."
          onRetry={() => vault.refetch()}
        />
      ) : snapshot ? (
        <div className="animate-in duration-200 fade-in">
          <BusinessKpis vault={snapshot} delivered={delivered} />
        </div>
      ) : (
        <SectionLoading className="h-[118px]" />
      )}

      <div className="flex flex-col gap-8 xl:grid xl:grid-cols-[1fr_400px] xl:grid-rows-[auto_auto_1fr] xl:gap-x-6">
        {!vaultFailed && (
          <Section
            id="loan"
            title="Loan"
            description="Lenders are repaid from every sale before the owner earns anything."
            className="xl:col-start-1"
          >
            {snapshot ? (
              <div className="animate-in duration-200 fade-in">
                <LoanTerms vault={snapshot} />
              </div>
            ) : (
              <SectionLoading className="h-64" />
            )}
          </Section>
        )}

        <Section
          id="orders"
          title="Orders"
          description="The orders placed with this business, newest first."
          className="xl:col-start-1"
        >
          <ActivityTable
            business={business}
            orders={orders.data}
            isError={orders.isError}
            onRetry={() => orders.refetch()}
          />
        </Section>

        <div className="grid gap-8 md:grid-cols-2 md:gap-4 xl:col-start-2 xl:row-span-3 xl:row-start-1 xl:flex xl:flex-col xl:gap-8">
          <Section
            id="rules"
            title="Spending rules"
            description="Read from the vault now. The agent can pay only the suppliers listed here."
          >
            {rules.data ? (
              <div className="animate-in duration-200 fade-in">
                <VaultRules rules={rules.data} />
              </div>
            ) : rules.isError ? (
              <ErrorState
                layout="section"
                title="The spending rules could not be read."
                onRetry={() => rules.refetch()}
              />
            ) : (
              <SectionLoading className="h-72" />
            )}
          </Section>
          <Section
            id="services"
            title="Services"
            description="What this business sells. Payment waits in escrow until the report is delivered."
          >
            <ServicesCard services={business.services} />
          </Section>
        </div>

        <Section
          id="decisions"
          title="Decision log"
          description="Every choice the agent made, without the content of any request."
          className="xl:col-start-1 xl:h-full"
        >
          <DecisionLog
            decisions={decisions.data}
            isError={decisions.isError}
            onRetry={() => decisions.refetch()}
            raising={snapshot?.state === "Raising"}
          />
        </Section>
      </div>
    </>
  );
}

/**
 * The Business page. A slug that matches no business shows the not-found state; a failed load shows an error
 * only when there is nothing to show. Each section reports its own failure so the rest of the page stays.
 */
export function BusinessPage({ slug }: { slug: string }) {
  const query = useBusinessQuery(slug);
  const business = query.data;

  let body;
  if (business) {
    body = <BusinessBody business={business} />;
  } else if (query.isError) {
    body =
      query.error instanceof ApiError && query.error.kind === "notFound" ? (
        <EmptyState art="notfound" title="This business does not exist." />
      ) : (
        <ErrorState
          title="This business could not be loaded."
          message="The service did not respond. Please try again shortly."
          onRetry={() => query.refetch()}
        />
      );
  } else {
    body = <BusinessSkeleton />;
  }

  return (
    <div className="flex flex-1 flex-col gap-6 md:gap-8">
      <Breadcrumb />
      {body}
    </div>
  );
}
