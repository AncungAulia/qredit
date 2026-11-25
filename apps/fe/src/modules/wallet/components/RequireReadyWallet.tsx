"use client";

import type { ReactNode } from "react";
import { ErrorState } from "@/components/shared/PageStates";
import { Skeleton } from "@/components/ui/skeleton";
import { useWalletStatusQuery } from "@/modules/wallet/api/useWalletStatus";
import { WalletSetup } from "@/modules/wallet/components/WalletSetup";
import { testWalletOf } from "@/modules/wallet/signer";
import { nextStep, setupStatus } from "@/modules/wallet/setup/steps";
import { useWallet } from "@/modules/wallet/WalletProvider";

export type Readiness = "none" | "loading" | "error" | "setup" | "ready";

/** Whether the test wallet of the session can send: "none" without a test wallet, otherwise read from the chain. */
export function useWalletReadiness(): { state: Readiness; refetch: () => void } {
  const wallet = useWallet((s) => testWalletOf(s.session));
  const query = useWalletStatusQuery(wallet);
  const refetch = () => void query.refetch();
  if (!wallet) return { state: "none", refetch };
  if (query.data) return { state: nextStep(setupStatus(query.data)) === null ? "ready" : "setup", refetch };
  if (query.isError) return { state: "error", refetch };
  return { state: "loading", refetch };
}

/** The one-time setup, shown where an action needs a wallet that is not ready yet (design: "Set up your inbox once"). */
export function SetupGate() {
  return (
    <div className="flex flex-col gap-4 rounded-lg bg-surface-muted p-4">
      <div className="flex flex-col gap-1">
        <p className="text-[15px] font-medium text-text-primary">Finish setting up your wallet</p>
        <p className="text-sm leading-normal text-text-secondary">
          A one-time setup so this wallet can lend and buy reports. Nothing moves until you confirm each step.
        </p>
      </div>
      <WalletSetup />
    </div>
  );
}

/**
 * Shows its children only when the test wallet is set up on the chain. While it is read a skeleton shows, a failed
 * read shows an error with a retry, and an unfinished setup shows the setup steps. Without a test wallet the
 * children show, so they can say what is missing themselves.
 */
export function RequireReadyWallet({ children }: { children: ReactNode }) {
  const { state, refetch } = useWalletReadiness();
  if (state === "ready" || state === "none") return <>{children}</>;
  if (state === "setup") return <SetupGate />;
  if (state === "error") {
    return (
      <ErrorState
        layout="section"
        title="The status of your wallet could not be read."
        message="Please try again shortly."
        onRetry={refetch}
      />
    );
  }
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-3">
      <span className="sr-only">Loading</span>
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-11 w-full" />
    </div>
  );
}
