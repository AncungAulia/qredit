"use client";

import { useState } from "react";
import { ChevronDown, Lock } from "lucide-react";
import { Orb } from "@/components/shared/Orb";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { shortAddress } from "@/lib/format";
import { cn, focusRing } from "@/lib/utils";
import { useWallet } from "@/modules/wallet/WalletProvider";
import { AccountMenu } from "@/modules/wallet/components/AccountMenu";
import { BackupFlow } from "@/modules/wallet/components/BackupFlow";
import { ConnectDialog, type ConnectView } from "@/modules/wallet/components/ConnectDialog";

const pill =
  "inline-flex items-center gap-2 rounded-full border border-border bg-surface py-1.5 pr-3.5 pl-1.5 text-[13px] text-text-primary transition-[transform,background-color] duration-[120ms] ease-[var(--ease-out)] hover:bg-surface-hover active:scale-[0.97] pointer-coarse:min-h-11";

/**
 * The account entry of the header: connect when there is no wallet, unlock when the saved wallet is locked,
 * otherwise the account menu. `compact` is the phone header: only the avatar, 44 px.
 */
export function AccountButton({ compact = false, className }: { compact?: boolean; className?: string }) {
  const session = useWallet((s) => s.session);
  const [connectOpen, setConnectOpen] = useState(false);
  const [connectView, setConnectView] = useState<ConnectView>("choose");
  const [backupOpen, setBackupOpen] = useState(false);

  const openConnect = (view: ConnectView) => {
    setConnectView(view);
    setConnectOpen(true);
  };

  let trigger;
  if (session.kind === "none") {
    trigger = (
      <Button
        type="button"
        aria-label="Connect wallet"
        className={cn("h-10 rounded-full px-4 pointer-coarse:h-11", focusRing, className)}
        onClick={() => openConnect("choose")}
      >
        {compact ? "Connect" : "Connect wallet"}
      </Button>
    );
  } else if (session.kind === "locked") {
    trigger = (
      <button
        type="button"
        aria-label="Unlock wallet"
        title={session.address}
        onClick={() => openConnect("unlock")}
        className={cn(pill, compact && "size-11 justify-center p-0", focusRing, className)}
      >
        <span className="grid size-8 place-items-center rounded-full bg-surface-muted">
          <Lock className="size-4 text-text-secondary" aria-hidden />
        </span>
        {!compact && (
          <>
            <span className="font-mono">{shortAddress(session.address)}</span>
            <span className="text-text-tertiary">Locked</span>
          </>
        )}
      </button>
    );
  } else {
    trigger = (
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Account menu"
          className={cn(pill, compact && "size-11 justify-center p-0", focusRing, className)}
        >
          <Orb />
          {!compact && (
            <>
              <span className="font-mono">{shortAddress(session.address)}</span>
              <ChevronDown className="size-4 text-text-tertiary" aria-hidden />
            </>
          )}
        </DropdownMenuTrigger>
        <AccountMenu session={session} onBackup={() => setBackupOpen(true)} onSetup={() => openConnect("setup")} />
      </DropdownMenu>
    );
  }

  return (
    <>
      {trigger}
      <ConnectDialog open={connectOpen} onOpenChange={setConnectOpen} initialView={connectView} />
      <BackupFlow open={backupOpen} onClose={() => setBackupOpen(false)} />
    </>
  );
}
