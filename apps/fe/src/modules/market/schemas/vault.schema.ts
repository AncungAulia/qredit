import type { VaultVersion } from "@qredit/qore/abi";
import type { VaultStateName } from "@/lib/vaultState";

/** What the market shows of one loan vault, read from the chain. Units are fUSD with 6 decimals. */
export type VaultSnapshot = {
  state: VaultStateName;
  raised: bigint;
  repaid: bigint;
  target: bigint;
  totalOwed: bigint;
  installment: bigint;
  period: bigint;
  raiseDeadline: Date;
  /** Share of each sale paid to lenders, in basis points. */
  lenderBps: number;
  paused: boolean;
  version: VaultVersion;
  /** The owner's bond still in the vault; 0 for v1 vaults and once it was returned or swept. */
  bondHeld: bigint;
  /** What an ended loan moved to lenders outside the schedule. */
  swept: bigint;
  /** First-time buyers counted by the vault; null for v1 vaults, which do not count them. */
  uniqueBuyers: number | null;
  /** Activation plus maturity; null before activation and for v1 vaults. */
  maturityAt: Date | null;
  /** Seconds past maturity before anyone can end the loan; absent for v1 vaults. */
  maturityGrace?: number;
  /** Missed installments after which anyone can end the loan; absent for v1 vaults. */
  defaultAfterMissed?: number;
};
