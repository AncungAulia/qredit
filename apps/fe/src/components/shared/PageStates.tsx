// src/components/shared/PageStates.tsx: error, empty and loading states from the design (State/*).
// Every state fills the space its content would take, message centered: layout="page" (default) fills
// the rest of the screen below the header, layout="section" fills its card (at least 12rem). Filling works
// through flex-1, so each parent up to <body> must be a flex column. Never a fixed height.
import type { ReactNode } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type Layout = "page" | "section";

export type EmptyArt =
  "error" | "waiting" | "search" | "lending" | "wallet" | "reports" | "owner" | "notfound";

const fill: Record<Layout, string> = {
  page: "flex w-full flex-1 flex-col",
  section: "flex h-full min-h-48 w-full flex-1 flex-col",
};

type EmptyStateProps = {
  art: EmptyArt;
  title: string;
  message?: string;
  /** Only an action the header does not already offer. */
  action?: ReactNode;
  layout?: Layout;
  className?: string;
  role?: "alert";
};

export function EmptyState({
  art,
  title,
  message,
  action,
  layout = "page",
  className,
  role,
}: EmptyStateProps) {
  return (
    <div
      role={role}
      className={cn(
        fill[layout],
        "items-center justify-center gap-3 rounded-3xl bg-surface p-8 text-center",
        className,
      )}
    >
      <span className="relative size-32 shrink-0 overflow-hidden rounded-3xl">
        <Image
          src={`/empty/${art}-light.png`}
          alt=""
          width={256}
          height={256}
          className="size-full object-cover dark:hidden"
        />
        <Image
          src={`/empty/${art}-dark.png`}
          alt=""
          width={256}
          height={256}
          className="hidden size-full object-cover dark:block"
        />
      </span>
      <p className="text-base font-medium text-text-primary">{title}</p>
      {message && <p className="max-w-prose text-sm text-text-secondary">{message}</p>}
      {action}
    </div>
  );
}

type ErrorStateProps = {
  onRetry?: () => void;
  title?: string;
  message?: string;
  layout?: Layout;
  className?: string;
};

/** A failed load. Retry refetches; never a toast. */
export function ErrorState({
  onRetry,
  title = "This page could not be loaded.",
  message = "Please try again shortly.",
  layout,
  className,
}: ErrorStateProps) {
  return (
    <EmptyState
      role="alert"
      art="error"
      title={title}
      message={message}
      layout={layout}
      className={className}
      action={
        onRetry && (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Try again
          </Button>
        )
      }
    />
  );
}

/** Skeleton rows for a loading list. Pass the row height of the list being replaced so nothing jumps. */
export function ListSkeleton({
  rows,
  rowClassName = "h-16",
  className,
}: {
  rows: number;
  rowClassName?: string;
  className?: string;
}) {
  return (
    <div role="status" aria-busy="true" className={cn("flex w-full flex-col gap-3", className)}>
      <span className="sr-only">Loading</span>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className={cn("w-full rounded-3xl", rowClassName)} />
      ))}
    </div>
  );
}
