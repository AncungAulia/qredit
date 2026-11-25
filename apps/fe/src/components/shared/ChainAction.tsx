"use client";

// The chain action lifecycle from the design board "Chain action lifecycle":
// ready -> waiting for the wallet -> on chain -> done (dialog closes, a toast carries the transaction)
// or refused (the dialog stays with the reason). Refusals always show a mapped sentence, never raw data.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { CircleCheck, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Notice } from "@/components/shared/Notice";
import { TxLink } from "@/components/shared/TxLink";
import { Button } from "@/components/ui/button";
import { TxFailed, TxReverted } from "@/modules/wallet/signer";
import { cn } from "@/lib/utils";

export type ChainPhase = "idle" | "wallet" | "chain" | "done" | "refused";

/** The work of one action; resolves with the transaction hash, or null when no transaction was needed. Call `sent` once the transaction is on its way. */
export type ChainRun = (control: { sent(): void }) => Promise<string | null>;

type ActionState = { phase: ChainPhase; hash?: string; reason?: string };

export const SLOW_AFTER_MS = 20_000;
export const SLOW_SENTENCE = "The chain is taking longer than usual. Your funds are safe.";
export const NOT_COMPLETED_SENTENCE = "The transaction could not be completed.";

/** The sentence for a failed run. Only the decoded reasons of TxReverted and TxFailed are shown. */
export function failureSentence(error: unknown): string {
  if (error instanceof TxReverted || error instanceof TxFailed) return error.reason;
  return NOT_COMPLETED_SENTENCE;
}

const failureHash = (error: unknown) =>
  error instanceof TxReverted || error instanceof TxFailed ? (error.hash ?? undefined) : undefined;

/** Runs one chain action and tracks where it is. `slow` turns on when the chain takes over 20 seconds. */
export function useChainAction(run: ChainRun) {
  const [state, setState] = useState<ActionState>({ phase: "idle" });
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (state.phase !== "chain") return;
    const t = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => clearTimeout(t);
  }, [state.phase]);

  const reset = useCallback(() => {
    setState({ phase: "idle" });
    setSlow(false);
  }, []);

  /** Resolves with the result of a finished action, or null when it was refused. */
  const start = useCallback(async (): Promise<{ hash: string | null } | null> => {
    setSlow(false);
    setState({ phase: "wallet" });
    try {
      const hash = await run({ sent: () => setState((s) => (s.phase === "wallet" ? { phase: "chain" } : s)) });
      setState({ phase: "done", hash: hash ?? undefined });
      return { hash };
    } catch (e) {
      setState({ phase: "refused", reason: failureSentence(e), hash: failureHash(e) });
      return null;
    }
  }, [run]);

  return { ...state, slow, start, reset };
}

type StatusProps = {
  phase: Exclude<ChainPhase, "idle">;
  /** Shown while on chain, for example "Lending 500 fUSD". */
  pendingLabel?: string;
  hash?: string;
  reason?: string;
  slow?: boolean;
  /** Draws the waiting states as the disabled primary button of the dialog design. */
  asButton?: boolean;
  /** Title of the refusal notice; steps that are not transactions say "step". */
  refusedTitle?: string;
};

/** One state of the lifecycle: waiting rows, the refusal notice, or the finished transaction. */
export function ChainActionStatus({
  phase,
  pendingLabel,
  hash,
  reason,
  slow,
  asButton,
  refusedTitle = "This transaction was not completed",
}: StatusProps) {
  if (phase === "wallet" || phase === "chain") {
    const label = phase === "wallet" ? "Confirm in your wallet" : (pendingLabel ?? "Waiting for the chain");
    return (
      <div className="flex flex-col gap-2">
        <div
          role="status"
          className={cn(
            "flex items-center gap-2 text-[15px] font-medium",
            asButton ? "h-11 w-full justify-center rounded-lg bg-primary text-on-primary opacity-80" : "text-text-primary",
          )}
        >
          <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
          {label}
        </div>
        {phase === "chain" && slow && <p className="text-[13px] text-text-secondary">{SLOW_SENTENCE}</p>}
      </div>
    );
  }
  if (phase === "refused") {
    return (
      <Notice tone="danger" title={refusedTitle}>
        {reason ?? NOT_COMPLETED_SENTENCE}
        {hash && (
          <span className="mt-2 block">
            <TxLink hash={hash} />
          </span>
        )}
      </Notice>
    );
  }
  return (
    <div role="status" className="flex flex-wrap items-center gap-2 text-sm text-text-primary">
      <CircleCheck className="size-[18px] text-success" aria-hidden />
      Done
      {hash && <TxLink hash={hash} compact />}
    </div>
  );
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body: string;
  confirmLabel: string;
  pendingLabel: string;
  successTitle: string;
  run: ChainRun;
  onDone?: (hash: string | null) => void;
  /** The summary block of the design (amounts, fee, result). */
  summary?: ReactNode;
};

/** A confirmation dialog that carries one chain action from the confirmation to its ending. */
export function ChainAction({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  pendingLabel,
  successTitle,
  run,
  onDone,
  summary,
}: Props) {
  const action = useChainAction(run);
  const { phase, reset } = action;
  const busy = phase === "wallet" || phase === "chain";
  const finished = useRef(false);

  // A new opening starts from the beginning.
  useEffect(() => {
    if (!open) {
      finished.current = false;
      reset();
    }
  }, [open, reset]);

  const confirm = async () => {
    const result = await action.start();
    if (!result || finished.current) return;
    finished.current = true;
    toast.success(successTitle, { description: result.hash ? <TxLink hash={result.hash} /> : undefined });
    onDone?.(result.hash);
    onOpenChange(false);
  };

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      body={body}
      confirmLabel={confirmLabel}
      onConfirm={() => void confirm()}
      dismissible={!busy}
      status={phase === "refused" ? <ChainActionStatus phase="refused" reason={action.reason} hash={action.hash} /> : undefined}
      actions={
        busy ? (
          <ChainActionStatus phase={phase} pendingLabel={pendingLabel} slow={action.slow} asButton />
        ) : phase === "refused" ? (
          <div className="flex gap-2.5 max-md:flex-col-reverse md:justify-end">
            <Button variant="ghost" size="lg" className="h-11 px-4 max-md:w-full" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button size="lg" className="h-11 px-4 max-md:w-full" onClick={() => void confirm()}>
              Try again
            </Button>
          </div>
        ) : undefined
      }
    >
      {summary}
    </ConfirmDialog>
  );
}
