"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { hexToQor } from "@qredit/qore";
import { shortAddress } from "@/lib/format";
import { cn } from "@/lib/utils";

type Props = { value: string; kind?: "evm" | "qor"; copyable?: boolean; className?: string };

/** Shortened address with the full value in the title; the copy button copies the full value. */
export function Address({ value, kind = "evm", copyable = true, className }: Props) {
  const full = kind === "qor" && value.startsWith("0x") ? hexToQor(value) : value;
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  const copy = () => {
    void navigator.clipboard?.writeText(full).then(
      () => setCopied(true),
      () => undefined,
    );
  };

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-surface-muted py-1.5 pl-3",
        copyable ? "pr-1.5" : "pr-3",
        className,
      )}
    >
      <span title={full} className="font-mono text-[13px] text-text-primary">
        {shortAddress(full)}
      </span>
      {copyable && (
        <button
          type="button"
          onClick={copy}
          aria-label="Copy"
          className="grid size-7 place-items-center rounded-full text-text-tertiary transition-colors duration-150 hover:bg-surface-hover pointer-coarse:size-11"
        >
          {copied ? (
            <Check className="size-3.5" aria-hidden />
          ) : (
            <Copy className="size-3.5" aria-hidden />
          )}
        </button>
      )}
    </span>
  );
}
