"use client";

// The chain action lifecycle from the design board "Chain action lifecycle":
// ready -> waiting for the wallet -> on chain -> done (dialog closes, a toast carries the transaction)
// or refused (the dialog stays with the reason). Refusals always show a mapped sentence, never raw data.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { CircleCheck, LoaderCircle } from "lucide-react";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Notice } from "@/components/shared/Notice";
import { notifySuccess } from "@/components/shared/notify";
import { TxLink } from "@/components/shared/TxLink";
import { Button } from "@/components/ui/button";
import { TxFailed, TxReverted } from "@/modules/wallet/signer";
import { cn, focusRing } from "@/lib/utils";

export type ChainPhase = "idle" | "wallet" | "chain" | "done" | "refused";

/** The work of one action; resolves with the transaction hash, or null when no transaction was needed. Call `sent` once the transaction is on its way. */
export type ChainRun = (control: { sent(): void; progress(label: string): void }) => Promise<string | null>;

type ActionState = { phase: ChainPhase; hash?: string; reason?: string; maySpend?: boolean; progress?: string };

/** Where to look after a failure that may have moved funds, and the sentence that says so. */
export type NextStep = { text: string; label: string; href: string };

export const SLOW_AFTER_MS = 20_000;
export const SLOW_SENTENCE = "The chain is taking longer than usual. Your funds are safe.";
export const NOT_COMPLETED_SENTENCE = "The transaction could not be completed.";

/** The sentence for a failed run. Only the decoded reasons of TxReverted and TxFailed are shown. */
export function failureSentence(error: unknown): string {
  if (error instanceof TxReverted || error instanceof TxFailed) return error.reason;
  return NOT_COMPLETED_SENTENCE;
}

/** A send that left the wallet but could not be confirmed: funds may have moved, so the action must not be offered again. A revert moved nothing. */
export const mayHaveSpent = (error: unknown) => error instanceof TxFailed && error.hash !== null;

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
      const hash = await run({
        sent: () => setState((s) => (s.phase === "wallet" ? { phase: "chain", progress: s.progress } : s)),
        progress: (label) => setState((s) => (s.phase === "wallet" || s.phase === "chain" ? { ...s, progress: label } : s)),
      });
      setState({ phase: "done", hash: hash ?? undefined });
      return { hash };
    } catch (e) {
      setState({ phase: "refused", reason: failureSentence(e), hash: failureHash(e), maySpend: mayHaveSpent(e) });
      return null;
    }
  }, [run]);

  return { ...state, slow, start, reset };
}

type StatusProps = {
  phase: Exclude<ChainPhase, "idle">;
  /** Shown while the action runs, for example "Lending 500 fUSD"; the current step takes its place when there is one. */
  pendingLabel?: string;
  /** The step the action reports while it runs, for example "Opening the payment window". */
  progress?: string;
  /** True only while an external wallet (QoreX) shows a prompt; the test wallet signs by itself, so there is nothing to confirm. */
  walletPrompt?: boolean;
  hash?: string;
  reason?: string;
  slow?: boolean;
  /** Draws the waiting states as the disabled primary button of the dialog design. */
  asButton?: boolean;
  /** Title of the refusal notice; steps that are not transactions say "step". */
  refusedTitle?: string;
  /** Set when a failure may have moved funds: the notice then names the next step instead of a retry. */
  maySpend?: boolean;
  nextStep?: NextStep;
};

/** One state of the lifecycle: waiting rows, the refusal notice, or the finished transaction. */
export function ChainActionStatus({
  phase,
  pendingLabel,
  progress,
  walletPrompt,
  hash,
  reason,
  slow,
  asButton,
  refusedTitle = "This transaction was not completed",
  maySpend,
  nextStep,
}: StatusProps) {
  if (phase === "wallet" || phase === "chain") {
    const label =
      phase === "wallet" && walletPrompt
        ? "Confirm in your wallet"
        : (progress ?? pendingLabel ?? (phase === "wallet" ? "Preparing the transaction" : "Waiting for the chain"));
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
        {maySpend && nextStep && (
          <span className="mt-2 flex flex-col gap-2">
            <span className="font-medium text-text-primary">{nextStep.text}</span>
            <Link href={nextStep.href} className={cn("w-fit underline", focusRing)}>
              {nextStep.label}
            </Link>
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
  /** The line under the success title; the transaction link follows it. */
  successText?: string;
  run: ChainRun;
  onDone?: (hash: string | null) => void;
  /** The summary block of the design (amounts, fee, result). */
  summary?: ReactNode;
  /** Where to look when a failure may have moved funds; such a failure is never offered again. */
  nextStep: NextStep;
  /** False when a refused run must not be offered again as it is (for example a stale signed order). */
  retryable?: boolean;
  /** The confirm button is the danger button, and the closing button may be named. */
  destructive?: boolean;
  cancelLabel?: string;
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
  successText,
  run,
  onDone,
  summary,
  nextStep,
  retryable = true,
  destructive,
  cancelLabel,
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
    notifySuccess(successTitle, { text: successText, hash: result.hash ?? undefined });
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
      destructive={destructive}
      cancelLabel={cancelLabel}
      dismissible={!busy}
      status={phase === "refused" ? <ChainActionStatus phase="refused" reason={action.reason} hash={action.hash} maySpend={action.maySpend} nextStep={nextStep} /> : undefined}
      actions={
        busy ? (
          <ChainActionStatus phase={phase} pendingLabel={pendingLabel} progress={action.progress} slow={action.slow} asButton />
        ) : phase === "refused" ? (
          <div className="flex gap-2.5 max-md:flex-col-reverse md:justify-end">
            <Button variant="ghost" size="lg" className="h-11 px-4 max-md:w-full" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            {!action.maySpend && retryable && (
              <Button size="lg" className="h-11 px-4 max-md:w-full" onClick={() => void confirm()}>
                Try again
              </Button>
            )}
          </div>
        ) : undefined
      }
    >
      {summary}
    </ConfirmDialog>
  );
}
