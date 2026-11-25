"use client";

import { useState, type ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { useWallet } from "@/modules/wallet/WalletProvider";
import { ConnectDialog, type ConnectView } from "@/modules/wallet/components/ConnectDialog";

/** Where the connect dialog starts for the current session, and what the button says. */
function promptFor(kind: string): { view: ConnectView; label: string } {
  if (kind === "locked") return { view: "unlock", label: "Unlock wallet" };
  // QoreX alone cannot send EVM transactions, so the next step is a test wallet.
  if (kind === "qorex") return { view: "test", label: "Use a test wallet" };
  return { view: "choose", label: "Connect wallet" };
}

type Props = Omit<ComponentProps<typeof Button>, "onClick" | "children">;

/**
 * A button that opens the connect dialog at the step the current session needs (connect, unlock or test wallet).
 * The dialog belongs to the button, so the button must stay mounted while the dialog is open.
 */
export function ConnectPrompt(button: Props) {
  const kind = useWallet((s) => s.session.kind);
  const [open, setOpen] = useState(false);
  const { view, label } = promptFor(kind);
  return (
    <>
      <Button
        type="button"
        {...button}
        onClick={() => setOpen(true)}
      >
        {label}
      </Button>
      <ConnectDialog open={open} onOpenChange={setOpen} initialView={view} />
    </>
  );
}
