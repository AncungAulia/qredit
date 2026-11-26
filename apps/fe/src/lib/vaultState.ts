export type VaultStateName = "Raising" | "Active" | "Trapped" | "Repaid" | "Refunded" | "Defaulted" | "Closed";
const NAMES: VaultStateName[] = ["Raising", "Active", "Trapped", "Repaid", "Refunded", "Defaulted", "Closed"];

/** Maps the chain state number to its name. An unknown number is an error, never a guess. */
export const vaultStateName = (n: number): VaultStateName => {
  const name = NAMES[n];
  if (!name) throw new Error(`Unknown vault state ${n}`);
  return name;
};

/** The loan ended by a default or a Close order: nothing new is sold or lent, lenders claim what was swept. */
export const isEnded = (s: VaultStateName): boolean => s === "Defaulted" || s === "Closed";
