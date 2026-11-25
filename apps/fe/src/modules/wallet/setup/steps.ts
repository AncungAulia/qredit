import { convertFusd, defaultSleep, registerKemKey, registerPqcKey, signedCard, type Net } from "@qredit/qore";
import type { SealKeyPair } from "@qorechain/qoreseal";
import type { UnifiedAccount } from "@qorechain/sdk";
import { putCard } from "@/modules/wallet/api/wallet.api";
import type { WalletChainStatus } from "@/modules/wallet/schemas/wallet.schema";

export type { WalletChainStatus };
export type SetupStep = "fund" | "registerKey" | "convert" | "registerKem" | "publishCard";
export type SetupStatus = Record<SetupStep, "done" | "todo" | "waiting">;

export const SETUP_ORDER: readonly SetupStep[] = ["fund", "registerKey", "convert", "registerKem", "publishCard"];

/** Which steps are done. A step whose earlier steps are not done is waiting, not todo. */
export function setupStatus(s: WalletChainStatus): SetupStatus {
  const done: Record<SetupStep, boolean> = {
    fund: s.qor > 0n || s.fusdBank > 0n || s.fusd > 0n,
    registerKey: s.pqcRegistered,
    convert: s.fusdBank === 0n && s.fusd > 0n,
    registerKem: s.kemRegistered,
    publishCard: s.cardPublished,
  };
  let blocked = false;
  const out = {} as SetupStatus;
  for (const step of SETUP_ORDER) {
    if (done[step]) out[step] = "done";
    else {
      out[step] = blocked ? "waiting" : "todo";
      blocked = true;
    }
  }
  return out;
}

/** The first step still to do, or null when the wallet is ready. */
export const nextStep = (s: SetupStatus): SetupStep | null => SETUP_ORDER.find((step) => s[step] === "todo") ?? null;

export type StepContext = { acc: UnifiedAccount; sealKeys: SealKeyPair; net: Net; status: WalletChainStatus; sleep?: (ms: number) => Promise<void> };

/** Runs one step and waits until its transaction is in a block. Returns the transaction hash, or null when nothing was sent. */
export async function runStep(step: SetupStep, ctx: StepContext): Promise<string | null> {
  const { acc, sealKeys, net, status } = ctx;
  switch (step) {
    case "fund":
      // The faucet is claimed through claimFaucet; the transaction is the backend's, not this wallet's.
      return null;
    case "registerKey":
      return registerPqcKey(net, acc);
    case "convert":
      return convertFusd(net, acc, status.fusdBank);
    case "registerKem": {
      const tx = await registerKemKey(net, acc, sealKeys.mlkemPublicKey);
      // The card check reads the on-chain key, so wait for the next block.
      if (tx) await (ctx.sleep ?? defaultSleep)(10_000);
      return tx;
    }
    case "publishCard":
      await putCard(acc.cosmos, signedCard(net, acc, sealKeys));
      return null;
  }
}
