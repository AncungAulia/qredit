"use client";

import Link from "next/link";
import { Copy, ExternalLink, KeyRound, LayoutDashboard, ListChecks, Lock, LogOut, ScrollText, SunMoon } from "lucide-react";
import { toast } from "sonner";
import { Amount } from "@/components/shared/Amount";
import { Orb } from "@/components/shared/Orb";
import { ThemeSwitch } from "@/components/shared/ThemeSwitch";
import { DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { env } from "@/lib/env";
import { shortAddress } from "@/lib/format";
import { useWalletStatusQuery } from "@/modules/wallet/api/useWalletStatus";
import { nextStep, setupStatus } from "@/modules/wallet/setup/steps";
import { testWalletOf } from "@/modules/wallet/signer";
import type { WalletSession } from "@/modules/wallet/session";
import { useWallet } from "@/modules/wallet/WalletProvider";

type Props = {
  session: Extract<WalletSession, { kind: "test" | "qorex" }>;
  onBackup: () => void;
  onSetup: () => void;
};

const item = "gap-3 rounded-xl px-2.5 py-[11px] text-sm text-text-primary pointer-coarse:min-h-11 [&_svg]:text-text-secondary";

function Balance({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={`${label} balance`} className="flex items-center justify-between gap-3">
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
      <Balance label="fUSD">
        <Amount units={data.fusd + data.fusdBank} unit="fUSD" size="sm" />
      </Balance>
      <Balance label="QOR">
        <Amount units={data.qor} unit="QOR" size="sm" />
      </Balance>
    </div>
  );
}

/** The menu of the account button: address, balances, actions, appearance and the way out. */
export function AccountMenu({ session, onBackup, onSetup }: Props) {
  const lock = useWallet((s) => s.lock);
  const disconnectQorex = useWallet((s) => s.disconnectQorex);
  const wallet = testWalletOf(session);
  const isQorex = session.kind === "qorex";
  const status = useWalletStatusQuery(wallet);
  const setupOpen = wallet && status.data ? nextStep(setupStatus(status.data)) !== null : false;

  const copy = () => {
    void navigator.clipboard?.writeText(session.address).then(
      () => toast.success("Address copied"),
      () => toast.error("The address could not be copied."),
    );
  };

  return (
    <DropdownMenuContent
      align="end"
      sideOffset={10}
      className="w-72 gap-1 rounded-[24px] bg-glass-strong p-2 shadow-[0_8px_32px_var(--shadow)] ring-1 ring-glass-edge backdrop-blur-xl"
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
      <DropdownMenuItem className={item} onClick={copy}>
        <Copy aria-hidden />
        Copy address
      </DropdownMenuItem>
      {env.explorerUrl && (
        <DropdownMenuItem
          className={item}
          render={<a href={`${env.explorerUrl}/address/${session.evm}`} target="_blank" rel="noreferrer" />}
        >
          <ExternalLink aria-hidden />
          View on explorer
        </DropdownMenuItem>
      )}
      {isQorex && (
        <DropdownMenuItem className={item} render={<Link href="/owner" />}>
          <LayoutDashboard aria-hidden />
          <span className="flex-1">Owner console</span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-muted px-2.5 py-1 text-xs font-medium text-text-secondary">
            <KeyRound className="size-3" aria-hidden />
            Owner
          </span>
        </DropdownMenuItem>
      )}
      {wallet && setupOpen && (
        <DropdownMenuItem className={item} onClick={onSetup}>
          <ListChecks aria-hidden />
          Finish wallet setup
        </DropdownMenuItem>
      )}
      {wallet && (
        <DropdownMenuItem className={item} onClick={onBackup}>
          <ScrollText aria-hidden />
          Back up phrase
        </DropdownMenuItem>
      )}
      <div className="flex items-center gap-3 px-2.5 py-[7px]">
        <SunMoon className="size-4 text-text-secondary" aria-hidden />
        <span className="flex-1 text-sm text-text-primary">Appearance</span>
        <ThemeSwitch />
      </div>
      {wallet && (
        <DropdownMenuItem className={item} onClick={lock}>
          <Lock aria-hidden />
          Lock
        </DropdownMenuItem>
      )}
      {isQorex && (
        <DropdownMenuItem className={`${item} text-danger [&_svg]:text-danger`} onClick={disconnectQorex}>
          <LogOut aria-hidden />
          Disconnect QoreX
        </DropdownMenuItem>
      )}
    </DropdownMenuContent>
  );
}
