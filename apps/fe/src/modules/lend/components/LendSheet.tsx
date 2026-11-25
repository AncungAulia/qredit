"use client";

import { useState } from "react";
import { ResponsiveDialog } from "@/components/shared/ResponsiveDialog";
import type { Business } from "@/lib/schemas";
import { formatFusd } from "@/lib/format";
import { LendForm } from "@/modules/lend/components/LendForm";
import type { VaultSnapshot } from "@/modules/market";
import { NeedsWallet } from "@/modules/wallet/components/NeedsWallet";
import { RequireReadyWallet } from "@/modules/wallet/components/RequireReadyWallet";
import { testWalletOf } from "@/modules/wallet/signer";
import { useWallet } from "@/modules/wallet/WalletProvider";

type Props = {
  business: Business;
  vault: VaultSnapshot;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** The Lend dialog (a bottom sheet on a phone). Opens from the Lend button of a business that is raising. */
export function LendSheet({ business, vault, open, onOpenChange }: Props) {
  const session = useWallet((s) => s.session);
  const [busy, setBusy] = useState(false);
  const wallet = testWalletOf(session);

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
        <NeedsWallet verb="lend" noun="Lending" />
      )}
    </ResponsiveDialog>
  );
}
