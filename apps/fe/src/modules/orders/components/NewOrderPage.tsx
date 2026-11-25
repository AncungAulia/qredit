"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { EmptyState, ErrorState } from "@/components/shared/PageStates";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/apiClient";
import { cn, focusRing } from "@/lib/utils";
import { useBusinessQuery } from "@/modules/market";
import { OrderForm } from "@/modules/orders/components/OrderForm";

function Breadcrumb({ slug, name }: { slug: string; name: string }) {
  return (
    <Link
      href={`/agents/${slug}`}
      className={cn(
        "inline-flex w-fit items-center gap-1.5 rounded-md text-sm font-medium text-text-secondary hover:text-text-primary pointer-coarse:min-h-11",
        focusRing,
      )}
    >
      <ArrowLeft className="size-4" aria-hidden />
      {name}
    </Link>
  );
}

function OrderSkeleton() {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-6">
      <span className="sr-only">Loading</span>
      <Skeleton className="h-4 w-40 rounded-lg" />
      <Skeleton className="h-9 w-56 rounded-lg" />
      <div className="grid gap-4 lg:grid-cols-[1fr_380px] lg:gap-6">
        <Skeleton className="h-96 rounded-3xl" />
        <Skeleton className="h-96 rounded-3xl" />
      </div>
    </div>
  );
}

/** The New order page of one business (/shop/[slug]). */
export function NewOrderPage({ slug }: { slug: string }) {
  const query = useBusinessQuery(slug);
  const business = query.data;

  if (business) {
    return (
      <div className="flex flex-1 flex-col gap-6 md:gap-8">
        <Breadcrumb slug={business.slug} name={business.name} />
        <header className="flex flex-col gap-2">
          <h1 className="text-[28px] font-medium tracking-[-0.8px] text-text-primary md:text-[32px] md:tracking-[-1px]">New order</h1>
          <p className="max-w-prose text-sm leading-normal text-text-secondary md:text-[15px]">
            Your request is sealed in this browser to the agent&apos;s key, so only the agent can read it.
          </p>
        </header>
        <OrderForm business={business} />
      </div>
    );
  }
  if (query.isError) {
    return query.error instanceof ApiError && query.error.kind === "notFound" ? (
      <EmptyState art="notfound" title="This business does not exist." titleAs="h1" />
    ) : (
      <ErrorState
        title="This business could not be loaded."
        message="The service did not respond. Please try again shortly."
        onRetry={() => query.refetch()}
      />
    );
  }
  return <OrderSkeleton />;
}
