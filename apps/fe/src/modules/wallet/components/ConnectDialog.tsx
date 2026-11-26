"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, ChevronRight, ExternalLink, FlaskConical, LoaderCircle, Puzzle, Sparkles, TriangleAlert } from "lucide-react";
import { Notice } from "@/components/shared/Notice";
import { ResponsiveDialog } from "@/components/shared/ResponsiveDialog";
import { Button } from "@/components/ui/button";
import { QOREX_INSTALL_URL } from "@/config/links";
import { useWallet, useWalletApi } from "@/modules/wallet/WalletProvider";
import { ConnectOption, ConnectOptionLink } from "@/modules/wallet/components/ConnectOption";
import { CreateWalletForm } from "@/modules/wallet/components/CreateWalletForm";
import { ImportWalletForm } from "@/modules/wallet/components/ImportWalletForm";
import { UnlockForm } from "@/modules/wallet/components/UnlockForm";
import { WalletSetup } from "@/modules/wallet/components/WalletSetup";
import { QOREX_UNAVAILABLE_SENTENCE } from "@/modules/wallet/qorex";
import { testWalletOf } from "@/modules/wallet/signer";

export type ConnectView = "choose" | "test" | "create" | "import" | "unlock" | "setup";

type Props = { open: boolean; onOpenChange: (open: boolean) => void; initialView?: ConnectView };

const COPY: Record<ConnectView, { title: string; description?: string }> = {
  choose: { title: "Connect a wallet", description: "Qredit runs on the QoreChain testnet. Nothing here uses real money." },
  test: { title: "Test wallet in this browser", description: "A throwaway wallet that only exists in this browser." },
  create: { title: "Create a test wallet" },
  import: { title: "Import a test wallet" },
  unlock: { title: "Unlock your test wallet" },
  setup: { title: "Set up your test wallet", description: "A one-time setup so this wallet can lend and buy reports." },
};

const BACK: Partial<Record<ConnectView, ConnectView>> = { test: "choose", create: "test", import: "test" };

function QorexOption({
  connecting,
  setConnecting,
  onConnected,
}: {
  connecting: boolean;
  setConnecting: (value: boolean) => void;
  onConnected: () => void;
}) {
  const api = useWalletApi();
  const state = useWallet((s) => s.qorexState);
  const connectQorex = useWallet((s) => s.connectQorex);

  // The extension may inject itself after the page loaded, so look again on every press.
  const press = async (event?: { preventDefault(): void }) => {
    api.getState().hydrate();
    if (api.getState().qorexState === "notInstalled") return; // the link opens the install page
    event?.preventDefault();
    setConnecting(true);
    try {
      await connectQorex();
      onConnected();
    } catch {
      // The store records why in qorexState; the dialog shows it below.
    } finally {
      setConnecting(false);
    }
  };

  const badge = (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent-strong">
      <Sparkles className="size-3" aria-hidden />
      Recommended
    </span>
  );
  const icon = <Puzzle className="size-5 text-on-primary" aria-hidden />;
  const iconTile = "bg-primary";

  if (state === "notInstalled" && !connecting) {
    return (
      <ConnectOptionLink
        href={QOREX_INSTALL_URL}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => void press(e)}
        icon={icon}
        iconTile={iconTile}
        title="Install QoreX"
        description="Not found in this browser. Install it, then return to this page."
        trailing={<ExternalLink className="size-[18px] shrink-0 text-text-tertiary" aria-hidden />}
      />
    );
  }
  if (connecting) {
    return (
      <ConnectOption
        disabled
        tone="active"
        icon={icon}
        iconTile={iconTile}
        title="QoreX"
        description="Approve the connection in the QoreX window."
        trailing={<LoaderCircle className="size-[18px] shrink-0 animate-spin text-accent-strong motion-reduce:animate-none" aria-hidden />}
      />
    );
  }
  const unavailable = state === "unavailable";
  return (
    <>
      <ConnectOption
        onClick={() => void press()}
        tone={unavailable ? "warning" : "default"}
        icon={icon}
        iconTile={iconTile}
        title="QoreX"
        badge={unavailable ? undefined : badge}
        description={unavailable ? "QoreX did not connect." : "The QoreChain browser extension. Your keys stay in the extension."}
        trailing={
          unavailable ? (
            <TriangleAlert className="size-[18px] shrink-0 text-warning" aria-hidden />
          ) : (
            <ChevronRight className="size-[18px] shrink-0 text-text-tertiary" aria-hidden />
          )
        }
      />
      {unavailable && (
        <Notice tone="warning" title="Switch QoreX to testnet">
          {QOREX_UNAVAILABLE_SENTENCE}
        </Notice>
      )}
    </>
  );
}

/** Connect dialog on tablet and desktop, bottom sheet on a phone. It starts from `initialView` each time it opens. */
export function ConnectDialog({ open, onOpenChange, initialView = "choose" }: Props) {
  const [view, setView] = useState<ConnectView>(initialView);
  const [wasOpen, setWasOpen] = useState(open);
  const [connecting, setConnecting] = useState(false);
  const api = useWalletApi();
  const hydrate = useWallet((s) => s.hydrate);
  const session = useWallet((s) => s.session);

  // A new opening starts from the beginning (state adjusted while rendering, so the closing dialog keeps its content).
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setView(initialView);
      setConnecting(false);
    }
  }

  // Detect the extension when the dialog opens; it may have loaded after the page.
  useEffect(() => {
    if (open) hydrate();
  }, [open, hydrate]);

  const close = () => onOpenChange(false);
  const chooseTest = () => {
    if (testWalletOf(session)) setView("setup");
    else setView(api.getState().hasSavedWallet() ? "unlock" : "test");
  };
  const { title, description } = COPY[view];
  const back = BACK[view];

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={title} description={description}>
      {back && (
        <Button type="button" variant="ghost" size="sm" className="-mt-2 -ml-2 h-9 items-center justify-self-start self-start px-2 text-text-secondary" onClick={() => setView(back)}>
          <ArrowLeft aria-hidden />
          Back
        </Button>
      )}
      {view === "choose" && (
        <>
          <div className="flex flex-col gap-3">
            <QorexOption connecting={connecting} setConnecting={setConnecting} onConnected={close} />
            <ConnectOption
              onClick={chooseTest}
              icon={<FlaskConical className="size-5 text-text-primary" aria-hidden />}
              iconTile="bg-surface-muted"
              title="Test wallet in this browser"
              description="Created and stored only in this browser. Suitable for trying Qredit quickly."
              trailing={<ChevronRight className="size-[18px] shrink-0 text-text-tertiary" aria-hidden />}
              disabled={connecting}
            />
          </div>
          <p className="text-xs leading-normal text-text-tertiary">
            By connecting you can lend, buy reports and open them. Qredit never holds your keys.
          </p>
        </>
      )}
      {view === "test" && (
        <>
          <Notice tone="info" title="A throwaway wallet">
            This is a throwaway wallet for the QoreChain testnet. It holds no real money, and it is saved only in this browser,
            protected by a password you choose.
          </Notice>
          <div className="flex flex-col gap-2.5">
            <Button size="lg" className="h-11" onClick={() => setView("create")}>
              Create a new test wallet
            </Button>
            <Button variant="secondary" size="lg" className="h-11" onClick={() => setView("import")}>
              Import a recovery phrase
            </Button>
          </div>
        </>
      )}
      {view === "create" && <CreateWalletForm onCreated={() => setView("setup")} />}
      {view === "import" && <ImportWalletForm onImported={() => setView("setup")} />}
      {view === "unlock" && <UnlockForm onUnlocked={close} onForgotten={() => setView("choose")} />}
      {view === "setup" && <WalletSetup />}
    </ResponsiveDialog>
  );
}
