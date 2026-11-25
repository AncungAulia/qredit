"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Copy, ExternalLink, KeyRound, LayoutDashboard, ListChecks, Lock, LogOut, ScrollText, SunMoon, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { Amount } from "@/components/shared/Amount";
import { notifySuccess } from "@/components/shared/notify";
import { Orb } from "@/components/shared/Orb";
import { ThemeSwitch } from "@/components/shared/ThemeSwitch";
import { Button } from "@/components/ui/button";
import { PopoverContent } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { env } from "@/lib/env";
import { shortAddress } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useWalletStatusQuery } from "@/modules/wallet/api/useWalletStatus";
import { nextStep, setupStatus } from "@/modules/wallet/setup/steps";
import { testWalletOf } from "@/modules/wallet/signer";
import type { WalletSession } from "@/modules/wallet/session";
import { useWallet } from "@/modules/wallet/WalletProvider";

type Props = {
  session: Extract<WalletSession, { kind: "test" | "qorex" }>;
  /** Closes the menu; every action runs it first. */
  onClose: () => void;
  onBackup: () => void;
  onSetup: () => void;
  /** Called just before the wallet is locked, so the caller can place the focus on what replaces the menu. */
  onLock: () => void;
};

const rowClass =
  "h-auto w-full justify-start gap-3 rounded-xl px-2.5 py-[11px] text-left text-sm font-normal text-text-primary [&_svg]:text-text-secondary";

/** One action of the menu: a ghost shadcn Button, or an anchor/link through `render`. */
function Row({
  Icon,
  danger,
  children,
  ...props
}: { Icon: LucideIcon; danger?: boolean; children: ReactNode } & React.ComponentProps<typeof Button>) {
  return (
    <Button variant="ghost" className={cn(rowClass, danger && "text-danger [&_svg]:text-danger")} {...props}>
      <Icon aria-hidden />
      {children}
    </Button>
  );
}

function Balance({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex items-center justify-between gap-3">
      <span className="text-[13px] text-text-secondary">{label}</span>
      {children}
    </div>
  );
}

function Balances({ wallet }: { wallet: NonNullable<ReturnType<typeof testWalletOf>> }) {
  const { data, isPending, isError } = useWalletStatusQuery(wallet);
  if (isPending) return <Skeleton className="mx-2.5 mb-2 h-14" />;
  if (isError || !data) return <p className="px-2.5 pb-2 text-[13px] text-text-tertiary">Balances could not be loaded.</p>;
  return (
    <div className="mx-1 mb-1 flex flex-col gap-1 rounded-xl bg-surface-muted px-3.5 py-2.5">
      <Balance label="Balance">
        <Amount units={data.fusd + data.fusdBank} unit="fUSD" size="sm" />
      </Balance>
      <Balance label="Network fees">
        <Amount units={data.qor} unit="QOR" size="sm" />
      </Balance>
    </div>
  );
}

/**
 * The account menu: address, balances, actions, appearance and the way out. It is a popover of buttons, so Tab
 * reaches every control, the appearance switch included.
 */
export function AccountMenu({ session, onClose, onBackup, onSetup, onLock }: Props) {
  const lock = useWallet((s) => s.lock);
  const disconnectQorex = useWallet((s) => s.disconnectQorex);
  const wallet = testWalletOf(session);
  const isQorex = session.kind === "qorex";
  const status = useWalletStatusQuery(wallet);
  const setupOpen = wallet && status.data ? nextStep(setupStatus(status.data)) !== null : false;

  const run = (action: () => void) => () => {
    onClose();
    action();
  };
  const copy = () => {
    void navigator.clipboard?.writeText(session.address).then(
      () => notifySuccess("Address copied", { text: `${shortAddress(session.address)} is on your clipboard.` }),
      () => toast.error("The address could not be copied.", { description: "Your browser did not allow access to the clipboard." }),
    );
  };

  return (
    <PopoverContent
      align="end"
      sideOffset={10}
      aria-label="Account menu"
      className="max-h-(--available-height) w-72 gap-1 overflow-y-auto rounded-[24px] bg-glass-strong p-2 shadow-[0_8px_32px_var(--shadow)] ring-1 ring-glass-edge backdrop-blur-xl"
    >
      <div className="flex items-center gap-3 px-2.5 pt-2.5 pb-3.5">
        <Orb className="size-10" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span title={session.address} className="font-mono text-[13px] text-text-primary">
            {shortAddress(session.address)}
          </span>
          <span className="text-xs text-text-tertiary">{isQorex ? "QoreX wallet" : "Test wallet"}</span>
        </div>
      </div>
      {wallet && <Balances wallet={wallet} />}
      <Row Icon={Copy} onClick={run(copy)}>
        Copy address
      </Row>
      {env.explorerUrl && (
        <Row
          Icon={ExternalLink}
          nativeButton={false}
          role="link"
          render={<a href={`${env.explorerUrl}/address/${session.evm}`} target="_blank" rel="noreferrer" />}
        >
          View on explorer
        </Row>
      )}
      {isQorex && (
        <Row Icon={LayoutDashboard} nativeButton={false} role="link" render={<Link href="/owner" onClick={onClose} />}>
          <span className="flex-1">Owner console</span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-muted px-2.5 py-1 text-xs font-medium text-text-secondary">
            <KeyRound className="size-3" aria-hidden />
            Owner
          </span>
        </Row>
      )}
      {wallet && setupOpen && (
        <Row Icon={ListChecks} onClick={run(onSetup)}>
          Finish wallet setup
        </Row>
      )}
      {wallet && (
        <Row Icon={ScrollText} onClick={run(onBackup)}>
          Back up phrase
        </Row>
      )}
      <div className="flex items-center gap-3 px-2.5 py-[7px]">
        <SunMoon className="size-4 text-text-secondary" aria-hidden />
        <span className="flex-1 text-sm text-text-primary">Appearance</span>
        <ThemeSwitch />
      </div>
      {wallet && (
        <Row
          Icon={Lock}
          onClick={run(() => {
            onLock();
            lock();
          })}
        >
          Lock
        </Row>
      )}
      {isQorex && (
        <Row Icon={LogOut} danger onClick={run(disconnectQorex)}>
          Disconnect QoreX
        </Row>
      )}
    </PopoverContent>
  );
}
