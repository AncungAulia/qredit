// src/components/shared/PageStates.tsx: loading, error, offline, no-access and empty states.
// Every state fills the space its content would take, with its message centered:
// layout="page" (default) fills the rest of the screen below the header; layout="section"
// fills its card or panel. Filling works through flex-1, so each parent up to <body> must be a
// flex column (ui-rules.md §5, "State size"). Never a fixed height such as 60dvh or 100vh.
import type { ComponentType, ReactNode } from "react";
import { AlertCircle, Inbox, Lock, RotateCw, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/apiClient";
import { cn } from "@/lib/utils";

type Layout = "page" | "section";

const fill: Record<Layout, string> = {
  page: "flex w-full flex-1 flex-col",
  section: "flex h-full min-h-48 w-full flex-1 flex-col",
};
const frame = "items-center justify-center gap-3 p-6 text-center";

/**
 * Skeleton rows for a loading list or table, in an area as big as the loaded content will be,
 * so nothing jumps when it arrives. Spinners are for actions, inside their button.
 */
export function LoadingState({
  label = "Loading data…",
  rows = 5,
  layout = "page",
  className,
}: {
  label?: string;
  rows?: number;
  layout?: Layout;
  className?: string;
}) {
  return (
    <div role="status" aria-busy="true" className={cn(fill[layout], "gap-3 py-2", className)}>
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

type StateProps = {
  icon: ComponentType<{ className?: string }>;
  iconClassName?: string;
  title: string;
  description?: string;
  action?: ReactNode;
  layout?: Layout;
  className?: string;
  role?: "alert";
};

function StateFrame({
  icon: Icon,
  iconClassName,
  title,
  description,
  action,
  layout = "page",
  className,
  role,
}: StateProps) {
  return (
    <div role={role} className={cn(fill[layout], frame, className)}>
      <Icon className={cn("size-8 text-muted-foreground", iconClassName)} aria-hidden />
      <div className="max-w-prose space-y-1">
        <p className="font-medium">{title}</p>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

type ErrorStateProps = {
  /** What failed, e.g. "Businesses failed to load". */
  title?: string;
  error: unknown;
  onRetry?: () => void;
  layout?: Layout;
  className?: string;
};

/** Picks the error, offline or no-access state from ApiError.kind. */
export function ErrorState({
  title = "The data failed to load",
  error,
  onRetry,
  layout,
  className,
}: ErrorStateProps) {
  // Only ApiError messages are written for people; anything else stays off the screen.
  const apiError = error instanceof ApiError ? error : new ApiError("unknown", null, error);
  const retry = onRetry && (
    <Button variant="outline" size="sm" onClick={onRetry}>
      <RotateCw className="size-4" aria-hidden />
      Try again
    </Button>
  );

  if (apiError.kind === "offline") {
    return (
      <StateFrame
        role="alert"
        icon={WifiOff}
        title="You are offline"
        description={apiError.message}
        action={retry}
        layout={layout}
        className={className}
      />
    );
  }

  if (apiError.kind === "unauthorized" || apiError.kind === "forbidden") {
    return (
      <StateFrame
        role="alert"
        icon={Lock}
        title="No access"
        description={apiError.message}
        layout={layout}
        className={className}
      />
    );
  }

  return (
    <StateFrame
      role="alert"
      icon={AlertCircle}
      iconClassName="text-destructive"
      title={title}
      description={apiError.message}
      action={retry}
      layout={layout}
      className={className}
    />
  );
}

type EmptyStateProps = {
  title: string;
  description?: string;
  /** Only an action the header does not already offer (e.g. clearing a filter). */
  action?: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  layout?: Layout;
  className?: string;
};

export function EmptyState({ icon = Inbox, ...props }: EmptyStateProps) {
  return <StateFrame icon={icon} {...props} />;
}
