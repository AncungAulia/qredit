import type { Position } from "@/modules/lend/api/lend.api";
import { testWalletOf } from "@/modules/wallet/signer";
import type { WalletSession } from "@/modules/wallet/session";

type Hex = `0x${string}`;

/**
 * The address whose positions are shown. Lending is always sent from the test wallet (QoreX cannot send EVM
 * transactions), so its address wins; QoreX alone still lets the person read an address.
 */
export function lenderAddress(session: WalletSession): Hex | null {
  const test = testWalletOf(session);
  if (test) return test.evm;
  return session.kind === "qorex" ? session.evm : null;
}

export type LendTotals = { claimable: bigint; lent: bigint; claimed: bigint; active: number };

/** Loans that are not finished: still raising, repaying or trapped. */
const isActive = (p: Position) => p.vault.state === "Raising" || p.vault.state === "Active" || p.vault.state === "Trapped";

export function lendTotals(positions: Position[]): LendTotals {
  return positions.reduce<LendTotals>(
    (t, p) => ({
      claimable: t.claimable + p.claimable,
      lent: t.lent + p.deposit,
      claimed: t.claimed + p.claimed,
      active: t.active + (isActive(p) ? 1 : 0),
    }),
    { claimable: 0n, lent: 0n, claimed: 0n, active: 0 },
  );
}
