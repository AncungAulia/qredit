import { ExternalLink } from "lucide-react";
import { env } from "@/lib/env";
import { shortHash } from "@/lib/format";

/** Opens the transaction on the explorer in a new tab. Without an explorer it shows the short hash as text. */
export function TxLink({ hash }: { hash: string }) {
  if (!env.explorerUrl) {
    return (
      <span title={hash} className="font-mono text-[13px] text-text-secondary">
        {shortHash(hash)}
      </span>
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
