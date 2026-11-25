"use client";

import { useState } from "react";
import { ResponsiveDialog } from "@/components/shared/ResponsiveDialog";
import type { Business } from "@/lib/schemas";
import { formatFusd } from "@/lib/format";
import { LendForm } from "@/modules/lend/components/LendForm";
import type { VaultSnapshot } from "@/modules/market";
import { ConnectPrompt } from "@/modules/wallet/components/ConnectPrompt";
import { RequireReadyWallet } from "@/modules/wallet/components/RequireReadyWallet";
import { testWalletOf } from "@/modules/wallet/signer";
import { useWallet } from "@/modules/wallet/WalletProvider";

type Props = {
  business: Business;
  vault: VaultSnapshot;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

// What a session without a test wallet is told. Lending is always sent from the test wallet.
const NEEDS_WALLET: Record<string, { title: string; text: string }> = {
  locked: { title: "Unlock your wallet to lend", text: "Your test wallet is locked. Unlock it to lend; nothing moves until you confirm." },
  qorex: {
    title: "A test wallet is needed to lend",
    text: "QoreX cannot send this kind of transaction, so a test wallet sends it. Nothing moves until you confirm.",
  },
  none: {
    title: "Connect a wallet to lend",
    text: "Lending is sent from a wallet on the QoreChain testnet. Nothing moves until you confirm.",
  },
};

/** The Lend dialog (a bottom sheet on a phone). Opens from the Lend button of a business that is raising. */
export function LendSheet({ business, vault, open, onOpenChange }: Props) {
  const session = useWallet((s) => s.session);
  const [busy, setBusy] = useState(false);
  const wallet = testWalletOf(session);
  const need = NEEDS_WALLET[session.kind] ?? NEEDS_WALLET.none;

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Lend to ${business.name}`}
      description={`${formatFusd(vault.raised, { unit: false })} of ${formatFusd(vault.target)} raised`}
      dismissible={!busy}
    >
      {wallet ? (
        <RequireReadyWallet>
          <LendForm
            business={business}
            vault={vault}
            evm={wallet.evm}
            onClose={() => onOpenChange(false)}
            onBusyChange={setBusy}
          />
        </RequireReadyWallet>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <p className="text-[15px] font-medium text-text-primary">{need.title}</p>
            <p className="text-sm leading-normal text-text-secondary">{need.text}</p>
          </div>
          <ConnectPrompt size="lg" className="h-11 w-full" />
        </div>
      )}
    </ResponsiveDialog>
  );
}
