import { Button } from "@/components/ui/button";

/**
 * A quiet line for a section that still shows data from an earlier load because the latest refresh failed.
 * Show it when a query has data and `isRefetchError` is true.
 */
export function StaleNotice({ onRetry }: { onRetry: () => void }) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 text-sm text-text-tertiary">
      This section could not be refreshed. The figures may be out of date.
      <Button variant="ghost" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </p>
  );
}