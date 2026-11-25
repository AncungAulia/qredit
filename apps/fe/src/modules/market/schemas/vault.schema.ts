import type { VaultStateName } from "@/components/shared/StateBadge";

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
};
