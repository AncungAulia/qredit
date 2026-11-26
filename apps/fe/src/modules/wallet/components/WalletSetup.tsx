"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CircleCheck, Coins, FileCheck, KeyRound, LoaderCircle, ShieldCheck, Inbox, type LucideIcon } from "lucide-react";
import { Address } from "@/components/shared/Address";
import { ChainActionStatus, useChainAction, type ChainRun } from "@/components/shared/ChainAction";
import { Notice } from "@/components/shared/Notice";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/apiClient";
import { formatDateTime } from "@/lib/format";
import { browserNet } from "@/lib/net";
import { claimFaucet } from "@/modules/wallet/api/wallet.api";
import { useWalletStatusQuery } from "@/modules/wallet/api/useWalletStatus";
import { setupDisplay, type StepDisplay } from "@/modules/wallet/setup/display";
import { readRetryAt, writeRetryAt } from "@/modules/wallet/setup/faucetRetry";
import { TxFailed, TxReverted, testWalletOf, withAccountLock } from "@/modules/wallet/signer";
import {
  needsQorForFees,
  nextStep,
  runStep,
  setupStatus,
  SETUP_ORDER,
  type SetupStep,
  type WalletChainStatus,
} from "@/modules/wallet/setup/steps";
import type { TestSession } from "@/modules/wallet/session";
import { useWallet } from "@/modules/wallet/WalletProvider";

const STEP_FAILED = "This step could not be completed. Please try again.";

type StepCopy = { Icon: LucideIcon; title: string; detail: string; button: string; pending: string };

// The design shows three steps ("Set up your inbox once"); the wallet needs five, so the others follow its wording.
const STEPS: Record<SetupStep, StepCopy> = {
  fund: {
    Icon: Coins,
    title: "Get test funds",
    detail: "A little QOR for network fees and test fUSD from the Qredit faucet.",
    button: "Get test funds",
    pending: "Asking the faucet",
  },
  registerKey: {
    Icon: KeyRound,
    title: "Register your post-quantum key",
    detail: "Records the quantum-safe signing key of this wallet on the chain.",
    button: "Register key",
    pending: "Registering your key",
  },
  convert: {
    Icon: ShieldCheck,
    title: "Prepare fUSD for payments",
    detail: "Moves your test fUSD to the account that vaults can use.",
    button: "Prepare fUSD",
    pending: "Preparing your fUSD",
  },
  registerKem: {
    Icon: Inbox,
    title: "Register your inbox key",
    detail: "Reports are sealed to it. It stays in your wallet.",
    button: "Register inbox key",
    pending: "Registering your inbox key",
  },
  publishCard: {
    Icon: FileCheck,
    title: "Publish your inbox card",
    detail: "Lets a business find the key to seal your reports to.",
    button: "Publish inbox card",
    pending: "Publishing your inbox card",
  },
};

/** Any failure that is not already a decoded chain refusal becomes one plain sentence. */
async function asStepFailure<T>(job: () => Promise<T>): Promise<T> {
  try {
    return await job();
  } catch (e) {
    if (e instanceof TxReverted || e instanceof TxFailed) throw e;
    throw new TxFailed(null, e instanceof ApiError ? e.message : STEP_FAILED);
  }
}

type RowProps = {
  step: SetupStep;
  display: StepDisplay;
  run: ChainRun;
  /** Extra lines under the description of the step that is next (faucet messages). */
  notes?: ReactNode;
  /** The button waits (the faucet was asked and its transfer has not arrived). */
  disabled?: boolean;
};

function StepRow({ step, display, run, notes, disabled }: RowProps) {
  const copy = STEPS[step];
  const action = useChainAction(run);
  const running = action.phase === "wallet" || action.phase === "chain";
  return (
    <li className="flex gap-3">
      <span className="grid size-[30px] shrink-0 place-items-center rounded-[9px] bg-surface">
        <copy.Icon className="size-[15px] text-accent-strong" aria-hidden />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-col gap-0.5">
          <p className="text-sm font-medium text-text-primary">{copy.title}</p>
          <p className="text-xs text-text-secondary">{copy.detail}</p>
        </div>
        {display === "next" && (
          <>
            {running ? (
              <ChainActionStatus phase={action.phase as "wallet" | "chain"} pendingLabel={copy.pending} slow={action.slow} />
            ) : (
              <>
                {action.phase === "refused" && (
                  <ChainActionStatus phase="refused" reason={action.reason} hash={action.hash} refusedTitle="This step was not completed" />
                )}
                <Button type="button" size="lg" className="h-10 self-start px-3.5" disabled={disabled} onClick={() => void action.start()}>
                  {copy.button}
                </Button>
              </>
            )}
            {notes}
          </>
        )}
      </div>
      {display === "done" && (
        <span className="flex h-[30px] shrink-0 items-center gap-1.5 text-[13px] text-text-secondary">
          <CircleCheck className="size-4 text-success" aria-hidden />
          Done
        </span>
      )}
      {display === "waiting" && (
        <span className="flex h-[30px] shrink-0 items-center text-[13px] text-text-tertiary">Waiting</span>
      )}
    </li>
  );
}

function FaucetNotes({ status, address, retryAt, claimed }: { status: WalletChainStatus; address: string; retryAt: Date | null; claimed: boolean }) {
  return (
    <div className="flex flex-col gap-2 text-[13px] text-text-secondary">
      {needsQorForFees(status) && <p>This wallet needs a little QOR to pay network fees.</p>}
      {claimed && !retryAt && (
        <p className="flex items-center gap-2">
          <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
          The faucet sent your test funds. This list updates when they arrive.
        </p>
      )}
      {retryAt && (
        <>
          <p>You can ask for test funds again at {formatDateTime(retryAt)}.</p>
          <p>Fund it from QoreX: send a little QOR and fUSD to this address.</p>
          <Address value={address} kind="qor" copyable className="self-start" />
        </>
      )}
    </div>
  );
}

function SetupList({ wallet }: { wallet: TestSession }) {
  const query = useWalletStatusQuery(wallet);
  // The faucet's answer is kept per address for the tab, so a reload keeps the message.
  const [retryAt, setRetryAtState] = useState<Date | null>(() => readRetryAt(wallet.address));
  const setRetryAt = (at: Date | null) => {
    setRetryAtState(at);
    writeRetryAt(wallet.address, at);
  };
  const [claimed, setClaimed] = useState(false);
  // The faucet button waits while the time shown is still ahead; it wakes up when that time passes.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!retryAt) return;
    const wait = retryAt.getTime() - Date.now();
    if (wait <= 0) return;
    const id = setTimeout(() => setNow(Date.now()), Math.min(wait + 50, 2_000_000_000));
    return () => clearTimeout(id);
  }, [retryAt]);
  const status = query.data;
  const raw = useMemo(() => (status ? setupStatus(status) : null), [status]);
  const fundDone = raw?.fund === "done";

  // After a claim the faucet's transfer takes a moment to arrive; read the status again until it does.
  const { refetch } = query;
  useEffect(() => {
    if (!claimed || fundDone) return;
    const id = setInterval(() => void refetch(), 4_000);
    return () => clearInterval(id);
  }, [claimed, fundDone, refetch]);

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        {SETUP_ORDER.map((s) => (
          <Skeleton key={s} className="h-12 w-full" />
        ))}
      </div>
    );
  }
  if (!status || !raw) {
    return (
      <div className="flex flex-col items-start gap-3">
        <Notice tone="danger">The status of the wallet could not be read. Please try again.</Notice>
        <Button type="button" variant="secondary" size="lg" className="h-10 px-3.5" onClick={() => void refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  const display = setupDisplay(raw);
  const next = nextStep(raw);

  const runFor = (step: SetupStep): ChainRun => ({ sent }) =>
    asStepFailure(async () => {
      sent();
      if (step === "fund") {
        // The transfer is the backend's, so there is no transaction of this wallet to link.
        const result = await claimFaucet(wallet.address);
        if ("retryAt" in result) setRetryAt(result.retryAt);
        else {
          setRetryAt(null);
          setClaimed(true);
        }
        await refetch();
        return null;
      }
      // A setup step signs from the same account as every other action, so it takes the same lock.
      const tx = await withAccountLock(wallet.evm, () => runStep(step, { acc: wallet.account, sealKeys: wallet.sealKeys, net: browserNet(), status }));
      await refetch();
      return tx;
    });

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex list-none flex-col gap-4">
        {SETUP_ORDER.map((step) => (
          <StepRow
            key={step}
            step={step}
            display={display[step]}
            run={runFor(step)}
            disabled={step === "fund" && (claimed || (retryAt !== null && retryAt.getTime() > now))}
            notes={
              step === "fund" && next === "fund" ? (
                <FaucetNotes status={status} address={wallet.address} retryAt={retryAt} claimed={claimed} />
              ) : undefined
            }
          />
        ))}
      </ul>
      {next === null && (
        <p className="flex items-center gap-2 text-sm font-medium text-text-primary">
          <CircleCheck className="size-[18px] text-success" aria-hidden />
          Your test wallet is ready.
        </p>
      )}
    </div>
  );
}

/** The one-time setup of the test wallet: five steps, one primary button for the next one. */
export function WalletSetup() {
  const wallet = useWallet((s) => testWalletOf(s.session));
  if (!wallet) {
    return <Notice tone="info">Unlock your test wallet to continue its setup.</Notice>;
  }
  return <SetupList wallet={wallet} />;
}
