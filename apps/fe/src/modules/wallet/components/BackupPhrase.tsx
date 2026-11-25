"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

/** The recovery phrase as numbered words with a copy button. It is only ever rendered from memory the user asked for. */
export function BackupPhrase({ phrase }: { phrase: string }) {
  const words = phrase.trim().split(/\s+/);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  const copy = () => {
    void navigator.clipboard?.writeText(phrase).then(
      () => setCopied(true),
      () => undefined,
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <ol
        data-testid="phrase"
        aria-label="Recovery phrase"
        className="grid list-none grid-cols-2 gap-x-4 gap-y-2 rounded-lg bg-surface-muted p-4 font-mono text-[13px] text-text-primary [counter-reset:word] sm:grid-cols-3"
      >
        {words.map((word, i) => (
          <li
            key={i}
            className="flex items-baseline gap-2 [counter-increment:word] before:min-w-5 before:text-right before:text-text-tertiary before:content-[counter(word)]"
          >
            {word}{" "}
          </li>
        ))}
      </ol>
      <div className="flex items-center gap-2">
        <Button type="button" variant="secondary" size="lg" className="h-10 px-3.5" onClick={copy}>
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          Copy recovery phrase
        </Button>
        <span aria-live="polite" className="text-[13px] text-text-tertiary">
          {copied ? "Copied" : ""}
        </span>
      </div>
    </div>
  );
}
