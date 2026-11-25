"use client";

import { ConnectPrompt } from "@/modules/wallet/components/ConnectPrompt";
import { useWallet } from "@/modules/wallet/WalletProvider";

type Props = {
  /** What the wallet is needed for, as a verb phrase: "lend", "buy a report". */
  verb: string;
  /** The same as a noun: "Lending", "Buying". */
  noun: string;
};

/** What a session without a test wallet is told, with the button for the step it needs. Sending is always done by the test wallet. */
export function NeedsWallet({ verb, noun }: Props) {
  const kind = useWallet((s) => s.session.kind);
  const need =
    kind === "locked"
      ? { title: `Unlock your wallet to ${verb}`, text: `Your test wallet is locked. Unlock it to ${verb}; nothing moves until you confirm.` }
      : kind === "qorex"
        ? {
            title: `A test wallet is needed to ${verb}`,
            text: "QoreX cannot send this kind of transaction, so a test wallet sends it. Nothing moves until you confirm.",
          }
        : {
            title: `Connect a wallet to ${verb}`,
            text: `${noun} is sent from a wallet on the QoreChain testnet. Nothing moves until you confirm.`,
          };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <p className="text-[15px] font-medium text-text-primary">{need.title}</p>
        <p className="text-sm leading-normal text-text-secondary">{need.text}</p>
      </div>
      <ConnectPrompt size="lg" className="h-11 w-full" />
    </div>
  );
}
