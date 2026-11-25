"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Lock } from "lucide-react";
import { Orb } from "@/components/shared/Orb";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { shortAddress } from "@/lib/format";
import { cn, focusRing } from "@/lib/utils";
import { useWallet } from "@/modules/wallet/WalletProvider";
import { AccountMenu } from "@/modules/wallet/components/AccountMenu";
import { BackupFlow } from "@/modules/wallet/components/BackupFlow";
import { ConnectDialog, type ConnectView } from "@/modules/wallet/components/ConnectDialog";

const pill =
  "h-auto gap-2 rounded-full border-border bg-surface py-1.5 pr-3.5 pl-1.5 text-[13px] font-normal text-text-primary hover:bg-surface-hover";

/**
 * The account entry of the header: connect when there is no wallet, unlock when the saved wallet is locked,
 * otherwise the account menu. `compact` is the phone header: only the avatar, 44 px.
 */
export function AccountButton({ compact = false, className }: { compact?: boolean; className?: string }) {
  const session = useWallet((s) => s.session);
  const hydrated = useWallet((s) => s.hydrated);
  const [connectOpen, setConnectOpen] = useState(false);
  const [connectView, setConnectView] = useState<ConnectView>("choose");
  const [backupOpen, setBackupOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // After Lock the menu and its trigger are gone; focus moves to the locked button that replaces them.
  const focusLocked = useRef(false);
  const lockedButton = useRef<HTMLButtonElement>(null);
  const kind = session.kind;
  useEffect(() => {
    if (kind === "locked" && focusLocked.current) {
      focusLocked.current = false;
      lockedButton.current?.focus();
    }
  }, [kind, hydrated]);

  const openConnect = (view: ConnectView) => {
    setConnectView(view);
    setConnectOpen(true);
  };

  // Until the browser storage has been read the header holds the space and shows nothing that could be wrong.
  if (!hydrated) return <span aria-hidden className={cn("block h-10", compact ? "w-11" : "w-[148px]", className)} />;

  let trigger: ReactNode;
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
      <Button
        type="button"
        ref={lockedButton}
        variant="outline"
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
      </Button>
    );
  } else {
    trigger = (
      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="outline"
              aria-label="Account menu"
              className={cn(pill, compact && "size-11 justify-center p-0", focusRing, className)}
            />
          }
        >
          <Orb />
          {!compact && (
            <>
              <span className="font-mono">{shortAddress(session.address)}</span>
              <ChevronDown className="size-4 text-text-tertiary" aria-hidden />
            </>
          )}
        </PopoverTrigger>
        <AccountMenu
          session={session}
          onClose={() => setMenuOpen(false)}
          onBackup={() => setBackupOpen(true)}
          onSetup={() => openConnect("setup")}
          onLock={() => {
            focusLocked.current = true;
          }}
        />
      </Popover>
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
