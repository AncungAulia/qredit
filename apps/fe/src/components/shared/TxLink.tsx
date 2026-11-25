import { ArrowUpRight, ExternalLink } from "lucide-react";
import { env } from "@/lib/env";
import { shortHash } from "@/lib/format";
import { cn, focusRing } from "@/lib/utils";

/** Opens the transaction (compact: the short hash with an arrow, for table cells) on the explorer in a new tab. Without an explorer it shows the short hash as text. */
export function TxLink({ hash, compact = false }: { hash: string; compact?: boolean }) {
  if (!env.explorerUrl) {
    return (
      <span title={hash} className="font-mono text-[13px] text-text-secondary">
        {shortHash(hash)}
      </span>
    );
  }
  if (compact) {
    return (
      <a
        href={`${env.explorerUrl}/tx/${hash}`}
        target="_blank"
        rel="noreferrer"
        title={hash}
        aria-label="View transaction on the explorer"
        className={cn(
          "inline-flex items-center gap-1.5 font-mono text-[13px] text-text-secondary hover:text-text-primary pointer-coarse:min-h-11",
          focusRing,
        )}
      >
        {shortHash(hash)}
        <ArrowUpRight className="size-3.5 text-text-tertiary" aria-hidden />
      </a>
    );
  }
  return (
    <a
      href={`${env.explorerUrl}/tx/${hash}`}
      target="_blank"
      rel="noreferrer"
      title={hash}
      className="inline-flex items-center gap-1 text-sm font-medium text-text-primary hover:underline"
    >
      View transaction
      <ExternalLink className="size-3.5 text-text-secondary" aria-hidden />
    </a>
  );
}
